import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getBillingSession } from "@north/db";
import { createClient, currentUser } from "@/lib/supabase/server";
import { billingFailure, safeRedirectUrl } from "@/lib/billing-view";
import { billingRedirectPolicy } from "@/lib/env";
import { BillingRedirect } from "@/components/billing-redirect";

export const metadata = { title: "Opening Stripe" };

type Params = Promise<{ sessionId: string }>;

/** BIL-1: the session row under RLS (a stranger's id is a 404); the client waits for the worker's URL and follows it. */
export default async function BillingGoPage({ params }: { params: Params }) {
  const [user, { sessionId }] = await Promise.all([currentUser(), params]);
  if (!user) redirect("/login");
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) notFound();
  const session = await getBillingSession(await createClient(), id.data);
  if (!session) notFound();
  const url = session.status === "ready" ? safeRedirectUrl(session.url, billingRedirectPolicy()) : null;
  const initial = { status: session.status === "ready" && url === null ? ("failed" as const) : session.status, url, reason: session.status === "failed" ? billingFailure(session.error) : null };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <p className="mono-label text-faint">Billing</p>
      <h1 className="mt-1 text-4xl">{session.kind === "portal" ? "Billing portal" : "Checkout"}</h1>
      <p className="mt-3 text-muted">You are leaving North for Stripe. North never sees your card; your plan changes when Stripe confirms it.</p>
      <BillingRedirect sessionId={id.data} initial={initial} />
    </main>
  );
}
