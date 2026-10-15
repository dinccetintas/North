/**
 * M4 review H4: the kill switch freezes decisions too. A card answered while
 * the company is stopped would be performed the moment the switch turns off
 * (the worker re-settles answered cards on resume), so the answer itself is
 * refused in the web until the CEO resumes. One fixed message, used by the
 * server action and shown on the card.
 */
export const STOPPED_MESSAGE = "Agents are stopped; resume to answer";

/** The refusal for answering a card of this company, or null when the company runs. */
export function answerRefusal(company: { readonly killSwitchActive: boolean } | null): string | null {
  return company?.killSwitchActive ? STOPPED_MESSAGE : null;
}
