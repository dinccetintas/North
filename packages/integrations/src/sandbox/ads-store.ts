import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AdDeliverySchema, type AdDelivery } from "@north/core";
import { z } from "zod";
import { TargetingSchema } from "../growth-types";
import { safeJoin } from "./files";

/**
 * On-disk shape of a sandbox campaign: `<root>/ads/<campaignId>.json` next to
 * `<campaignId>.deliveries.jsonl`. Files, not memory, so the worker's cron,
 * the simulation routes and the smoke script all see the same campaigns.
 */
export const SANDBOX_CAMPAIGN_STATUSES = ["active", "paused", "ended"] as const;
export type SandboxCampaignStatus = (typeof SANDBOX_CAMPAIGN_STATUSES)[number];

export const SandboxCampaignSchema = z.object({
  campaignId: z.string().min(1),
  companyId: z.string().min(1),
  name: z.string().min(1),
  dailyBudgetUsd: z.number().nonnegative(),
  audience: z.string(),
  targeting: TargetingSchema,
  landingUrl: z.string().optional(),
  status: z.enum(SANDBOX_CAMPAIGN_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SandboxCampaign = z.infer<typeof SandboxCampaignSchema>;

export const DELIVERY_SOURCES = ["manual", "pace"] as const;

/** One line of the deliveries log: a delivery, when it was recorded and whether a route or the pacer wrote it. */
export const DeliveryLineSchema = AdDeliverySchema.extend({ at: z.string(), source: z.enum(DELIVERY_SOURCES) });
export type DeliveryLine = z.infer<typeof DeliveryLineSchema>;

const ID = /^[A-Za-z0-9:._-]{1,120}$/;
const CAMPAIGN_SUFFIX = ".json";
const DELIVERIES_SUFFIX = ".deliveries.jsonl";

export const isCampaignFileName = (name: string): boolean => name.endsWith(CAMPAIGN_SUFFIX) && !name.endsWith(DELIVERIES_SUFFIX);

/** File store for sandbox campaigns under `<root>/ads`; every path goes through `safeJoin`. */
export class AdsStore {
  readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, "ads");
  }

  private campaignPath(campaignId: string): string | null {
    return ID.test(campaignId) ? safeJoin(this.dir, `${campaignId}${CAMPAIGN_SUFFIX}`) : null;
  }

  private deliveriesPath(campaignId: string): string | null {
    return ID.test(campaignId) ? safeJoin(this.dir, `${campaignId}${DELIVERIES_SUFFIX}`) : null;
  }

  async write(campaign: SandboxCampaign): Promise<void> {
    const path = this.campaignPath(campaign.campaignId);
    if (!path) throw new Error(`Invalid campaign id ${campaign.campaignId}`);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, JSON.stringify(SandboxCampaignSchema.parse(campaign), null, 2), "utf8");
  }

  /** The campaign, or null when the id is malformed, missing or unreadable. */
  async read(campaignId: string): Promise<SandboxCampaign | null> {
    const path = this.campaignPath(campaignId);
    if (!path) return null;
    try {
      const parsed = SandboxCampaignSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
      return parsed.success ? Object.freeze(parsed.data) : null;
    } catch {
      return null;
    }
  }

  /** Every campaign under the root (any company); callers filter. */
  async list(): Promise<readonly SandboxCampaign[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return Object.freeze([]);
    }
    const ids = names.filter(isCampaignFileName).map((n) => n.slice(0, -CAMPAIGN_SUFFIX.length));
    const campaigns = await Promise.all(ids.map((id) => this.read(id)));
    return Object.freeze(campaigns.filter((c): c is SandboxCampaign => c !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  async appendDelivery(campaignId: string, delivery: AdDelivery, source: (typeof DELIVERY_SOURCES)[number], at: string): Promise<DeliveryLine> {
    const path = this.deliveriesPath(campaignId);
    if (!path) throw new Error(`Invalid campaign id ${campaignId}`);
    const line: DeliveryLine = Object.freeze({ ...AdDeliverySchema.parse(delivery), at, source });
    await mkdir(this.dir, { recursive: true });
    await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
    return line;
  }

  /** The delivery log in order; malformed lines are skipped, a missing log is empty. */
  async deliveries(campaignId: string): Promise<readonly DeliveryLine[]> {
    const path = this.deliveriesPath(campaignId);
    if (!path) return Object.freeze([]);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return Object.freeze([]);
    }
    const lines = text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return DeliveryLineSchema.safeParse(JSON.parse(l));
        } catch {
          return null;
        }
      });
    return Object.freeze(lines.flatMap((p) => (p?.success ? [Object.freeze(p.data)] : [])));
  }
}

/** Sum of a delivery log; zeros for an empty one. */
export function sumDeliveries(lines: readonly AdDelivery[]): AdDelivery {
  return Object.freeze(
    lines.reduce(
      (acc, d) => ({ spendUsd: acc.spendUsd + d.spendUsd, impressions: acc.impressions + d.impressions, clicks: acc.clicks + d.clicks, conversions: acc.conversions + d.conversions }),
      { spendUsd: 0, impressions: 0, clicks: 0, conversions: 0 },
    ),
  );
}
