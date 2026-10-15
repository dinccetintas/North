-- M3 security review fixes (docs/plans/M3.md "Security review"):
--   * an owner can read their connections, record a sandbox one, and revoke;
--     a real (token-backed) connection is written only by the worker after the
--     OAuth exchange, so a row can never claim "connected" without a secret.

drop policy if exists connections_owner_all on public.connections;

create policy connections_owner_select on public.connections for select
  using (user_id = auth.uid());

-- Owners insert only sandbox-scoped rows (nothing runs live behind them).
create policy connections_owner_insert_sandbox on public.connections for insert
  with check (user_id = auth.uid() and 'sandbox' = any(scopes) and status = 'connected');

-- Owners update only to revoke, or to re-activate a sandbox row. A connected
-- row an owner has touched always carries the sandbox scope, so the live
-- adapters refuse it.
create policy connections_owner_update on public.connections for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (status = 'revoked' or ('sandbox' = any(scopes) and status = 'connected')));

revoke delete on public.connections from authenticated, anon;
