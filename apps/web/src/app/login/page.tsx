import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { sendMagicLink, signInWithGoogle } from "./actions";

type SearchParams = Promise<{ sent?: string; error?: string; next?: string }>;

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/companies";

  return (
    <main className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="font-display text-3xl">
          North
        </Link>
        <Link href="/" className="retro-button">
          Get started
        </Link>
      </header>

      <section className="mx-auto mt-16 w-full max-w-sm px-6">
        <h1 className="text-4xl">Sign in</h1>
        <p className="mt-2 text-muted">No password. We email you a secure link.</p>

        {params.sent ? (
          <p className="mono-label mt-8 border border-success bg-success-bg px-3 py-3 text-success" role="status">
            Link sent. Check your inbox.
          </p>
        ) : null}
        {params.error ? (
          <p className="mono-label mt-8 border border-error bg-error-bg px-3 py-3 text-error" role="alert">
            {params.error}
          </p>
        ) : null}

        <form action={signInWithGoogle} className="mt-8">
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="retro-button w-full">
            Continue with Google
          </button>
        </form>

        <div className="mono-label my-6 text-center text-faint">or</div>

        <form action={sendMagicLink} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label className="mono-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="hairline bg-bg px-3 py-3 font-body text-base outline-none focus:border-deep"
          />
          <button type="submit" className="retro-button retro-button-primary w-full">
            Continue with email
          </button>
        </form>

        <p className="mono-label mt-6 text-faint">
          By continuing you agree to the{" "}
          <Link href="/legal/terms" className="underline">
            terms of service
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline">
            privacy notice
          </Link>
          .
        </p>
      </section>
      <div className="mt-auto pt-16">
        <SiteFooter />
      </div>
    </main>
  );
}
