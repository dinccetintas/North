import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { withError } from "@/lib/page-errors";

const OTP_TYPES: readonly EmailOtpType[] = ["magiclink", "email", "signup", "recovery", "invite", "email_change"];

/** Completes magic-link (token_hash) and OAuth/PKCE (code) sign-ins. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const nextParam = searchParams.get("next") ?? "/companies";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/companies";
  const supabase = await createClient();

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}${withError("/login", "login", "link-invalid")}`);
}
