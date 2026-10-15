import Link from "next/link";

const LINKS = [
  { href: "/legal/terms", label: "Terms", id: "terms" },
  { href: "/legal/privacy", label: "Privacy", id: "privacy" },
  { href: "/legal/acceptable-use", label: "Acceptable use", id: "acceptable-use" },
] as const;

/**
 * LEG-1: the three legal documents and the name, on the landing page, the
 * login, every signed-in screen and the public company page. `ink` is the
 * landing's dark ground; `paper` follows the theme.
 */
export function SiteFooter({ tone = "paper" }: { tone?: "paper" | "ink" }) {
  const colours = tone === "ink" ? "border-gray-55 text-gray-88" : "border-surface-border text-faint";
  return (
    <footer className={`mono-label flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-6 py-6 ${colours}`} data-testid="site-footer">
      {LINKS.map((link) => (
        <Link key={link.id} href={link.href} className="hover:underline" data-testid={`footer-${link.id}`}>
          {link.label}
        </Link>
      ))}
      <span className="ml-auto">North</span>
    </footer>
  );
}
