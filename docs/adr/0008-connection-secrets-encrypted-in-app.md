# ADR 0008: Connection tokens are encrypted by the app, readable by the worker only

Status: accepted (2026-10-14)

## Context

ONB-3 connects the user's GitHub, Vercel, Gmail, Stripe and Meta accounts by
OAuth. The tokens must never reach the browser, an agent subprocess or a log,
and the local stacks (Supabase CLI in Docker, and the Docker-free stack in
`scripts/stack`) must be able to run the same code. Supabase Vault would do
the encryption, but it is a platform extension that the Docker-free stack
cannot provide, and its secrets are readable by any role with `vault` access.

## Decision

Tokens are encrypted in the worker with AES-256-GCM under
`CONNECTIONS_ENCRYPTION_KEY` (32 bytes, base64; generated once per
environment, held as a Fly secret) and stored in `connection_secrets`
(`connection_id`, `ciphertext`, `iv`, `tag`). The table has RLS enabled and
**no policies**, so only the service role can read or write it; `connections`
keeps the owner-visible metadata (provider, status, scopes, account label).

The web app holds only the providers' public ids. Its OAuth callback checks
the CSRF state (bound to the provider and the signed-in user) and forwards the
one-time code to the worker as `connection/oauth_code`; the worker, which
alone has the client secrets and the encryption key, exchanges the code,
writes the `connections` row as `error`, stores the ciphertext, then flips the
row to `connected`. A row therefore never says "connected" without a secret
behind it. The worker decrypts only inside the integrations adapters, and the
plaintext is never passed to an agent (the subprocess env allow-list excludes
it). Under RLS an owner may read their rows, record a sandbox-scoped row
(usable by the sandbox adapters only) and revoke; a token-backed row cannot be
inserted or edited into existence by the owner (migration 0007).

Revoking marks the row and emits `connection/revoked`; the worker revokes the
token at the provider where an API exists (GitHub) and drops the ciphertext.
An hourly sweep drops any secret whose row is no longer `connected`.

Key rotation: re-encrypt rows with the new key in a migration script; a
wrong key fails closed (`ConnectionSecretError`) and the task opens a connect
card rather than guessing.

## Consequences

- One more secret to provision per environment; `.env.example` documents it.
- The hosted Supabase Vault remains an option later by swapping the
  `secrets.ts` module; the interface (`storeConnectionSecret`,
  `readConnectionSecret`) does not change.
- Integration tests can prove the invariant: an owner's client sees zero rows
  in `connection_secrets`.
