import { z } from "zod";
import type { BillingProvider } from "./billing-types";
import type { AdsProvider, AnalyticsProvider, OutreachMailProvider, PaymentsProvider } from "./growth-types";
import type { IntegrationMode } from "./mode";
import type { SignalSource } from "./signals-types";

/**
 * Provider contracts for everything that touches the outside world (ADR 0005).
 * Inputs are validated with Zod at the adapter boundary so neither sandbox nor
 * live code ever sees a malformed request.
 */

export const PROVIDERS = ["ads", "mail", "outreach", "analytics", "payments", "push", "code", "deploy", "images", "signals", "billing"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Ads, outreach, analytics and payments contracts (M4) live in growth-types.ts and are part of this module's surface. */
export * from "./growth-types";
/** Signal source contracts (M5, PRO-1) live in signals-types.ts and are part of this module's surface. */
export * from "./signals-types";
/** The platform's own billing contracts (M6, BIL-1, BIL-2) live in billing-types.ts and are part of this module's surface. */
export * from "./billing-types";

export const MAIL_KINDS = ["first_contact", "reply", "notification"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export const SendMailInputSchema = z.object({
  companyId: z.string().min(1),
  to: z.string().email(),
  subject: z.string().trim().min(1).max(998),
  text: z.string().min(1).max(100_000),
  kind: z.enum(MAIL_KINDS),
});
export type SendMailInput = z.input<typeof SendMailInputSchema>;

export interface SendMailResult {
  readonly messageId: string;
  readonly sandbox: boolean;
}

export interface MailProvider {
  send(input: SendMailInput): Promise<SendMailResult>;
}

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), { message: "push endpoints must use https" });

/** A browser push subscription as stored in `push_subscriptions`. */
export const PushSubscriptionSchema = z.object({
  endpoint: httpsUrl,
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
export type PushSubscription = z.input<typeof PushSubscriptionSchema>;

export const PushPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500),
  url: z.string().min(1).max(2048),
});
export type PushPayload = z.input<typeof PushPayloadSchema>;

export interface PushResult {
  readonly ok: boolean;
  readonly sandbox: boolean;
  /** Present only when `ok` is false. */
  readonly error?: string;
}

export interface PushProvider {
  send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult>;
}

/** A file to commit or deploy; paths are workspace-relative (validated by core's OutputFilesSchema upstream). */
export const RepoFileSchema = z.object({ path: z.string().min(1).max(200), content: z.string() });
export type RepoFile = z.input<typeof RepoFileSchema>;

const repoName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes");

export const EnsureRepoInputSchema = z.object({ companyId: z.string().min(1), name: repoName, private: z.boolean().default(true) });
export type EnsureRepoInput = z.input<typeof EnsureRepoInputSchema>;

export interface EnsureRepoResult {
  readonly repoId: string;
  /** `owner/name` on the host; `sandbox/<name>` in sandbox. */
  readonly fullName: string;
  readonly url: string;
  readonly created: boolean;
  readonly sandbox: boolean;
}

/** A git branch name as North writes them (`main`, `fix/<shortId>`): segments of letters, digits, `.`, `_`, `-`; no traversal, no spaces. */
const branchName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/, "branch: segments of letters, digits, '.', '_' or '-', none starting with '.'")
  .refine((value) => !value.includes(".."), { message: "branch must not contain '..'" });

/** The branch North pushes to when none is named; a fix pushes to `fix/<shortId>` and opens a pull request against it. */
export const DEFAULT_BRANCH = "main";

export const PushTreeInputSchema = z.object({
  companyId: z.string().min(1),
  fullName: z.string().min(3).max(200),
  /** Created from `main` when missing (`createBranchIfMissing` semantics); `main` itself is created on an empty repository. */
  branch: branchName.default(DEFAULT_BRANCH),
  message: z.string().trim().min(1).max(500),
  files: z.array(RepoFileSchema).min(1).max(200),
});
export type PushTreeInput = z.input<typeof PushTreeInputSchema>;

export interface PushTreeResult {
  readonly commitSha: string;
  readonly url: string;
  readonly sandbox: boolean;
}

/** PRO-2: the pull request a fix opens in the user's repository (`repo.pull_request`, K1); the user merges it themselves (EXP-1). */
export const OpenPullRequestInputSchema = z.object({
  companyId: z.string().min(1),
  fullName: z.string().min(3).max(200),
  head: branchName,
  base: branchName.default(DEFAULT_BRANCH),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
});
export type OpenPullRequestInput = z.input<typeof OpenPullRequestInputSchema>;

export interface OpenPullRequestResult {
  /** The PR page; `sandbox://repos/<owner>/<name>/pull/<n>` in sandbox. */
  readonly url: string;
  readonly number: number;
  readonly sandbox: boolean;
}

