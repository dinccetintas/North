import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTO_LOGIN_EMAIL, autoLogin } from '@/lib/supabase/auto-login'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  // Refresh session if it exists
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const { pathname } = req.nextUrl

  if (!session && AUTO_LOGIN_EMAIL && !pathname.startsWith('/auth')) {
    const error = await autoLogin(supabase)
    if (error) {
      console.error(error)
    } else {
      // Redirect so the next request carries the new session cookies
      const target = pathname.startsWith('/login') ? '/cockpit' : req.nextUrl.pathname + req.nextUrl.search
      const redirect = NextResponse.redirect(new URL(target, req.url))
      res.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
      return redirect
    }
  }

  // Allow auth routes through
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    // If already logged in, redirect to cockpit
    if (session && pathname === '/login') {
      return NextResponse.redirect(new URL('/cockpit', req.url))
    }
    return res
  }

  // All other routes require authentication
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
}
