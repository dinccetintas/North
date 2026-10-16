/**
 * EXP-1 (ADR 0016): what `data/<company-slug>/` holds. One JSON file per
 * table the owner can read under RLS (`companies_owner_all`,
 * `*_owner_select`), with the owner-visible columns listed explicitly; a few
 * internal ones are left out on purpose: `memory_items.embedding` and
 * `search` (a derived index), `artifacts.storage_path` (the files themselves
 * are in `artifacts/`). The six CSVs (`EXPORT_CSV_TABLES`) carry the same
 * columns. Never the secrets (`connection_secrets`), never another owner's rows.
 * The free-text columns in `long` are read as `column::export_text`, cut at
 * `EXPORT_TEXT_MAX_CHARS` by the database (M6 review M4), so one oversized
 * value never reaches the worker whole.
 */
export interface ExportTable {
  /** The file name under `data/<slug>/` (and the CSV's for the six). */
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  /** Stable paging: the columns to order by, ascending. */
  readonly order: readonly string[];
  /** Free-text columns cut in the select (`::export_text`). */
  readonly long?: readonly string[];
}

const byCreated = ["created_at", "id"] as const;

export const COMPANY_TABLES: readonly ExportTable[] = Object.freeze([
  { name: "theses", table: "theses", columns: ["id", "version", "text", "target_customer", "why_now", "clarifications", "created_at"], order: ["version", "id"], long: ["text", "target_customer", "why_now"] },
  { name: "goals", table: "goals", columns: ["id", "metric_key", "target_value", "due_date", "status", "created_at"], order: byCreated },
  { name: "budgets", table: "budgets", columns: ["id", "category", "currency", "total_limit_usd", "daily_limit_usd", "spent_total_usd", "spent_today_usd", "spent_today_date", "daily_extra_usd", "daily_extra_date"], order: ["category", "id"] },
  { name: "agents", table: "agents", columns: ["id", "role", "enabled", "max_action_tier", "config_ref"], order: ["role", "id"] },
  { name: "plans", table: "plans", columns: ["id", "goal_id", "week_start", "status", "summary", "rationale", "revisions", "created_at"], order: byCreated, long: ["summary", "rationale"] },
  {
    name: "tasks",
    table: "tasks",
    columns: ["id", "plan_id", "agent_id", "role", "task_type", "title", "status", "input", "output_summary", "result", "evidence", "metric_key", "expected_delta", "cost_usd", "attempts", "last_error", "created_at", "updated_at"],
    order: byCreated,
    long: ["title", "output_summary", "last_error"],
  },
  {
    name: "decision_cards",
    table: "decision_cards",
    columns: ["id", "task_id", "action_id", "action_kind", "tier", "question", "rationale", "options", "recommended_option_id", "default_option_id", "expected_impact", "cost_usd", "opened_at", "due_at", "day", "seq", "answered_option_id", "answered_at", "answered_by", "merge_key", "created_at"],
    order: byCreated,
    long: ["rationale", "expected_impact"],
  },
  { name: "auto_rules", table: "auto_rules", columns: ["id", "kind", "category", "max_amount_usd", "active", "created_from_card_id", "created_at"], order: byCreated },
  { name: "actions", table: "actions", columns: ["id", "task_id", "agent_role", "kind", "tier", "description", "payload", "status", "external_ref", "decision_card_id", "auto_rule_id", "sandbox", "supersedes", "created_at"], order: byCreated, long: ["description", "external_ref"] },
  {
    name: "signals",
    table: "signals",
    columns: ["id", "source", "source_ref", "kind", "status", "title", "summary", "url", "excerpt", "evidence_urls", "score", "rationale", "payload", "observed_at", "scored_at", "card_week", "converted_card_id", "converted_task_id", "created_at", "updated_at"],
    order: byCreated,
    long: ["title", "summary", "url", "excerpt", "rationale"],
  },
  { name: "metrics", table: "metrics", columns: ["id", "metric_key", "value", "source", "scope", "provenance", "provenance_key", "window_end", "measured_at"], order: ["measured_at", "id"] },
  { name: "ledger", table: "ledger_entries", columns: ["id", "task_id", "metric_key", "before_value", "after_value", "cost_usd", "channel", "attribution_note", "provenance", "campaign_id", "action_id", "created_at"], order: byCreated, long: ["attribution_note"] },
  { name: "memory", table: "memory_items", columns: ["id", "kind", "title", "content", "created_by_role", "created_at"], order: byCreated, long: ["content"] },
  { name: "artifacts", table: "artifacts", columns: ["id", "kind", "title", "version", "created_by_role", "created_at"], order: byCreated, long: ["title"] },
  { name: "briefs", table: "briefs", columns: ["id", "brief_date", "content", "word_count", "created_at"], order: byCreated },
  {
    name: "agent_runs",
    table: "agent_runs",
    columns: ["id", "task_id", "role", "model", "runtime", "status", "input_tokens", "output_tokens", "cost_usd", "duration_ms", "error", "session_id", "trace_id", "created_at"],
    order: byCreated,
    long: ["error"],
  },
  { name: "tool_calls", table: "audit_tool_calls", columns: ["id", "task_id", "agent_run_id", "tool_name", "input", "decision", "created_at"], order: byCreated },
  {
    name: "campaigns",
    table: "campaigns",
    columns: [
      "id",
      "action_id",
      "task_id",
      "provider",
      "provider_campaign_id",
      "name",
      "channel",
      "metric_key",
      "status",
      "daily_budget_usd",
      "total_budget_usd",
      "spent_today_usd",
      "spent_total_usd",
      "impressions",
      "clicks",
      "conversions",
      "landing_url",
      "paused_day",
      "last_collected_at",
      "last_error",
      "sandbox",
      "created_at",
      "updated_at",
    ],
    order: byCreated,
    long: ["name", "landing_url", "last_error"],
  },
  { name: "leads", table: "leads", columns: ["id", "name", "email", "company_name", "why", "source", "status", "batch_id", "message_id", "created_at", "updated_at"], order: byCreated },
  { name: "notifications", table: "notifications", columns: ["id", "kind", "channel", "status", "card_id", "payload", "created_at"], order: byCreated },
  { name: "public_page", table: "public_pages", columns: ["headline", "blurb", "show_goal", "metric_keys", "show_site_link", "listed", "created_at", "updated_at"], order: ["created_at"] },
]);

