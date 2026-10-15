/**
 * M4 review H4: the kill switch freezes decisions too. A card answered while
 * the company is stopped would be performed the moment the switch turns off
 * (the worker re-settles answered cards on resume), so the answer itself is
 * refused in the web until the CEO resumes. One fixed message, used by the
 * server action and shown on the card.
 */
export const STOPPED_MESSAGE = "Agents are stopped; resume to answer";

/** M6 (ADR 0014): billing paused the company; resuming is subscribing, not a button here. */
export const SUBSCRIPTION_MESSAGE = "Agents are paused: your subscription ended. Subscribe to resume";

/** M6 (RET-1): the retention sweep archived the company. */
export const ARCHIVED_MESSAGE = "This company is archived";

interface CompanyPause {
  readonly killSwitchActive: boolean;
  readonly pausedReason?: string | null;
}

function billingPause(company: CompanyPause): string | null {
  if (company.pausedReason === "subscription_ended") return SUBSCRIPTION_MESSAGE;
  if (company.pausedReason === "retention") return ARCHIVED_MESSAGE;
  return null;
}

/** The refusal for answering a card of this company, or null when the company runs. */
export function answerRefusal(company: CompanyPause | null): string | null {
  if (!company?.killSwitchActive) return null;
  return billingPause(company) ?? STOPPED_MESSAGE;
}

/** The refusal for the owner's resume: only their own pause (`user`, or none recorded before M6) is theirs to lift. */
export function resumeRefusal(company: CompanyPause | null): string | null {
  return company ? billingPause(company) : null;
}
