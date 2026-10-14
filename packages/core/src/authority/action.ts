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
  "repo.create",
  "repo.push",
  "deploy.preview",
  "deploy.production",
  "email.send.first_contact",
  "email.send.reply",
  "support.reply.template",
  "support.reply.custom",
  "ads.start",
  "ads.budget.change",
  "ads.pause",
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
  "repo.create": flags({ externalEffect: true }),
  "repo.push": flags({ externalEffect: true }),
  "deploy.preview": flags({ externalEffect: true }),
  "deploy.production": flags({ externalEffect: true, goesLive: true }),
  "email.send.first_contact": flags({ externalEffect: true, reversible: false, newContact: true }),
  "email.send.reply": flags({ externalEffect: true, reversible: false }),
  "support.reply.template": flags({ externalEffect: true, reversible: false }),
  "support.reply.custom": flags({ externalEffect: true, reversible: false, publicStatement: true }),
  "ads.start": flags({ externalEffect: true, spendsMoney: true, publicStatement: true }),
  "ads.budget.change": flags({ externalEffect: true, spendsMoney: true }),
  "ads.pause": flags({ externalEffect: true }),
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
const SPENDING_KINDS: ReadonlySet<ActionKind> = new Set(["ads.start", "ads.budget.change", "spend.oneoff"]);

/** The spend an adapter would execute, read from the payload (`dailyBudgetUsd` or `amountUsd`), or null. */
export function payloadSpendUsd(kind: ActionKind, payload: Record<string, unknown> | undefined): number | null {
  if (!SPENDING_KINDS.has(kind) || !payload) return null;
  const candidates = [payload.dailyBudgetUsd, payload.amountUsd, payload.budgetUsd].filter((v): v is number => typeof v === "number");
  return candidates.length === 0 ? null : Math.max(...candidates);
}

export const ActionSpecSchema = z
  .object({
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
  })
  .refine(
    (spec) => {
      const spend = payloadSpendUsd(spec.kind, spec.payload);
      return spend === null || (spec.amountUsd !== undefined && spend <= spec.amountUsd);
    },
    { message: "payload spend must not exceed the gated amountUsd", path: ["amountUsd"] },
  );
export type ActionSpec = z.infer<typeof ActionSpecSchema>;
