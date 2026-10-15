"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { label: "Home", path: "", id: "home" },
  { label: "Team", path: "/team", id: "team" },
  { label: "Ledger", path: "/ledger", id: "ledger" },
  { label: "Artifacts", path: "/artifacts", id: "artifacts" },
  { label: "Public page", path: "/public", id: "public" },
] as const;

/** Sub-navigation inside a company. Marks the active section; each link is `nav-<id>` for the flows. */
export function CompanyNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/c/${slug}`;
  return (
    <nav aria-label="Company sections" className="flex flex-wrap items-center gap-x-4">
      {LINKS.map((link) => {
        const href = `${base}${link.path}`;
        const active = link.path === "" ? pathname === base || pathname.startsWith(`${base}/onboarding`) : pathname.startsWith(href);
        return (
          <Link
            key={link.label}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`nav-${link.id}`}
            className={`mono-label border-b py-1 ${active ? "border-fg text-fg" : "border-transparent text-faint hover:text-fg"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
