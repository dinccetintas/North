# ADR 0016: Data leaves through exports and dies through the retention purge, the one delete path

Status: accepted (2026-10-15)

## Context

BIL-1 promises that after a subscription ends the data is kept for 90 days
and can be taken away; EXP-1 that the user can leave at any time with their
code (already in their GitHub), their data and their artifacts; MEM-2 that
artifacts download as MD, PDF and PPTX. Non-negotiable 3 says `actions` and
`ledger_entries` are append-only, enforced by triggers that bind the service
role too.

Those triggers have a known cost: `auth.admin.deleteUser` on a smoke owner
returns 500 because the cascade from `users` reaches `actions`, so every
smoke since M2 leaves its owner behind (M5 pauses the company instead). The
same cascade is what a retention purge needs to do on purpose. One question
answers both: is there a legitimate delete in North, and if so, where is it
and who may run it.

Exports have their own trap. The web process is the easy place to build a
zip (it already streams a single artifact's markdown), but a full export of
several companies with PDF and PPTX rendering is a job, not a request, and a
web function that reads every table of a user to build a file is a function
that can be asked to do it for the wrong user.

## Decision

**Export is a worker job to a private bucket; the web only requests and
links.** The owner inserts an `exports` row (`kind: artifacts | data |
full`, one company or all, `status: requested`; the insert policy allows
nothing else) and the web sends `export/requested`. `build-export` runs in
the worker, is not cancelled by the kill switch and is allowed for an
`ended` user until `retention_until`. It writes a zip to the private
`exports` bucket at `users/<userId>/exports/<exportId>.zip` and records the
manifest, the size and `expires_at` (7 days). Formats: every artifact as the
exact markdown plus a PDF from a pure-JS renderer in the worker (no browser
in the image), and a PPTX for deck and plan kinds; data as JSON per table
(owner-visible columns only) and CSV for the ledger, actions, decision
cards, tasks, metrics and leads; a README naming each company's GitHub
repository. Downloads are signed URLs (1 h) the web creates with the
owner's own client under a storage policy keyed on the user id path
segment, so a stranger gets neither the row nor the URL. Export is K0: it
reads the user's own data and nothing leaves North, so it carries no action
kind and does not pass the gate; it is still a job the worker owns, logged
and durable.

**Retention is a date on the entitlement, and the sweep only marks.** When a
subscription ends, `retention_until = ended_at + 90 d` (`RETENTION_DAYS`).
The daily `retention-sweep` archives the companies of an `ended` user whose
date has passed (`status: archived`, `paused_reason: retention`), sets
`purge_due`, and removes the objects of expired exports. It deletes nothing
else on its own.

**The purge is the one delete path.** `purge_owner(user_id, reason)` is a
`security definer` function executable by the service role only. It refuses
unless the entitlement is `ended` and `retention_until <= now()`. Inside its
transaction it disables the append-only triggers (`actions`,
`ledger_entries`, `audit_tool_calls`, `billing_events`, `credit_entries`,
`purge_log`), deletes the user's rows in dependency order (companies and
their cascade, connections, subscriptions, notifications, usage, credits,
billing rows, exports, the entitlement, the profile), re-enables the
triggers, and writes a `purge_log` row (a hash of the user id, the row
counts per table, the reason). The worker's `purgeOwner` removes the user's
storage objects first, calls the function, then `auth.admin.deleteUser`,
which now has nothing left to cascade into. Automatic purging is off by
default (`RETENTION_PURGE_ENABLED`); until the founder turns it on, the
sweep marks and `scripts/purge-due.ts` purges on request.

**The smoke cleanup uses the same function.** A smoke harness ends its
owner's entitlement, sets `retention_until` in the past with the service
role it already holds, and purges. No second delete path, no pause
convention to remember, and every smoke run proves the retention path once
more.

## Consequences

- Non-negotiable 3 stands for every caller but one: a service-role function
  with a date gate that re-enables what it disabled before it commits. An
  `update` or `delete` on `actions` outside it still raises, and the
  integration test proves it right after a purge.
- A purge is itself recorded (`purge_log`, append-only, no owner policy), so
  "this user's data was deleted on this day for this reason" has a row.
- Nothing is deleted while a user can still come back: the 90 days are
  counted from `ended_at`, the archive is reversible (a new subscription
  reactivates), the purge is not.
- The web never builds or streams an export; a web bug cannot hand one user
  another's data because the row, the object and the signed URL are all
  owner-scoped.
- Exports expire; the bucket does not grow without bound, and a download
  link found in an old email stops working after an hour.
- PDF and PPTX quality is what pure-JS renderers give: text, headings,
  lists, code, slides with bullets. Images and layouts are not promised by
  MEM-2 and are not attempted. The markdown is always exact.
- The founder's smokes and the test stacks no longer accumulate owners.
- A legal erasure request before `retention_until` is the same function
  with a different `reason` after the founder sets the date forward; it is a
  runbook step, not a new path.
