import { createCompanyAction } from "./actions";

export const metadata = { title: "New company" };

type SearchParams = Promise<{ error?: string }>;

export default async function NewCompanyPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <p className="mono-label text-faint">Thesis · before step 1 of 4</p>
      <h1 className="mt-2 text-4xl">What are we building?</h1>
      <p className="mt-3 text-muted">
        One paragraph: the idea, who it is for, and why now. The research agent starts from this. Goal, budget and
        connections come next.
      </p>

      {error ? (
        <p className="mono-label mt-6 border border-error bg-error-bg px-3 py-3 text-error" role="alert">
          {error}
        </p>
      ) : null}

      <form action={createCompanyAction} className="mt-8 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="mono-label">
            Company name
          </label>
          <input id="name" name="name" required maxLength={120} className="hairline bg-bg px-3 py-3 outline-none focus:border-deep" />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="thesis" className="mono-label">
            Thesis
          </label>
          <textarea
            id="thesis"
            name="thesis"
            required
            minLength={10}
            maxLength={4000}
            rows={6}
            placeholder="A done-for-you cold email service for B2B marketing agencies that have no outbound arm..."
            className="hairline bg-bg px-3 py-3 outline-none focus:border-deep"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="targetCustomer" className="mono-label">
              Target customer
            </label>
            <input id="targetCustomer" name="targetCustomer" maxLength={500} className="hairline bg-bg px-3 py-3 outline-none focus:border-deep" />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="whyNow" className="mono-label">
              Why now
            </label>
            <input id="whyNow" name="whyNow" maxLength={500} className="hairline bg-bg px-3 py-3 outline-none focus:border-deep" />
          </div>
        </div>
        <button type="submit" className="retro-button retro-button-primary self-start">
          Create company
        </button>
      </form>
    </main>
  );
}
