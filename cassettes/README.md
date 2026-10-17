# Cassettes

Recorded exchanges with the model API, so real-Claude tests replay without a
key, without network and without spend (TST-2). A cassette is one request and
its response, written by the model gateway (`apps/worker/src/gateway`) and read
back by it. They are committed.

## The rule

- **Synthetic companies only.** A cassette is recorded from a flow that runs on
  a made-up company with made-up customers (`@north.test` addresses, scrubbed
  from the request below). Never record a real founder's company, a real
  customer or a real inbox.
- **Request bodies are scrubbed** (`sk-ant-...` keys, bearer tokens and
  `@north.test` addresses are replaced, see below); **responses are kept
  verbatim**, and the gateway refuses to record a response that carries a key.
- **Secret-scanned.** `pnpm cassette:check` reads every file here and fails on
  a secret, a renamed file, a request that no longer hashes to its name or a
  recording from another Agent SDK than the one pinned. It is a `pnpm validate`
  step and a CI step (job `validate`, and job `e2e-replay` before it replays).
- **Re-recorded by the nightly job** (M7 Task 21) when a prompt or a model
  alias changes a key, or the Agent SDK pin moves; a stale cassette is deleted
  and recorded again, not patched.
- **Never edited by hand.** A hand edit breaks the key check or hides what the
  agent really received; if `pnpm cassette:check` fails, fix the flow and
  record again.

## Format

One file per exchange, `<key>.json`, where `key` is the sha256 hex of the
request body (see below):

```json
{
  "key": "<64 hex>",
  "request":  { "method": "POST", "path": "/v1/messages?beta=true", "headers": { "...": "..." }, "body": "<base64>" },
  "response": { "status": 200, "headers": { "content-type": "application/json" }, "body": "<base64>" },
  "meta":     { "sdkVersion": "0.3.301", "recordedAt": "2026-10-17T09:00:00.000Z", "requestScrubbed": false, "gatewayMode": "record" }
}
```

Bodies are base64 so a streamed (SSE) reply is kept byte for byte and replays
with the same `content-type`. Replay matches by the key alone; the stored
request is for review and for `pnpm cassette:check`. Files are written to a
temp file and renamed, so a reader never sees half a recording.

### The `meta` block

Written by the gateway when it records (optional in the schema, so a cassette
recorded before the block existed still replays):

| Field | Meaning |
| --- | --- |
| `sdkVersion` | The Agent SDK version from the request's `user-agent`: the Claude Code subprocess the SDK starts sends `claude-cli/<cli version> (external, sdk-ts, agent-sdk/<sdk version>[, client-app/..][, workload/..])`, and `agent-sdk/<sdk version>` is the field read. `null` for any other client (the single-call `@anthropic-ai/sdk` client sends `Anthropic/JS <version>`). `claude-cli/<n>` is the CLI's own version and is not used. |
| `recordedAt` | When the exchange was recorded, ISO-8601 UTC. |
| `requestScrubbed` | `true` when scrubbing changed the body, the path or the `anthropic-beta` header, the three parts a key is made of: the key then cannot be recomputed from the stored request. |
| `gatewayMode` | Always `record`: only that mode writes a file. |

## The key

`cassetteKey({ path, betaHeader, body })`: the request path and query as
`keyPathOf(url)` reads them (`/v1/messages?beta=true`; `/v1/./messages?beta=true`
is the same target, an empty `?` is no query; the recorder stores this same
string as `request.path`, so the stored path hashes to the file name), the
`anthropic-beta` flags (trimmed,
sorted, comma-joined; empty when there are none) and the request body, as
canonical JSON (object keys sorted at every depth), after these are replaced in
every string value:

| What | Becomes |
| --- | --- |
| UUIDs of any version (`8-4-4-4-12` hex, any case) | `<uuid>` |
| ISO-8601 date-times (`2026-10-16T08:30:00.000Z`, with or without offset) | `<timestamp>` |
| lines starting `Task id: ` | `Task id: <id>` |

Two runs of the same test share a key; any other change to the request (model,
prompt text, `max_tokens`, `stream`, path, beta flags) gives a new one, and
replay answers a miss with
`502 { "error": { "type": "north_cassette_miss", "key": "..." } }` naming the
file it looked for. A date without a time (`2026-10-16`) is not replaced. The key
is always computed from the live, unscrubbed request, so recording and replay
agree.

## What is stored, and what is scrubbed

