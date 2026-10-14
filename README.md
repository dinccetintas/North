# North

The operating system for a one-person company. You are the CEO; AI agents are the
staff. State a thesis, a goal and a budget, then run the company by answering at
most three decision cards a day. Every agent action is tied to a metric, gated by
an authority tier, written to an immutable ledger, and stoppable with one button.

Start here:

- `docs/SPEC.md`: the founder's product and build specification (requirement IDs).
- `docs/superpowers/specs/2026-10-14-north-architecture-design.md`: architecture.
- `docs/research/polsia-teardown.md`: what the reference product does and where it fails.
- `docs/plans/M0.md` … `M6.md`: milestone plans with acceptance tests.
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
makes `pnpm test:integration`, `pnpm smoke:m1`, `pnpm smoke:m2` and `pnpm e2e`
work unchanged. Binaries live under `$NORTH_STACK_TOOLS` (see the script header);
`scripts/stack/down.sh` stops it.
