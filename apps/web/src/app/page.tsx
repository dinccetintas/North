import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { TerminalStrip } from "@/components/terminal-strip";

const PROMISES = [
  "North plans your week.",
  "North ships your site.",
  "North runs your ads.",
  "North answers your customers.",
  "North finds your first ten buyers.",
  "You make three decisions a day.",
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <TerminalStrip lines={["> Researching the market...", "> Drafting the weekly plan...", "> Preparing decision card 2/3..."]} />
      <div className="mono-label flex items-center justify-center gap-2 bg-deep px-4 py-2 text-paper">
        <span aria-hidden>●</span>
        <span>North runs companies while their founders sleep. Founders still decide.</span>
      </div>

      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="font-display text-3xl">
          North
        </Link>
        <Link href="/login" className="mono-label underline-offset-4 hover:underline">
          Sign in
        </Link>
      </header>

      <section className="flex flex-col items-center px-6 pb-24 pt-16 text-center sm:pt-28">
        <h1 className="max-w-4xl text-5xl leading-[1.05] sm:text-7xl">
          Be the CEO of your life.
          <br />
          <span className="italic">Let the staff be software.</span>
        </h1>
        <p className="mt-8 max-w-xl text-lg text-gray-aa">
          State a thesis, a goal and a budget. A team of agents researches, builds, markets and sells. You only
          answer the decisions a CEO should make: at most three a day.
        </p>
        <Link href="/login" className="retro-button mt-10 bg-paper text-ink">
          Get started
        </Link>
        <p className="mono-label mt-4 text-gray-88">No credit card · Your code stays in your GitHub</p>
      </section>

      <section className="border-t border-gray-55 px-6 py-20">
        <ul className="mx-auto flex max-w-xl flex-col gap-4 text-2xl sm:text-3xl">
          {PROMISES.map((line) => (
            <li key={line} className="font-display">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <SiteFooter tone="ink" />
    </main>
  );
}
