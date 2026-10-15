/**
 * Company states shared by the web, the worker and the database checks.
 * `status` is the row's lifecycle (`archived` only through the retention
 * sweep); `paused_reason` says who set the kill switch and whether the owner
 * may lift it.
 */
export const COMPANY_STATUSES = ["active", "paused", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/**
 * `companies.paused_reason` (ADR 0014): `user` is the kill-switch button and
 * resumes on the owner's click; `subscription_ended` is set by billing and
 * refuses resume until a subscription is active again; `retention` is the
 * sweep's archive. Billing never touches a `user` pause.
 */
export const PAUSED_REASONS = ["user", "subscription_ended", "retention"] as const;
export type PausedReason = (typeof PAUSED_REASONS)[number];