/** The company row itself (`company.json`). */
export const COMPANY_COLUMNS: readonly string[] = Object.freeze(["id", "name", "slug", "status", "kill_switch_active", "paused_reason", "onboarding_step", "public_page_enabled", "sentry_project_slug", "archived_at", "created_at", "updated_at"]);

/** `data/profile.json`: the owner's own rows, keyed by `user_id` (the profile by `id`). Connections without their secrets. */
export const PROFILE_TABLES: readonly (ExportTable & { readonly key: "id" | "user_id" })[] = Object.freeze([
  { name: "profile", table: "users", key: "id", columns: ["id", "email", "timezone", "daily_decision_quota", "brief_hour", "plan", "created_at"], order: ["id"] },
  {
    name: "entitlement",
    table: "entitlements",
    key: "user_id",
    columns: ["plan_id", "status", "company_limit", "monthly_credits", "price_usd", "period_start", "period_end", "cancel_at", "ended_at", "retention_until", "purge_due", "stripe_customer_id", "stripe_subscription_id", "created_at", "updated_at"],
    order: ["user_id"],
  },
  { name: "credit_entries", table: "credit_entries", key: "user_id", columns: ["id", "kind", "amount", "ref", "note", "created_at"], order: byCreated },
  { name: "usage", table: "usage", key: "user_id", columns: ["period", "credits_used", "llm_cost_usd", "sandbox_minutes", "alerted_at", "updated_at"], order: ["period", "id"] },
  { name: "connections", table: "connections", key: "user_id", columns: ["id", "provider", "status", "account_label", "scopes", "created_at", "updated_at"], order: byCreated },
]);