/** The user's own repository host (EXP-1: code lives in their GitHub). */
export interface CodeHostProvider {
  ensureRepo(input: EnsureRepoInput): Promise<EnsureRepoResult>;
  pushTree(input: PushTreeInput): Promise<PushTreeResult>;
  /** Opens a PR from `head` into `base`; an existing open PR for the pair is returned, never duplicated. */
  openPullRequest(input: OpenPullRequestInput): Promise<OpenPullRequestResult>;
}

export const DEPLOY_TARGETS = ["preview", "production"] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export const CreateDeploymentInputSchema = z.object({
  companyId: z.string().min(1),
  name: repoName,
  target: z.enum(DEPLOY_TARGETS).default("preview"),
  files: z.array(RepoFileSchema).min(1).max(200),
});
export type CreateDeploymentInput = z.input<typeof CreateDeploymentInputSchema>;

export const DEPLOYMENT_STATES = ["building", "ready", "error"] as const;
export type DeploymentState = (typeof DEPLOYMENT_STATES)[number];

export interface DeploymentResult {
  readonly deployId: string;
  /** Absolute URL the verifier fetches. */
  readonly url: string;
  readonly target: DeployTarget;
  readonly sandbox: boolean;
}

export interface DeployProvider {
  create(input: CreateDeploymentInput): Promise<DeploymentResult>;
  status(companyId: string, deployId: string): Promise<DeploymentState>;
}

/**
 * Per-user credentials for a live provider; null means "not connected" and the
 * live adapter refuses. Scopes travel in two shapes: `scope` is the single
 * value the M3 adapters read (Vercel team id, GitHub organisation); `scopes`
 * is the connection's full list (`connections.scopes`) for providers that
 * need more than one, read with `scopeValue(auth, prefix)`:
 * - Meta Ads: `act:<ad account id>` (required) and `page:<page id>` (creatives).
 * - Gmail: none; `account` is the connected mailbox address (reply counting),
 *   fetched from the profile when absent.
 */
export interface ProviderAuth {
  readonly token: string;
  /** Vercel team id or GitHub organisation; optional. */
  readonly scope?: string;
  /** Prefixed entries (`act:123`, `page:456`), as stored on the connection. */
  readonly scopes?: readonly string[];
  /** The connected account's address or label when an adapter needs it. */
  readonly account?: string;
}

export const ImageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  width: z.number().int().min(64).max(4096).default(1200),
  height: z.number().int().min(64).max(4096).default(630),
});
export type ImageRequest = z.input<typeof ImageRequestSchema>;

export interface ImageResult {
  /** A URL or data URI the artifact can embed. */
  readonly url: string;
  readonly sandbox: boolean;
}

export interface ImageProvider {
  generate(input: ImageRequest): Promise<ImageResult>;
}

/**
 * Everything the worker depends on, plus the mode they were selected for.
 * `ads`, `outreach`, `analytics`, `payments`, `code` and `deploy` are
 * factories because their credentials belong to the user (connections, ADR
 * 0010), not to the platform; sandbox ignores the auth argument. `mail`
 * (platform Resend) and `push` stay platform-configured: they only carry
 * decision notifications to the CEO. `signals` (M5) are keyless public reads
 * the worker's scan runs one by one; each entry is its own step. `billing`
 * (M6) is the platform's own Stripe account, where North is the merchant
 * (BIL-1): platform-configured, never the user's keys.
 */
export interface Integrations {
  readonly mode: IntegrationMode;
  readonly ads: (auth: ProviderAuth | null) => AdsProvider;
  readonly outreach: (auth: ProviderAuth | null) => OutreachMailProvider;
  readonly analytics: (auth: ProviderAuth | null) => AnalyticsProvider;
  readonly payments: (auth: ProviderAuth | null) => PaymentsProvider;
  readonly mail: MailProvider;
  readonly push: PushProvider;
  readonly images: ImageProvider;
  readonly code: (auth: ProviderAuth | null) => CodeHostProvider;
  readonly deploy: (auth: ProviderAuth | null) => DeployProvider;
  readonly signals: readonly SignalSource[];
  readonly billing: BillingProvider;
}

/** What a sandbox adapter records instead of calling a real service. */
export interface SandboxEvent {
  readonly provider: Provider;
  readonly op: string;
  /** Null when the operation has no company (push goes to a user). */
  readonly companyId: string | null;
  readonly ref: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly at: string;
}

/** Receives every sandbox event; may be async. The worker writes them to the audit trail. */
export type SandboxSink = (event: SandboxEvent) => void | Promise<void>;
