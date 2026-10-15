import { z } from "zod";
import { TIERS } from "../tiers";

/**
 * Every action an agent can take on the outside world, by kind.
 *
 * The kind carries default risk flags (see ACTION_PROFILES). Payload-level facts
 * (amount, category) can only make an action riskier.
 */
export const ACTION_KINDS = [
  "research",
  "draft",
  "artifact.write",
  "memory.write",
  "signal.pursue",
  "repo.create",
  "repo.push",
  "repo.pull_request",
  "deploy.preview",
  "deploy.production",
  "email.send.first_contact",
  "email.send.reply",
  "support.reply.template",
  "support.reply.custom",
  "ads.start",
  "ads.budget.change",
  "ads.pause",
  "ads.resume",
  "budget.cap.raise",
  "social.publish",
  "content.publish.approved",
  "price.change",
  "spend.oneoff",
  "contract.sign",
  "payment_account.change",
  "data.delete",
  "domain.transfer",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const BUDGET_CATEGORIES = ["ads", "tools", "domain", "other"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const RiskFlagsSchema = z.object({
  externalEffect: z.boolean(),
  reversible: z.boolean(),
  spendsMoney: z.boolean(),
  publicStatement: z.boolean(),
  newContact: z.boolean(),
  goesLive: z.boolean(),
  irreversible: z.boolean(),
  legallyBinding: z.boolean(),
});
export type RiskFlags = z.infer<typeof RiskFlagsSchema>;

const flags = (overrides: Partial<RiskFlags>): RiskFlags => ({
  externalEffect: false,
  reversible: true,
  spendsMoney: false,
  publicStatement: false,
  newContact: false,
  goesLive: false,
  irreversible: false,
  legallyBinding: false,
  ...overrides,
});

/** Default risk profile per action kind. Payload facts may only add risk. */
export const ACTION_PROFILES: Readonly<Record<ActionKind, RiskFlags>> = Object.freeze({
  research: flags({}),
  draft: flags({}),
  "artifact.write": flags({}),
  "memory.write": flags({}),
  /** PRO-1: converting a signal creates a research task and nothing outside; the worker asks for K2 so a card opens. */
  "signal.pursue": flags({}),
  "repo.create": flags({ externalEffect: true }),
  "repo.push": flags({ externalEffect: true }),
  /** PRO-2: a pull request in the user's repository; reversible, spends nothing, so K1 (notify). */
  "repo.pull_request": flags({ externalEffect: true }),
  "deploy.preview": flags({ externalEffect: true }),
  "deploy.production": flags({ externalEffect: true, goesLive: true }),
  "email.send.first_contact": flags({ externalEffect: true, reversible: false, newContact: true }),
  "email.send.reply": flags({ externalEffect: true, reversible: false }),
  "support.reply.template": flags({ externalEffect: true, reversible: false }),
  "support.reply.custom": flags({ externalEffect: true, reversible: false, publicStatement: true }),
  "ads.start": flags({ externalEffect: true, spendsMoney: true, publicStatement: true }),
  "ads.budget.change": flags({ externalEffect: true, spendsMoney: true }),
  "ads.pause": flags({ externalEffect: true }),
  "ads.resume": flags({ externalEffect: true }),
  /** BUD-3: raising a cap lets a paused campaign spend again; the raise is the amount gated. */
  "budget.cap.raise": flags({ externalEffect: true, spendsMoney: true }),
  "social.publish": flags({ externalEffect: true, reversible: false, publicStatement: true }),
  "content.publish.approved": flags({ externalEffect: true }),
  "price.change": flags({ externalEffect: true, publicStatement: true }),
  "spend.oneoff": flags({ externalEffect: true, spendsMoney: true }),
  "contract.sign": flags({ externalEffect: true, reversible: false, irreversible: true, legallyBinding: true }),
  "payment_account.change": flags({ externalEffect: true, reversible: false, irreversible: true, legallyBinding: true }),
  "data.delete": flags({ externalEffect: true, reversible: false, irreversible: true }),
  "domain.transfer": flags({ externalEffect: true, reversible: false, irreversible: true }),
});

/** Action kinds whose payload carries a spend figure the adapter would act on. */
const SPENDING_KINDS: ReadonlySet<ActionKind> = new Set(["ads.start", "ads.budget.change", "spend.oneoff", "budget.cap.raise"]);

/** Kinds whose spend runs per day (`payload.dailyBudgetUsd`) for as long as `amountUsd` lasts. */
const DAILY_KINDS: ReadonlySet<ActionKind> = new Set(["ads.start", "ads.budget.change"]);

/** Kinds that cannot be gated without a budget category. */
const CATEGORY_REQUIRED: ReadonlySet<ActionKind> = new Set(["budget.cap.raise"]);

type Payload = Record<string, unknown> | undefined;

/** The spend an adapter would execute, read from the payload (`dailyBudgetUsd` or `amountUsd`), or null. */
export function payloadSpendUsd(kind: ActionKind, payload: Payload): number | null {
  if (!SPENDING_KINDS.has(kind) || !payload) return null;
  const candidates = [payload.dailyBudgetUsd, payload.amountUsd, payload.budgetUsd].filter((v): v is number => typeof v === "number");
  return candidates.length === 0 ? null : Math.max(...candidates);
}

/** BUD-1: what an action spends per day and in total, each checked against its own cap. */
export interface SpendProfile {
  readonly perDayUsd: number;
  readonly totalUsd: number;
}

/**
 * Per-day from `payload.dailyBudgetUsd` and total from `amountUsd` for ads;
 * both equal `amountUsd` for one-off spends, cap raises and anything else that
 * declares an amount. Without a daily figure the whole amount counts against
 * today: the gate never assumes a slower pace than the agent stated.
 */
export function spendProfile(spec: { readonly kind: ActionKind; readonly amountUsd?: number | undefined; readonly payload?: Payload }): SpendProfile {
  const totalUsd = spec.amountUsd ?? 0;
  const daily = spec.payload?.dailyBudgetUsd;
  const perDayUsd = DAILY_KINDS.has(spec.kind) && typeof daily === "number" ? Math.min(daily, totalUsd) : totalUsd;
  return Object.freeze({ perDayUsd, totalUsd });
}

export const MAX_BATCH_SIZE = 50;

/**
 * SLS-K2 batch payload for `email.send.first_contact`: every send of one
 * outreach batch carries the same `batchId` (so the gate opens one card and
 * the worker reuses it) and, optionally, the full recipient list, so the first
 * action can show "5 emails: a@…, b@…, +3" on the card. Other keys (`to`,
 * `subject`, `text`, `leadId`) pass through untouched.
 */
export const BatchPayloadSchema = z
  .object({
    batchId: z.string().min(1).max(64),
    recipients: z.array(z.email().max(254)).min(1).max(MAX_BATCH_SIZE).optional(),
  })
  .loose();
export type BatchPayload = z.infer<typeof BatchPayloadSchema>;

/** The batch facts the gate reads: the id, and the recipient list when the payload carries one. */
export interface BatchFacts {
  readonly batchId: string;
  readonly recipients?: readonly string[];
}

/** The batch facts of a payload, or null when it carries no `batchId` (or an invalid one). */
export function batchPayload(payload: Payload): BatchFacts | null {
  if (!payload || payload.batchId === undefined) return null;
  const parsed = BatchPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { batchId, recipients } = parsed.data;
  return Object.freeze(recipients ? { batchId, recipients: Object.freeze([...recipients]) } : { batchId });
}

const BaseActionSpecSchema = z.object({
  kind: z.enum(ACTION_KINDS),
  companyId: z.string().min(1),
  agentRole: z.string().min(1),
  description: z.string().min(1).max(500),
  amountUsd: z.number().nonnegative().optional(),
  category: z.enum(BUDGET_CATEGORIES).optional(),
  /** Agents may only raise the tier; a lower value is ignored. */
  requestedTier: z.enum(TIERS).optional(),
  /** Free-form payload the adapter needs; the engine only checks it never spends more than `amountUsd`. */
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const ActionSpecSchema = BaseActionSpecSchema.superRefine((spec, ctx) => {
  const spend = payloadSpendUsd(spec.kind, spec.payload);
  if (spend !== null && (spec.amountUsd === undefined || spend > spec.amountUsd)) {
    ctx.addIssue({ code: "custom", message: "payload spend must not exceed the gated amountUsd", path: ["amountUsd"] });
  }
  if (CATEGORY_REQUIRED.has(spec.kind) && spec.category === undefined) {
    ctx.addIssue({ code: "custom", message: `${spec.kind} requires a budget category`, path: ["category"] });
  }
  if (spec.kind === "email.send.first_contact" && spec.payload?.batchId !== undefined) {
    const batch = BatchPayloadSchema.safeParse(spec.payload);
    if (!batch.success) ctx.addIssue({ code: "custom", message: "invalid batch payload: batchId is 1-64 chars, recipients are emails", path: ["payload"] });
  }
});
export type ActionSpec = z.infer<typeof ActionSpecSchema>;
