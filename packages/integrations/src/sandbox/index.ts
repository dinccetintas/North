import type { Integrations, SandboxSink } from "../types";
import { SandboxAds } from "./ads";
import { SandboxCodeHost } from "./code";
import { SandboxDeploy, defaultSiteBaseUrl } from "./deploy";
import { defaultSandboxRoot } from "./files";
import { SandboxImages } from "./images";
import { SandboxMail } from "./mail";
import { SandboxPush } from "./push";

export interface SandboxOptions {
  /** Folder for sandbox repos and sites; defaults to `SANDBOX_ROOT` or a temp dir. */
  readonly root?: string;
  /** Public base URL of the worker that serves `/sandbox/sites`. */
  readonly siteBaseUrl?: string;
}

/** Every provider in sandbox mode, sharing one sink. The default for every environment. */
export function createSandboxIntegrations(sink?: SandboxSink, options: SandboxOptions = {}): Integrations {
  const root = options.root ?? defaultSandboxRoot();
  const baseUrl = options.siteBaseUrl ?? defaultSiteBaseUrl();
  const code = new SandboxCodeHost(sink, root);
  const deploy = new SandboxDeploy(sink, root, baseUrl);
  return Object.freeze({
    mode: "sandbox" as const,
    ads: new SandboxAds(sink),
    mail: new SandboxMail(sink),
    push: new SandboxPush(sink),
    images: new SandboxImages(sink),
    code: () => code,
    deploy: () => deploy,
  });
}

export { SandboxAds, type SandboxCampaign, type SandboxCampaignStatus } from "./ads";
export { SandboxMail } from "./mail";
export { SandboxPush } from "./push";
export { SandboxCodeHost } from "./code";
export { SandboxDeploy, SANDBOX_SITES_PATH, defaultSiteBaseUrl, liveSiteDir } from "./deploy";
export { SandboxImages, placeholderSvg } from "./images";
export { defaultSandboxRoot, safeJoin, writeTree } from "./files";
export { sandboxRef } from "./record";
