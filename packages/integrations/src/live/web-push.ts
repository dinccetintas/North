import webpush from "web-push";
import { PushPayloadSchema, PushSubscriptionSchema, type PushPayload, type PushProvider, type PushResult, type PushSubscription } from "../types";

export interface WebPushConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  /** `mailto:` or https URL identifying the sender, per the VAPID spec. */
  readonly subject: string;
}

/** Reads the VAPID keys; null unless all three are present. */
export function webPushConfig(env: NodeJS.ProcessEnv): WebPushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export interface PushSendSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface PushSendOptions {
  readonly vapidDetails?: WebPushConfig;
}

export interface PushSendResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Record<string, string>;
}

/** `webpush.sendNotification` shape, injectable for tests. */
export type PushSender = (subscription: PushSendSubscription, body: string, options?: PushSendOptions) => Promise<PushSendResponse>;

const defaultSender: PushSender = (subscription, body, options) =>
  webpush.sendNotification(subscription, body, options?.vapidDetails ? { vapidDetails: options.vapidDetails } : {}) as Promise<PushSendResponse>;

/** Live web push with per-call VAPID details. A failed push is reported, not thrown: one dead subscription must not stop the rest. */
export class WebPush implements PushProvider {
  constructor(
    private readonly config: WebPushConfig,
    private readonly sender: PushSender = defaultSender,
  ) {}

  async send(rawSubscription: PushSubscription, rawPayload: PushPayload): Promise<PushResult> {
    const subscription = PushSubscriptionSchema.parse(rawSubscription);
    const payload = PushPayloadSchema.parse(rawPayload);
    try {
      await this.sender({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { vapidDetails: this.config });
      return Object.freeze({ ok: true, sandbox: false });
    } catch (error) {
      return Object.freeze({ ok: false, sandbox: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
