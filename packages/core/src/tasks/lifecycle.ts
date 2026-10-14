import { z } from "zod";

export const TASK_STATUSES = ["queued", "running", "waiting_decision", "done", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** AGT-3: a failed attempt is retried once with a different approach, then escalated. */
export const MAX_ATTEMPTS = 2;

export const EVIDENCE_KINDS = ["url", "deploy_id", "message_id", "test_report", "artifact_id"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EvidenceSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  ref: z.string().min(1),
  /** True once a verifier confirmed the reference exists (HTTP 200, record found, ...). */
  verified: z.boolean(),
  sandbox: z.boolean().default(false),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export interface TaskState {
  readonly status: TaskStatus;
  readonly attempts: number;
  readonly evidence: Evidence | null;
}

export type TaskEvent =
  | { readonly type: "start" }
  | { readonly type: "wait_decision" }
  | { readonly type: "resume" }
  | { readonly type: "complete"; readonly evidence: Evidence }
  | { readonly type: "fail"; readonly reason: string };

export class TaskTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskTransitionError";
  }
}

const ALLOWED: Readonly<Record<TaskStatus, readonly TaskEvent["type"][]>> = Object.freeze({
  queued: ["start"],
  running: ["wait_decision", "complete", "fail"],
  waiting_decision: ["resume", "fail"],
  done: [],
  failed: ["start"],
});

/**
 * Pure task state machine (AGT-1/2/3). Returns a new state; never mutates.
 * `complete` without verified evidence is rejected (AGT-2).
 */
export function transition(state: TaskState, event: TaskEvent): TaskState {
  if (!ALLOWED[state.status].includes(event.type)) {
    throw new TaskTransitionError(`Cannot apply "${event.type}" to a task in "${state.status}"`);
  }
  switch (event.type) {
    case "start": {
      if (state.attempts >= MAX_ATTEMPTS) {
        throw new TaskTransitionError(`Task already used ${MAX_ATTEMPTS} attempts; escalate to Chief of Staff`);
      }
      return Object.freeze({ ...state, status: "running", attempts: state.attempts + 1 });
    }
    case "wait_decision":
      return Object.freeze({ ...state, status: "waiting_decision" });
    case "resume":
      return Object.freeze({ ...state, status: "running" });
    case "complete": {
      const evidence = EvidenceSchema.parse(event.evidence);
      if (!evidence.verified) {
        throw new TaskTransitionError("A task can only be done with verified evidence (AGT-2)");
      }
      return Object.freeze({ ...state, status: "done", evidence });
    }
    case "fail":
      return Object.freeze({ ...state, status: "failed" });
  }
}

export function canRetry(state: TaskState): boolean {
  return state.status === "failed" && state.attempts < MAX_ATTEMPTS;
}
