import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// TEMPORARY: when AUTO_LOGIN_EMAIL is set, visitors are signed in as that user
// without the login page. Remove the env var to restore normal login.
export const AUTO_LOGIN_EMAIL = process.env.AUTO_LOGIN_EMAIL

// Mints a magic-link token with the service role key and redeems it on the given
// cookie-backed client, which stores the session. Returns an error message or null.
export async function autoLogin(supabase: SupabaseClient): Promise<string | null> {
  if (!AUTO_LOGIN_EMAIL) return 'AUTO_LOGIN_EMAIL is not set'
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY is not set'

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: AUTO_LOGIN_EMAIL,
  })
  if (error) return `Auto-login failed to generate link: ${error.message}`

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  })
  if (verifyError) return `Auto-login failed to verify token: ${verifyError.message}`

  return null
}
