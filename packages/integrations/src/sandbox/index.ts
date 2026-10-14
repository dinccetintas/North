import type { Integrations, SandboxSink } from "../types";
import { SandboxAds } from "./ads";
import { SandboxMail } from "./mail";
import { SandboxPush } from "./push";

/** All three providers in sandbox mode, sharing one sink. The default for every environment. */
export function createSandboxIntegrations(sink?: SandboxSink): Integrations {
  return Object.freeze({ mode: "sandbox" as const, ads: new SandboxAds(sink), mail: new SandboxMail(sink), push: new SandboxPush(sink) });
}

export { SandboxAds, type SandboxCampaign, type SandboxCampaignStatus } from "./ads";
export { SandboxMail } from "./mail";
export { SandboxPush } from "./push";
export { sandboxRef } from "./record";
