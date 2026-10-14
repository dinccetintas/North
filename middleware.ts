import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// TEMPORARY: when AUTO_LOGIN_EMAIL is set, the login page is skipped and every
// visitor is signed in as that user. Remove the env var to restore the login page.
const AUTO_LOGIN_EMAIL = process.env.AUTO_LOGIN_EMAIL

// Mints a magic-link token with the service role key and redeems it on the
// middleware client, which writes the session cookies onto `res`.
async function autoLogin(supabase: ReturnType<typeof createMiddlewareClient>) {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: AUTO_LOGIN_EMAIL!,
  })
  if (error) {
    console.error('Auto-login failed to generate link:', error.message)
    return false
  }
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  })
  if (verifyError) {
    console.error('Auto-login failed to verify token:', verifyError.message)
    return false
  }
  return true
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  // Refresh session if it exists
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const { pathname } = req.nextUrl

  if (!session && AUTO_LOGIN_EMAIL && !pathname.startsWith('/auth')) {
    if (await autoLogin(supabase)) {
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
