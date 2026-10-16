# Cassettes

Recorded exchanges with the model API, so real-Claude tests replay without a
key, without network and without spend (TST-2). A cassette is one request and
its response, written by the model gateway (`apps/worker/src/gateway`) and read
back by it. They are committed.

## Format

One file per exchange, `<key>.json`, where `key` is the sha256 hex of the
request body (see below):

```json
{
  "key": "<64 hex>",
  "request":  { "method": "POST", "path": "/v1/messages", "headers": { "...": "..." }, "body": "<base64>" },
  "response": { "status": 200, "headers": { "content-type": "application/json" }, "body": "<base64>" }
}
```

Bodies are base64 so a streamed (SSE) reply is kept byte for byte and replays
with the same `content-type`. The request is stored for review only; matching
uses the key alone. Files are written to a temp file and renamed, so a reader
never sees half a recording.

## The key

`cassetteKey({ path, betaHeader, body })`: the request path and query as
forwarded (`/v1/messages?beta=true`), the `anthropic-beta` flags (trimmed,
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
- `Bearer <token>` (capital B, a token of 16 or more characters) becomes
  `Bearer REDACTED`; the English word "bearer" is left alone
- any email under `@north.test` becomes `redacted@north.test`

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
gateway logs it once and still serves the reply). A reply over the capture
limit (8 MB) or a compressed one is not recorded either; it is still served
and priced. Read a new cassette before committing it anyway: the rules cover
credentials, not everything an agent might echo.

## Modes

(The worker starts reading these variables when it wires the gateway, M7 Task 12;
until then `startGateway` takes `mode`, `cassetteDir` and the budget directly.)

The gateway runs in one of three modes. The worker reads `NORTH_CASSETTE_MODE`
(`off | record | replay`, default `off`); `off` is the gateway's `live` mode
(forward to the model API, store nothing), so the env value `off` maps to
`mode: "live"` when the worker wires the gateway.

- `off` (gateway `live`): forward every call, store nothing.
- `record`: forward every `/v1/messages` call and store the exchange, errors
  included. Needs the real key (`ANTHROPIC_API_KEY`).
- `replay`: never contact the model API; answer from `NORTH_CASSETTE_DIR`
  (default `cassettes`). Needs no key. Replayed answers are priced from the
  stored body, so the daily cap (`NORTH_DAILY_CAP_USD`) behaves as it does live.
  `count_tokens` is not recorded and cannot be replayed (`501`).

## Re-recording

Cassettes go stale when a prompt changes (the key changes with it). To refresh:

```bash
NORTH_CASSETTE_MODE=record NORTH_CASSETTE_DIR=cassettes ANTHROPIC_API_KEY=... pnpm dev
# run the flow once, then review and commit the new files under cassettes/
```

Delete the stale `<key>.json` files first if you want a clean set. A recording
spends real money against `NORTH_DAILY_CAP_USD`; use the `smoke` model profile.
