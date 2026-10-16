/**
 * M6 smoke: subscription and launch in ten phases (docs/plans/M6.md
 * "Acceptance test"). A new owner in Europe/Istanbul (quota 3, brief at
 * 09:00) starts on the Solo trial, hits the one-company limit, subscribes to
 * Pro through the worker's sandbox checkout (every entitlement change is a
 * signed webhook), spends credits one run at a time, runs dry and buys a
 * pack, crosses the 40 % usage line, spends on the owner-local day, cancels
 * and ends (the kill switch within 5 s), exports while ended, re-subscribes
 * to Solo, rolls a period, ends again and is archived 91 days later; the
 * cleanup is the retention purge (ADR 0016), not a pause. Every phase ends
 * with the append-only checkpoint (`actions`, `ledger_entries`,
 * `billing_events`, `credit_entries`) and `max(cards per day) ≤ 3`.
 *
 * Usage: pnpm smoke:m6   (stack + `pnpm dev`; worker in sandbox mode with the mock runtime, STRIPE_WEBHOOK_SECRET unset)
 */
import { updateProfile, upsertPushSubscription } from "@north/db";
import { phase1, phase2, phase6Billing, phase8 } from "./smoke-m6/billing";
import { phase3, phase4, phase5 } from "./smoke-m6/credits";
import { phase7 } from "./smoke-m6/export";
import { avoidCrons, db, OWNER_BRIEF_HOUR, QUOTA, resetClock, setClock, signedInUser, TIMEZONE, type SignedInUser } from "./smoke-m6/harness";
import { cleanup, phase6Paused, phase9, purgeOwnerProof, wholeRun } from "./smoke-m6/retention";

/** The owner the plan prescribes, with a phone subscribed to push (the alerts go to every subscription, as cards do). */
async function createOwner(): Promise<SignedInUser> {
  const owner = await signedInUser("owner");
  await updateProfile(db, owner.id, { timezone: TIMEZONE, dailyDecisionQuota: QUOTA, briefHour: OWNER_BRIEF_HOUR });
  await upsertPushSubscription(db, { userId: owner.id, endpoint: `https://push.example.test/sandbox/${owner.id}`, p256dh: "sandbox-p256dh", auth: "sandbox-auth" });
  return owner;
}

async function run(owner: SignedInUser, stranger: SignedInUser): Promise<void> {
  await setClock(1, "07:00");
  const p1 = await phase1({ ownerId: owner.id, owner: owner.client, transitions: [], unmet: [], facts: {} });
  const p2 = await phase2(p1);
  const p3 = await phase3(p2);
  const p4 = await phase4(p3);
  const p5 = await phase5(p4);
  const ended = await phase6Billing(p5);
  const p6 = await phase6Paused(ended.ctx);
  const p7 = await phase7(p6, stranger);
  const p8 = await phase8(p7, ended.queued);
  const p9 = await phase9(p8);
  const summary = await wholeRun(p9);
  const counts = await purgeOwnerProof(p9);
  const purged = Object.entries(counts).filter(([, n]) => n > 0).map(([table, n]) => `${table} ${n}`).join(" ");
  const line = `${summary}, purge (${purged})`;
  if (p9.unmet.length > 0) throw new Error(`smoke M6: ${p9.unmet.length} plan item(s) unmet after the full run (${line}):\n  - ${p9.unmet.join("\n  - ")}`);
  console.log(`smoke M6 OK: ${line}`);
}

async function main(): Promise<void> {
  await avoidCrons();
  const owner = await createOwner();
  const stranger = await signedInUser("stranger");
  let failed = true;
  try {
    await run(owner, stranger);
    failed = false;
  } finally {
    await cleanup([owner.id, stranger.id], failed);
    await resetClock();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
