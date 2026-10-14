import { PushPayloadSchema, PushSubscriptionSchema, type PushPayload, type PushProvider, type PushResult, type PushSubscription, type SandboxSink } from "../types";
import { recordSandboxEvent, sandboxRef } from "./record";

/** Push provider that records the notification. Subscription keys never reach the sink. */
export class SandboxPush implements PushProvider {
  constructor(private readonly sink?: SandboxSink) {}

  async send(rawSubscription: PushSubscription, rawPayload: PushPayload): Promise<PushResult> {
    const subscription = PushSubscriptionSchema.parse(rawSubscription);
    const payload = PushPayloadSchema.parse(rawPayload);
    await recordSandboxEvent(this.sink, {
      provider: "push",
      op: "send",
      companyId: null,
      ref: sandboxRef("push"),
      payload: { endpoint: subscription.endpoint, ...payload },
    });
    return Object.freeze({ ok: true, sandbox: true });
  }
}
