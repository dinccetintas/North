import { batchPayload, spendProfile, type ActionSpec } from "./action";
import { classify, type ClassifyReason } from "./classify";
import type { Tier } from "../tiers";
import { wouldExceedBudget, type BudgetState } from "../budget/guard";
import type { CardDraft } from "../decisions/types";

export interface AutoRule {
  readonly id: string;
  readonly kind: ActionSpec["kind"];
  readonly maxAmountUsd?: number;
  readonly category?: ActionSpec["category"];
  readonly active: boolean;
}

export interface PolicyContext {
  readonly killSwitchActive: boolean;
  readonly budgets: readonly BudgetState[];
  readonly autoRules: readonly AutoRule[];
  /** Default due time for cards opened by this gate, as an ISO timestamp. */
  readonly cardDueAt: string;
}

export type GateReason = ClassifyReason | "budget_cap" | "kill_switch" | "auto_rule";

interface Decided {
  readonly tier: Tier;
  readonly reasons: readonly GateReason[];
}

export type GateDecision =
  | (Decided & { readonly kind: "run"; readonly autoRuleId?: string })
  | (Decided & { readonly kind: "notify" })
  | (Decided & { readonly kind: "card"; readonly card: CardDraft })
  | (Decided & { readonly kind: "block" });

function matchingAutoRule(spec: ActionSpec, rules: readonly AutoRule[]): AutoRule | undefined {
  return rules.find((rule) => {
    if (!rule.active || rule.kind !== spec.kind) return false;
    if (rule.category && rule.category !== spec.category) return false;
    if (rule.maxAmountUsd !== undefined && (spec.amountUsd ?? 0) > rule.maxAmountUsd) return false;
    return true;
  });
}

function budgetFor(spec: ActionSpec, budgets: readonly BudgetState[]): BudgetState | undefined {
  return budgets.find((b) => b.category === (spec.category ?? "other"));
}

/** What each gate reason means to the CEO reading the card; the raw reason stays in the action payload. */
export const REASON_PHRASES: Readonly<Record<GateReason, string>> = Object.freeze({
  no_external_effect: "stays inside the platform",
  reversible_no_spend: "is reversible and spends nothing",
  spends_money: "spends money",
  public_statement: "says something new in public",
  new_contact: "contacts someone for the first time",
  goes_live: "goes live to customers",
  irreversible: "cannot be undone",
  legally_binding: "is legally binding",
  single_spend_over_limit: "is a single spend over the K3 limit",
  agent_raised: "was flagged by the agent itself",
  budget_cap: "would exceed the budget cap",
  kill_switch: "is stopped by the kill switch",
  auto_rule: "matches a standing rule",
});

const ROLE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  chief_of_staff: "Chief of Staff",
  research: "Research",
  strategy_product: "Strategy and Product",
  engineering: "Engineering",
  design: "Design",
  growth: "Growth",
  sales: "Sales",
  ops_finance: "Operations and Finance",
});

const joinPhrases = (phrases: readonly string[]): string =>
  phrases.length <= 1 ? (phrases[0] ?? "") : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;

const RATIONALE_MAX = 600;
const FACT_MAX = 120;

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, FACT_MAX) : null);
const money = (value: unknown): string | null => (typeof value === "number" && Number.isFinite(value) ? `$${value}` : null);
const present = (facts: readonly (string | null)[]): readonly string[] => facts.filter((f): f is string => f !== null);

/** "5 emails: a@…, b@…, +3" from the batch recipient list; null when the payload has no list. */
function batchFacts(spec: ActionSpec): string | null {
  const batch = batchPayload(spec.payload);
  if (!batch?.recipients) return null;
  const shown = batch.recipients.slice(0, 2).map((r) => r.slice(0, FACT_MAX));
  const rest = batch.recipients.length - shown.length;
  return `${batch.recipients.length} emails: ${shown.join(", ")}${rest > 0 ? `, +${rest}` : ""}`;
}

/** "spent $11 of $10 today" / "spent $60 of $50 in total", then the campaign name (BUD-3). */
function capFacts(p: Record<string, unknown>): readonly string[] {
  const spent = money(p.spentUsd);
  const cap = money(p.capUsd);
  const scope = p.cap === "total" ? "in total" : "today";
  return present([spent && cap ? `spent ${spent} of ${cap} ${scope}` : null, text(p.campaignName) ? `campaign: ${text(p.campaignName)}` : null]);
}

/**
 * The load-bearing facts of the payload, so the CEO approves what will run and
 * not only the agent's sentence: recipient and subject for mail, daily budget
 * and audience for ads, name for deploys. Values are shown as text only.
 */
