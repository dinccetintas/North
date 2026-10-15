-- M5 security review fixes (docs/plans/M5.md "Security review"):
--   * M4: companies.sentry_project_slug was writable through the owner's
--     companies_owner_all policy, so any owner could claim any Sentry project
--     slug first (a squat) and the webhook would route that project's issues
--     to them. Until a Sentry connection proves ownership (M6), the slug is a
--     claim only the worker (service role) may write.
--
-- Mirrors 0006 (decision_cards): the table-level update privilege goes away
-- for signed-in users and comes back column by column. Every column the owner
-- edits today is listed; a column added later is owner-writable only when a
-- migration grants it (fail closed). The owner policy itself is unchanged.
revoke update on public.companies from authenticated, anon;
grant update (name, slug, status, kill_switch_active, public_page_enabled, onboarding_step)
  on public.companies to authenticated;

comment on column public.companies.sentry_project_slug is
  'The Sentry project whose issues become fix tasks (PRO-2). A claim until a Sentry connection proves it (M6); written by the worker only (0011, M5 review M4).';
