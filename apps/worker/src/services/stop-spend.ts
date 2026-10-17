// M6 review L3, TST-5: the kinds whose only effect is to stop spend. Nothing that only stops money may be refused for an ended subscription or by the test fence.
import type { ActionKind } from "@north/core";

/** Kinds that only stop spend: never refused for an ended subscription (M6 review L3) and never fenced (TST-5), so a cap pause always goes through. */
export const STOPS_SPEND: ReadonlySet<ActionKind> = new Set(["ads.pause"]);