export function cardFacts(spec: ActionSpec): readonly string[] {
  const p = spec.payload ?? {};
  switch (spec.kind) {
    case "ads.start":
    case "ads.budget.change": {
      const daily = money(p.dailyBudgetUsd);
      return present([daily ? `${daily}/day` : null, text(p.audience) ? `audience: ${text(p.audience)}` : null, text(p.name) ? `campaign: ${text(p.name)}` : null]);
    }
    case "email.send.first_contact":
    case "email.send.reply":
    case "support.reply.template":
    case "support.reply.custom": {
      const batch = batchFacts(spec);
      return batch ? [batch] : present([text(p.to) ? `to ${text(p.to)}` : null, text(p.subject) ? `subject: ${text(p.subject)}` : null]);
    }
    case "deploy.preview":
    case "deploy.production":
      return present([text(p.name) ? `site: ${text(p.name)}` : null, text(p.url) ? `preview: ${text(p.url)}` : null]);
    case "spend.oneoff":
      return present([money(p.amountUsd) ? `${money(p.amountUsd)} once` : null, text(p.vendor) ? `to ${text(p.vendor)}` : null]);
    case "budget.cap.raise":
      return capFacts(p);
    default:
      return [];
  }
}

/** "This action spends money and would exceed the budget cap. Growth asks for it; tier K2. Details: $10/day, audience: …" */
export function cardRationale(spec: ActionSpec, tier: Tier, reasons: readonly GateReason[]): string {
  const phrases = reasons.map((r) => REASON_PHRASES[r]);
  const role = ROLE_WORDS[spec.agentRole] ?? spec.agentRole;
  const base = `This action ${joinPhrases(phrases)}. ${role} asks for it; tier ${tier}.`;
  const facts = cardFacts(spec);
  const full = facts.length > 0 ? `${base} Details: ${facts.join(", ")}.` : base;
  return full.length <= RATIONALE_MAX ? full : `${full.slice(0, RATIONALE_MAX - 1)}…`;
}

const QUESTION_MAX = 200;

/**
 * One question per card. A batch asks for the whole batch by count (the agent
 * cannot misstate it); a cap card asks the plan's question (its description
 * already is the question); everything else asks to approve the description.
 */
export function cardQuestion(spec: ActionSpec): string {
  const batch = batchPayload(spec.payload);
  const question =
    spec.kind === "email.send.first_contact" && batch?.recipients
      ? `Send ${batch.recipients.length} first-contact emails?`
      : spec.kind === "budget.cap.raise"
        ? spec.description
        : `Approve: ${spec.description}?`;
  return question.length <= QUESTION_MAX ? question : `${question.slice(0, QUESTION_MAX - 1)}…`;
}

/** Cards sharing a mergeKey are one decision: every send of a batch, or every card of a kind and category. */
function mergeKeyFor(spec: ActionSpec): string {
  const batch = batchPayload(spec.payload);
  return batch ? `batch:${batch.batchId}` : `${spec.kind}:${spec.category ?? "none"}`;
}

function cardFor(spec: ActionSpec, tier: Tier, reasons: readonly GateReason[], dueAt: string): CardDraft {
  const isK3 = tier === "K3";
  return Object.freeze({
    companyId: spec.companyId,
    question: cardQuestion(spec),
    options: [
      { id: "approve", label: "Approve" },
      { id: "decline", label: "Decline" },
    ],
    // BUD-3: a cap raise is recommended against; the campaign stays paused unless the CEO says otherwise.
    recommendedOptionId: spec.kind === "budget.cap.raise" ? "decline" : "approve",
    rationale: cardRationale(spec, tier, reasons),
    expectedImpact: null,
    costUsd: spec.amountUsd ?? 0,
    dueAt,
    // K3 never has a default; K2 defaults to the safe choice (decline).
    defaultOptionId: isK3 ? null : "decline",
    tier,
    actionKind: spec.kind,
    mergeKey: mergeKeyFor(spec),
  });
}

const frozen = (reasons: readonly GateReason[]): readonly GateReason[] => Object.freeze([...reasons]);

/**
 * The single chokepoint for external actions (ADR 0001, DEC-1).
 *
 * Order of checks: kill switch → classify → budget cap → auto rule → tier routing.
 */
export function gate(spec: ActionSpec, ctx: PolicyContext): GateDecision {
  const { tier: baseTier, reasons: baseReasons } = classify(spec);

  if (ctx.killSwitchActive) {
    return Object.freeze({ kind: "block", tier: baseTier, reasons: frozen([...baseReasons, "kill_switch"]) });
  }

  let tier = baseTier;
  const reasons: GateReason[] = [...baseReasons];

  const profile = spendProfile(spec);
  if (profile.totalUsd > 0) {
    const budget = budgetFor(spec, ctx.budgets);
    if (!budget || wouldExceedBudget(budget, profile)) {
      tier = tier === "K3" ? "K3" : "K2";
      reasons.push("budget_cap");
    }
  }

  if (tier === "K3") {
    return Object.freeze({ kind: "card", tier, reasons: frozen(reasons), card: cardFor(spec, tier, reasons, ctx.cardDueAt) });
  }

  if (tier === "K2") {
    const rule = reasons.includes("budget_cap") ? undefined : matchingAutoRule(spec, ctx.autoRules);
    if (rule) {
      return Object.freeze({ kind: "run", tier, reasons: frozen([...reasons, "auto_rule"]), autoRuleId: rule.id });
    }
    return Object.freeze({ kind: "card", tier, reasons: frozen(reasons), card: cardFor(spec, tier, reasons, ctx.cardDueAt) });
  }

  if (tier === "K1") {
    return Object.freeze({ kind: "notify", tier, reasons: frozen(reasons) });
  }

  return Object.freeze({ kind: "run", tier, reasons: frozen(reasons) });
}