The stored **request** passes through `scrubCassette` (body, path and header
values):

- `sk-ant-...` keys become `sk-ant-REDACTED`
- `Bearer <token>` (the scheme in any case, a token of 16 or more characters)
  becomes `Bearer REDACTED`; the English word "bearer" and a short word after
  it are left alone
- any email under `@north.test` becomes `redacted@north.test`. The body is
  scrubbed as the JSON text it is, so an address after a JSON escape keeps the
  escape whole (`"Contact:\nbob@north.test"` is stored as
  `"Contact:\nredacted@north.test"`, a newline, not a carriage return and
  `edacted`); the path and the header values are plain text. Two addresses
  that touch (`a@north.test.b@north.test`) become
  `redacted@north.testredacted@north.test`, which the check accepts

Only these request headers are stored (the ones the gateway forwards):
`content-type`, `accept`, `accept-language`, `user-agent`, `anthropic-version`,
`anthropic-beta`, `x-app` and `x-stainless-*`. Never `x-api-key`,
`authorization`, cookies or forwarding headers.

The stored **response** is kept verbatim, so replay serves exactly what was
recorded (a scrubbed reply would change the agent's next request and miss its
cassette). The only headers left out are `set-cookie`,
`anthropic-organization-id` and the wire headers (`content-length`,
`transfer-encoding`, `connection`, `keep-alive`). A response that matches
`sk-ant-[A-Za-z0-9_-]+` is **not recorded** at all (nothing is written, the
gateway logs it once and still serves the reply). It is read the way its
reader reads it: JSON strings are decoded (`\u0073k-ant-...` is a key), and for
a Server-Sent Events reply each content block's `text`, `partial_json` and
`thinking` deltas are joined, so a key split across events (`"sk-"` then
`"ant-api03-..."`) is a key too. A reply over the capture
limit (8 MB) or a compressed one is not recorded either, and is still served.
An SSE reply over the limit is priced from the stream as it goes by; a JSON
reply over the limit, or a compressed one, cannot be read, so it is unpriced
and, under a cap, closes the day (402 `north_budget_unpriced` until the next
UTC day). A 2xx stream that carried only an `error` event is an upstream
error: counted, not priced, and the day stays open. Read a new cassette before
committing it anyway: the rules cover credentials, not everything an agent
might echo.

## The cassette check

`pnpm cassette:check` (`scripts/cassette-check.ts`, rules in
`scripts/cassette-rules.ts`; `NORTH_CASSETTE_DIR` picks another directory,
default `cassettes`) validates every `*.json` against the gateway's own schema
and fails when:

- the file is not a cassette, or has a field the schema does not know (at the
  file, the request, the response or `meta`: the gateway's reader still accepts
  older files, the check does not accept what it cannot scan);
