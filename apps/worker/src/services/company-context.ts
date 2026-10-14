import { currentThesis, listBudgets, listGoals, memoryDigest, type DbClient } from "@north/db";

export interface CompanyContext {
  /** Labeled lines every prompt and fixture can parse: Company, Thesis, Target customer, Why now. */
  readonly header: string;
  /** Memory digest from the repository (thesis + newest memory items). */
  readonly digest: string;
  /** Placeholder values for the role system prompts. */
  readonly vars: Readonly<Record<string, string>>;
}

/** Gathers what an agent needs to know about the company before a run. */
export async function companyContext(db: DbClient, companyId: string): Promise<CompanyContext> {
  const [company, thesis, goals, budgets, digest] = await Promise.all([
    db.from("companies").select("name").eq("id", companyId).single(),
    currentThesis(db, companyId),
    listGoals(db, companyId),
    listBudgets(db, companyId),
    memoryDigest(db, companyId),
  ]);
  const name = company.data?.name ?? "the company";
  const goalLines = goals.filter((g) => g.status === "active").map((g) => `${g.metricKey} → ${g.targetValue} by ${g.dueDate}`);
  const budgetLines = budgets.map((b) => `${b.category}: $${b.totalLimitUsd} total, $${b.dailyLimitUsd}/day`);
  const header = [
    `Company: ${name}`,
    `Thesis: ${thesis?.text ?? "(not set)"}`,
    `Target customer: ${thesis?.targetCustomer || "(not set)"}`,
    `Why now: ${thesis?.whyNow || "(not set)"}`,
  ].join("\n");
  return Object.freeze({
    header,
    digest,
    vars: Object.freeze({
      "company.name": name,
      thesis: thesis?.text ?? "(not set)",
      goals: goalLines.join("; ") || "(none yet)",
      budgets: budgetLines.join("; ") || "(none yet)",
      "budgets.ads": budgets.find((b) => b.category === "ads") ? `$${budgets.find((b) => b.category === "ads")?.totalLimitUsd} total` : "(none)",
      quota: "3",
    }),
  });
}
