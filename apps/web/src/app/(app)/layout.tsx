import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <Link href="/companies" className="font-display text-2xl">
          North
        </Link>
        <nav className="mono-label flex items-center gap-5">
          <Link href="/companies" className="hover:underline">
            Companies
          </Link>
          <Link href="/new" className="hover:underline">
            New
          </Link>
          <span className="hidden text-faint sm:inline" data-testid="user-email">
            {user.email}
          </span>
          <form action={signOut}>
            <button type="submit" className="hover:underline">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
