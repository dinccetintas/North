import Link from "next/link";
import { notFound } from "next/navigation";
import { isLegalDoc, LEGAL_DOCS, LEGAL_TITLES, loadLegal } from "@/lib/legal";
import { Markdown } from "@/components/markdown";
import { SiteFooter } from "@/components/site-footer";

type Params = Promise<{ doc: string }>;

/** The three documents are known at build time; any other path is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCS.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Params }) {
  const { doc } = await params;
  return { title: isLegalDoc(doc) ? LEGAL_TITLES[doc] : "Not found" };
}

/** LEG-1: terms, privacy and acceptable use, our own markdown, with the draft banner until counsel signs off. */
export default async function LegalPage({ params }: { params: Params }) {
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  const legal = await loadLegal(doc);

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-2xl">
          North
        </Link>
        <span className="mono-label text-faint">Legal</span>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6" data-testid="legal-doc" data-doc={doc}>
        {legal.draft ? (
          <p className="mono-label border border-warning bg-warning-bg px-3 py-3 text-ink" data-testid="legal-draft-banner">
            Draft: counsel review before launch. Bracketed terms are placeholders.
          </p>
        ) : null}
        <div className="mt-8">
          <Markdown source={legal.body} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
