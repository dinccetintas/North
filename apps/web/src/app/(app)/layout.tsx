import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { ownerCompanies, ownerEntitlement } from "@/lib/account";
import { activeCompanyCount, newCompanyGate } from "@/lib/portfolio-view";
import { signOut } from "@/app/login/actions";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteFooter } from "@/components/site-footer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [entitlement, companies] = await Promise.all([ownerEntitlement(user.id), ownerCompanies()]);
  // BIL-1: "New" still opens /new, which explains the limit and links to billing.
  const gate = newCompanyGate(entitlement, activeCompanyCount(companies));

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <Link href="/companies" className="font-display text-2xl">
          North
        </Link>
        <nav className="mono-label flex items-center gap-5">
          <Link href="/companies" className="hover:underline">
            Companies
          </Link>
          <Link
            href="/new"
            className={gate.allowed ? "hover:underline" : "text-faint hover:underline"}
            data-testid="nav-new"
            data-disabled={gate.allowed ? "false" : "true"}
            title={gate.reason ?? undefined}
          >
            New
          </Link>
          <Link href="/settings" className="hover:underline" data-testid="nav-settings">
            Settings
          </Link>
          <span className="hidden text-faint sm:inline" data-testid="user-email">
            {user.email}
          </span>
          <form action={signOut}>
            <SignOutButton />
          </form>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
