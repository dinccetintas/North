import type { ActionKind } from "./authority/action";
import type { EvidenceKind } from "./tasks/lifecycle";

/** What a verifier reports about one reference (AGT-2). `detail` is human-readable and safe to store. */
export interface EvidenceCheck {
  readonly kind: EvidenceKind;
  readonly ref: string;
  readonly verified: boolean;
  readonly detail: string;
}

/** The evidence kind an executed external action yields, or null when the action is not evidence of anything. */
export function evidenceKindFor(kind: ActionKind): EvidenceKind | null {
  switch (kind) {
    case "deploy.preview":
    case "deploy.production":
      return "url";
    case "email.send.first_contact":
    case "email.send.reply":
    case "support.reply.template":
    case "support.reply.custom":
      return "message_id";
    case "artifact.write":
      return "artifact_id";
    default:
      return null;
  }
}