- the file name is not its `key` (a renamed or copied cassette);
- a body, a header, the path or a metadata string matches
  `sk-ant-[A-Za-z0-9_-]+` (other than the `sk-ant-REDACTED` the scrubber
  writes) or `Bearer <16 or more token characters>` (the scheme in any case).
  Strings are read decoded (`\uXXXX` escapes), bodies the way the gateway reads
  them (a stream's deltas joined, so a split key is found). The finding names
  the kind and the place, never the secret;
- an address under `@north.test` other than `redacted@north.test` sits in a
  request body, a header or the path. In a **response body** it is only a
  warning: replies are stored verbatim, and a made-up address in one is
  expected;
- a request or response header is `authorization`, `x-api-key`,
  `proxy-authorization`, `cookie` or `set-cookie` in any case (the gateway
  stores none of them), or the response has a `content-encoding` other than
  `identity` (its text cannot be scanned);
- the Agent SDK version (`meta.sdkVersion`, else, for a cassette from before
  `meta`, the stored user agent's) differs from the version pinned in
  `packages/agents/package.json` (both are printed), or `meta.sdkVersion`
  disagrees with the stored user agent. A `claude-cli/...` user agent that
  names no `agent-sdk/<version>` only warns, `SDK version not recorded`;
- `meta.requestScrubbed` is `false` (or `meta` is absent) and the key
  recomputed from the stored path, `anthropic-beta` header and body is not the
  file name: the request was edited, or the key rules changed. A
  `requestScrubbed: true` is believed only if the stored request holds a
  redaction marker (`sk-ant-REDACTED`, `Bearer REDACTED`, `redacted@north.test`).
  For a cassette with no `meta` this is only a warning, `unverifiable (pre-meta
  cassette)`, because its scrubbing is unknown;
- the directory holds anything but `*.json` and this README (a leftover
  `.tmp` file, a subfolder), or cannot be read.

It prints `cassette check: N files, W warnings` (plus `, F failed`), each
problem as `FAIL|WARN <file>: <reason>` on stderr, and exits 1 on any failure.
An empty directory passes with `cassette check: 0 files, 0 warnings`.

## Replaying the end-to-end flows

`pnpm e2e:replay` runs the Playwright specs (`apps/web/e2e`, `m0` to `m6`)
against a worker on the SDK runtime with a replaying gateway. **The worker must
be started with the replay variables: Playwright cannot do it.** Its
`webServer` runs `pnpm dev` in `apps/web`, which is `next dev` only, so the
worker is never started by (and never inherits from) the test run. Locally,
with Supabase up (`pnpm db:start`), from the repo root:

```bash
# 1. the stack, with the worker replaying (no ANTHROPIC_API_KEY: replay needs none)
NORTH_CASSETTE_MODE=replay AGENT_RUNTIME=claude-agent-sdk NORTH_ENV=staging NORTH_MODEL_PROFILE=smoke pnpm dev

# 2. in a second shell, once the web (:3100), worker (:3101) and Inngest (:8288) answer
pnpm e2e:replay
```

`pnpm e2e:replay` also sets `NORTH_CASSETTE_MODE=replay` in the Playwright
process. That marks the run as a replay run, and `apps/web/e2e/global-setup.ts`
then reads the worker's `/health` and fails the run unless it reports
`"runtime":"claude-agent-sdk"` and `"gateway":"replay"`, so a worker left on the
mock runtime (or recording, or live) cannot pass silently. Without that
variable the global setup does nothing, and the mock `pnpm e2e` is unchanged.

CI job `e2e-replay` does the same: `needs: validate`, a worker `.env` with the
four variables and no key, `pnpm cassette:check`, a step that asserts the same
`/health` fields, then `pnpm e2e:replay`; the Playwright report is uploaded
when it fails. It runs only when `cassettes/*.json` exist: GitHub does not
allow `hashFiles` in a job-level `if`, so the small job `cassettes` reads the
directory and `e2e-replay` is skipped unless it reports a file. Until the
nightly job (Task 21) has recorded a full set, no cassette is committed,
`e2e-replay` is skipped, and the mock `e2e` job stays the gate. A cassette is
committed with the set that covers every call the specs make: a miss is a
`502 north_cassette_miss` naming the file it looked for, and fails the spec.

## Modes

The worker starts the gateway when `AGENT_RUNTIME=claude-agent-sdk`
(`apps/worker/src/services/runtime-deps.ts`); the agent subprocess and the
single-call LLM client both call it. It runs in one of three modes. The worker
reads `NORTH_CASSETTE_MODE` (`off | record | replay`, default `off`); `off` is
the gateway's `live` mode (forward to the model API, store nothing), so the env
value `off` maps to `mode: "live"`. Under `NODE_ENV=production`, `record` and
`replay` need `NORTH_ENV=staging`.

- `off` (gateway `live`): forward every call, store nothing.
- `record`: forward every `/v1/messages` call and store the exchange, errors
  included. Needs the real key (`ANTHROPIC_API_KEY`).
- `replay`: never contact the model API; answer from `NORTH_CASSETTE_DIR`
  (default `<repo root>/cassettes`; a relative path is read from the repo
  root). Needs no key. Replayed answers are priced from the
  stored body, so the daily cap (`NORTH_DAILY_CAP_USD`) behaves as it does live.
  `count_tokens` is not recorded and cannot be replayed (`501`).

## Re-recording

Cassettes go stale when a prompt changes (the key changes with it). To refresh:

```bash
AGENT_RUNTIME=claude-agent-sdk NORTH_CASSETTE_MODE=record NORTH_CASSETTE_DIR=cassettes \
  NORTH_MODEL_PROFILE=smoke NORTH_DAILY_CAP_USD=0.50 ANTHROPIC_API_KEY=... pnpm dev
# run the flow once, then review and commit the new files under cassettes/
pnpm cassette:check
```

Delete the stale `<key>.json` files first if you want a clean set. A recording
spends real money against `NORTH_DAILY_CAP_USD`; use the `smoke` model profile
(any profile runs in development; under `NODE_ENV=production` any profile but
`production` needs `NORTH_ENV=staging`).
