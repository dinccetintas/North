import { z } from "zod";
import { OUTCOME_METRIC_KEYS, type OutcomeMetricKey } from "./tasks/types";
import { sanitizeText } from "./text";

/**
 * PUB-1: a company's public page shows only what the owner chose, every
 * string as text, nothing that links into the app. Anonymous readers get it
 * through `public_page_view(slug)` (security definer), never a table; the
 * web parses that result with `PublicPageViewSchema` and renders text nodes.
 */
export const PUBLIC_HEADLINE_MAX = 120;
export const PUBLIC_BLURB_MAX = 600;
export const PUBLIC_METRICS_MAX = 3;
const NAME_MAX = 200;

const OutcomeKey = z.enum(OUTCOME_METRIC_KEYS);
const isOutcomeKey = (value: string): value is OutcomeMetricKey => (OUTCOME_METRIC_KEYS as readonly string[]).includes(value);

const text = (max: number) => z.string().transform(sanitizeText).pipe(z.string().max(max));

/** What the owner writes (`public_pages`); `companies.public_page_enabled` is the switch, off by default. */
export const PublicPageSchema = z.object({
  headline: text(PUBLIC_HEADLINE_MAX),
  blurb: text(PUBLIC_BLURB_MAX),
  showGoal: z.boolean(),
  metricKeys: z
    .array(OutcomeKey)
    .max(PUBLIC_METRICS_MAX)
    .refine((keys) => new Set(keys).size === keys.length, { message: "duplicate metric key" }),
  showSiteLink: z.boolean(),
  /** Indexable; `noindex` until the owner ticks it. */
  listed: z.boolean().default(false),
});
export type PublicPage = z.infer<typeof PublicPageSchema>;

const isHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
};

const PublicGoal = z.object({ metricKey: OutcomeKey, target: z.number(), current: z.number() });

/** What `public_page_view` returns and the page renders. */
export const PublicPageViewSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  headline: z.string().max(PUBLIC_HEADLINE_MAX),
  blurb: z.string().max(PUBLIC_BLURB_MAX),
  goal: PublicGoal.nullable(),
  metrics: z.array(z.object({ key: OutcomeKey, value: z.number() })).max(PUBLIC_METRICS_MAX),
  siteUrl: z.string().max(2048).refine(isHttpsUrl, { message: "https URL without credentials" }).nullable(),
  listed: z.boolean(),
});
export type PublicPageView = z.infer<typeof PublicPageViewSchema>;

/** The raw facts: the company, its page row, its goal, the latest metric samples and the site URL. Structural, so rows need no cast. */
export interface PublicPageViewInput {
  readonly name: string;
  readonly page: {
    readonly headline: string;
    readonly blurb: string;
    readonly showGoal: boolean;
    readonly metricKeys: readonly string[];
    readonly showSiteLink: boolean;
    readonly listed: boolean;
  };
  readonly goal: { readonly metricKey: string; readonly target: number; readonly current: number } | null;
  readonly metrics: readonly { readonly key: string; readonly value: number }[];
  readonly siteUrl: string | null;
}

const clean = (value: string, max: number): string => sanitizeText(value).slice(0, max);

function chosenMetrics(input: PublicPageViewInput): PublicPageView["metrics"] {
  const keys = [...new Set(input.page.metricKeys.filter(isOutcomeKey))].slice(0, PUBLIC_METRICS_MAX);
  return keys.flatMap((key) => {
    const sample = input.metrics.find((m) => m.key === key);
    return sample ? [Object.freeze({ key, value: sample.value })] : [];
  });
}

/**
 * Pure: the view from the facts. Strings go through `sanitizeText` (markup such
 * as `<b>` stays and renders as text; prompt delimiters go), the goal and the
 * site link only when chosen, the site URL only when https, at most three
 * metrics in the owner's order.
 */
export function publicPageView(input: PublicPageViewInput): PublicPageView {
  const goal = input.page.showGoal && input.goal !== null && isOutcomeKey(input.goal.metricKey) ? Object.freeze({ metricKey: input.goal.metricKey, target: input.goal.target, current: input.goal.current }) : null;
  const siteUrl = input.page.showSiteLink && input.siteUrl !== null && isHttpsUrl(input.siteUrl) ? input.siteUrl : null;
  return Object.freeze({
    name: clean(input.name, NAME_MAX),
    headline: clean(input.page.headline, PUBLIC_HEADLINE_MAX),
    blurb: clean(input.page.blurb, PUBLIC_BLURB_MAX),
    goal,
    metrics: chosenMetrics(input),
    siteUrl,
    listed: input.page.listed,
  });
}
