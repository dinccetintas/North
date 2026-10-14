import { Resend } from "resend";
import { ProviderError } from "../errors";
import { SendMailInputSchema, type MailProvider, type SendMailInput, type SendMailResult } from "../types";

export interface ResendConfig {
  readonly apiKey: string;
  /** Verified sender, e.g. `North <decisions@north.example>`. */
  readonly from: string;
}

/** Reads the Resend keys; null unless both are present. */
export function resendConfig(env: NodeJS.ProcessEnv): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  return apiKey && from ? { apiKey, from } : null;
}

export interface ResendSendPayload {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface ResendSendResponse {
  readonly data: { readonly id: string } | null;
  readonly error: { readonly name: string; readonly message: string } | null;
}

/** The slice of the Resend SDK the adapter uses; injectable so tests never hit the network. */
export interface ResendClient {
  readonly emails: {
    send(payload: ResendSendPayload): Promise<ResendSendResponse>;
  };
}

/** Wraps the real SDK in the narrow client interface. */
export function resendClient(apiKey: string): ResendClient {
  const sdk = new Resend(apiKey);
  return {
    emails: {
      send: async (payload) => {
        const response = await sdk.emails.send({ from: payload.from, to: payload.to, subject: payload.subject, text: payload.text });
        return { data: response.data ? { id: response.data.id } : null, error: response.error ? { name: response.error.name, message: response.error.message } : null };
      },
    },
  };
}

/** Live mail through Resend. Validates input first; provider failures become `ProviderError` without the key. */
export class ResendMail implements MailProvider {
  private readonly client: ResendClient;

  constructor(
    private readonly config: ResendConfig,
    client?: ResendClient,
  ) {
    this.client = client ?? resendClient(config.apiKey);
  }

  async send(raw: SendMailInput): Promise<SendMailResult> {
    const input = SendMailInputSchema.parse(raw);
    let response: ResendSendResponse;
    try {
      response = await this.client.emails.send({ from: this.config.from, to: input.to, subject: input.subject, text: input.text });
    } catch (error) {
      throw new ProviderError("resend", error instanceof Error ? error.message : "request failed", error);
    }
    if (response.error || !response.data) {
      throw new ProviderError("resend", response.error ? `${response.error.name}: ${response.error.message}` : "no message id returned");
    }
    return Object.freeze({ messageId: response.data.id, sandbox: false });
  }
}
