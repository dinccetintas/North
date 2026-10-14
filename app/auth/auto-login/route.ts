import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { AUTO_LOGIN_EMAIL, autoLogin } from '@/lib/supabase/auto-login'

// Signs the visitor in as AUTO_LOGIN_EMAIL. 404 when auto-login is disabled,
// so the login page can fall back to the magic-link email.
export async function POST() {
  if (!AUTO_LOGIN_EMAIL) {
    return NextResponse.json({ error: 'Auto-login is disabled' }, { status: 404 })
  }

  const supabase = createRouteHandlerClient({ cookies })
  const error = await autoLogin(supabase)
  if (error) {
    console.error(error)
    return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
