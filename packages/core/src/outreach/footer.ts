// CMP-1: the footer every outreach email ends with: who writes, where they are, and how to make it stop.
import type { SenderIdentity } from "./policy";

/** What goes between the body and the footer: the classic signature separator, so mail clients fold the footer. */
export const FOOTER_MARKER = "\n\n-- \n";

const OPT_OUT_PREFIX = 'Reply "no" and I won\'t write again, or unsubscribe: ';

/** The footer text: the sender's legal name and postal address, then the plain way out with the unsubscribe link. */
export function complianceFooter(identity: SenderIdentity, unsubscribeUrl: string): string {
  return `${identity.legalName}, ${identity.postalAddress}\n${OPT_OUT_PREFIX}${unsubscribeUrl}`;
}

/**
 * True when the text ends in a compliance footer: after the last
 * {@link FOOTER_MARKER} (or from the start when there is none) some identity
 * text followed by the opt-out line with a link, and nothing after it. Used so
 * the footer is never added twice and never missing.
 */
export function hasComplianceFooter(text: string): boolean {
  const marker = text.lastIndexOf(FOOTER_MARKER);
  const tail = marker >= 0 ? text.slice(marker + FOOTER_MARKER.length) : text;
  const lines = tail.trimEnd().split("\n");
  const optOut = lines.at(-1) ?? "";
  const hasLink = optOut.startsWith(OPT_OUT_PREFIX) && /^\S+$/.test(optOut.slice(OPT_OUT_PREFIX.length));
  return hasLink && lines.slice(0, -1).some((line) => line.trim() !== "");
}
