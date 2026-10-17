# North worker (ADR 0007): one container running the Inngest functions and the
# agent subprocesses. Built from the monorepo root:
#   docker build -f apps/worker/Dockerfile -t north-worker .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# Install the worker and its workspace packages only (no web app, no browsers).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/agents/package.json packages/agents/
COPY packages/integrations/package.json packages/integrations/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @north/worker... --prod=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/agents packages/agents
COPY packages/integrations packages/integrations
COPY apps/worker apps/worker
COPY agents agents
RUN pnpm --filter @north/worker typecheck

# Runtime: tsx executes the TypeScript sources directly (no build step to drift);
# workspaces, sandbox sites and the per-company agent config dirs (each run's HOME) live on the mounted volume.
FROM build AS runtime
ENV NODE_ENV=production WORKER_HOST=0.0.0.0 WORKER_PORT=3101 \
    WORKSPACE_ROOT=/data/workspaces SANDBOX_ROOT=/data/sandbox AGENT_CONFIG_ROOT=/data/agent-config \
    AGENTS_DIR=/app/agents
# SEC-1 (M7 Task 9): the engineering role's shell runs under the Claude Agent SDK sandbox with
# failIfUnavailable: true, which on Linux needs bubblewrap (bwrap) and socat. Without them every shell
# refuses to start. Installed as root, before USER node; no recommends and no apt lists keep the image small.
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap socat && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/workspaces /data/sandbox /data/agent-config && chown -R node:node /data /app
USER node
WORKDIR /app/apps/worker
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
