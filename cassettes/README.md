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

`cassetteKey(body)`: the request body as canonical JSON (object keys sorted at
every depth), after these are replaced in every string value:

| What | Becomes |
| --- | --- |
| UUIDs (v4 shape, any case) | `<uuid>` |
| ISO-8601 date-times (`2026-10-16T08:30:00.000Z`, with or without offset) | `<timestamp>` |
| lines starting `Task id: ` | `Task id: <id>` |

Two runs of the same test share a key; any other change to the request (model,
prompt text, `max_tokens`, `stream`) gives a new one, and replay answers a miss
with `502 { "error": { "type": "north_cassette_miss", "key": "..." } }` naming
the file it looked for. A date without a time (`2026-10-16`) is not replaced.

## Scrub rules

Everything written passes through `scrubCassette`, request and response alike:

- `sk-ant-...` keys become `sk-ant-REDACTED`
- `Bearer <token>` becomes `Bearer REDACTED`
- any email under `@north.test` becomes `redacted@north.test`

The request's `x-api-key` and `authorization` headers are never stored, and
neither are the response's `set-cookie` and `anthropic-organization-id`. Read a
new cassette before committing it anyway: the rules cover credentials, not
everything an agent might echo.

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
