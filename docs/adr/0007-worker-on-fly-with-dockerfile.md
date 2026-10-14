# ADR 0007: The worker runs as one container on Fly.io

Status: accepted (2026-10-14)

## Context

`apps/worker` runs agent subprocesses (Claude Agent SDK), keeps per-task
workspaces on disk and serves Inngest functions over HTTP. Vercel functions
cannot host long-running subprocesses with a writable workspace, and the
architecture (ADR 0006) already keeps the worker out of the web app. The
choice was between Fly.io and Railway.

## Decision

The worker ships as a Docker image (`apps/worker/Dockerfile`, Node 22, pnpm
deploy of the worker and its workspace packages) and runs on Fly.io as a
single machine per environment with a persistent volume mounted at
`/data/workspaces` (`WORKSPACE_ROOT`). Inngest Cloud calls the machine's
public URL at `/api/inngest`, signed with `INNGEST_SIGNING_KEY`; nothing else
is exposed. Secrets (service role key, Anthropic key, connection encryption
key) are Fly secrets. Scaling is vertical first; a second machine needs the
Inngest concurrency keys already in place (per-company limit of 2).

Why Fly over Railway: volumes attach to a specific machine (workspaces must
not float), `fly.toml` keeps the config in the repo, and the free allowance
covers development. Railway stays a drop-in alternative: the same image runs
there with a mounted volume.

## Consequences

- `fly.toml` and the Dockerfile live in `apps/worker`; `pnpm --filter
  @north/worker build` must stay green in CI.
- Sandbox-hosted preview sites (`/sandbox/sites/*`) only exist in
  `INTEGRATIONS_MODE=sandbox`; the live worker returns 404 there.
- Production deployment itself is M6 work; this ADR fixes the shape so M3
  code is written for it.
