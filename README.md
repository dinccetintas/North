# North

The operating system for a one-person company. You are the CEO; AI agents are the
staff. State a thesis, a goal and a budget, then run the company by answering at
most three decision cards a day. Every agent action is tied to a metric, gated by
an authority tier, written to an immutable ledger, and stoppable with one button.

Start here:

- `docs/SPEC.md`: the founder's product and build specification (requirement IDs, the
  Faz 2 table included).
- `docs/superpowers/specs/2026-10-14-north-architecture-design.md`: architecture.
- `docs/superpowers/specs/2026-10-16-north-studio-phase-design.md`: the studio phase
  (Faz 2, M7 onwards): departments, testing tiers, staging, new requirement IDs.
- `docs/research/polsia-teardown.md`: what the reference product does and where it fails.
- `docs/plans/M0.md` … `M7.md`: milestone plans with acceptance tests.
- `CONTEXT.md`: glossary. `docs/adr/`: decisions. `agents/`: product roles.

Development (after M0 lands):

```bash
pnpm install
pnpm db:start        # local Supabase in Docker
pnpm dev             # web (3100) + worker (3101) + Inngest Dev Server (8288)
pnpm validate        # typecheck, lint, unit, integration, smoke
pnpm e2e             # Playwright
```

Without Docker (cloud sessions): `scripts/stack/up.sh --reset` runs the same
stack on a plain PostgreSQL 16 (GoTrue, PostgREST, storage API, Mailpit behind
a gateway on :54321), writes the keys to `.stack/env`, and `source .stack/env`
makes `pnpm test:integration`, `pnpm smoke:m1`, `pnpm smoke:m2`, `pnpm smoke:m3`
and `pnpm e2e` work unchanged. Binaries live under `$NORTH_STACK_TOOLS` (see the
script header); `scripts/stack/down.sh` stops it.

Connections (M3): the engineering agent builds the landing page, pushes it to a
repository and deploys a preview; going live is a decision card. In sandbox mode
(the default) the repository and the sites live under the worker's
`SANDBOX_ROOT`, served at `http://127.0.0.1:3101/sandbox/sites/…`, and
Settings → Connections offers "Connect (sandbox)". For live mode the founder
creates a GitHub OAuth app and a Vercel integration, puts the public ids in the
web env and the secrets plus `CONNECTIONS_ENCRYPTION_KEY` in the worker env
(`.env.example`), and connects both accounts from Settings → Connections. The
token is exchanged and encrypted inside the worker; the web app never sees it.

Staging (M7, STG-1, ADR 0017): production's topology with its own accounts: the
Vercel `staging` environment, the Fly app `north-worker-staging`
(`apps/worker/fly.staging.toml`), the Supabase project `north-staging`, the Inngest
environment `staging` and a Resend subdomain that sends and receives. It runs real
Claude and live adapters behind the test-account fence, so agents reach only the
founder's test accounts. The founder provisions the accounts and enters every live
key; `docs/runbooks/staging.md` is the step-by-step, and the nightly and acceptance
workflows (`docs/evidence/README.md`) run against it. The repository must stay
private: a failed run's artifacts can hold the Vercel bypass cookie and the e2e
users' session tokens.

```bash
pnpm staging:check   # read-only check of the staging deployment (production:check with --env staging)
pnpm smoke:llm       # real-Claude smoke on the local stack: smoke profile, $0.50 cap (TST-2)
pnpm e2e:staging     # the live founder journey against staging, then the evidence guard (TST-3)
```

Real model exchanges can be recorded by the model gateway as cassettes and replayed
without a key (`cassettes/README.md`, ADR 0019): `pnpm e2e:replay` runs the
Playwright flows against a worker whose gateway replays, and `pnpm cassette:check`
scans every committed cassette for secrets, a stale key and the pinned Agent SDK
version.

Trust boundary for events: whoever can send events to Inngest can dispatch
tasks and complete connections for any user id. Locally the Dev Server listens
on loopback only (keep it that way); in production the event key and signing
key are secrets on both apps and the Inngest serve endpoints refuse unsigned
requests.
