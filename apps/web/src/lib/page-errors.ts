/**
 * M6 review L8: a page's `?error=` is a code, never text. Server actions and
 * routes redirect with `withError(path, page, code)`; the page renders
 * `errorText(page, code)`: the fixed line for a known code of that page, the
 * generic line for anything else (free text, another page's code, an
 * array), so a crafted link cannot put its own words in North's alert box.
 * The cause of a failure goes to the server log only.
 */
import { CHECKOUT_OPEN_MINUTES } from "@north/core/billing/plans";

export const GENERIC_ERROR = "Something went wrong; nothing was changed.";

export const PAGE_ERRORS = Object.freeze({
  billing: Object.freeze({
    "start-failed": "Billing could not start. Try again in a minute.",
    "unknown-plan": "Unknown plan.",
    "unknown-pack": "Unknown credit pack.",
    // A billing session the worker refused (`billingFailure`): shown on the redirect page.
    "checkout-open": `A checkout is already open. Complete it in its Stripe tab, or start again in ${CHECKOUT_OPEN_MINUTES} minutes.`,
    subscribed: "You already have a subscription. Change plans in Manage billing.",
  }),
  export: Object.freeze({
    "choose-kind": "Choose what to export.",
    "request-failed": "The export could not be requested. Try again in a minute.",
    "unknown-export": "Unknown export.",
    unavailable: "This export is not available any more. Request a new one.",
    // The database's `exports_rate_limit` refusals (`exportRequestError`); the cap is `EXPORT_DAILY_CAP` (a test keeps them equal).
    "in-progress": "An export is already being built. It will be ready in a few minutes.",
    "daily-cap": "You can request 5 exports a day. Try again tomorrow.",
  }),
  login: Object.freeze({
    "invalid-email": "Enter a valid email.",
    "link-failed": "Could not send the link. Try again.",
    "google-unavailable": "Google sign-in is not configured.",
    "link-invalid": "That link is invalid or expired.",
  }),
  newCompany: Object.freeze({
    "invalid-company": "Give the company a name and a thesis of at least ten characters.",
    "plan-limit": "Your plan does not include another company.",
  }),
  settings: Object.freeze({
    "save-failed": "Could not save: the quota must be 1 to 5, the time zone a known IANA name and the brief hour 0 to 23.",
  }),
  publicPage: Object.freeze({
    "invalid-page": "Check the page: a headline up to 120 characters, a blurb up to 600 and at most three metrics.",
    "save-failed": "The page could not be saved. Try again.",
  }),
  onboarding: Object.freeze({
    "answers-invalid": "Each answer can be at most 1000 characters.",
    "answers-failed": "Could not save your answers. Try again.",
    "goal-invalid": "Pick a metric, a target above zero and a due date.",
    "goal-failed": "Could not save the goal. Try again.",
    "budget-invalid": "Budgets must be numbers of zero or more.",
    "budget-failed": "Could not save the budgets. Try again.",
    "start-failed": "Could not start the company. Try again.",
  }),
});

export type ErrorPage = keyof typeof PAGE_ERRORS;
export type ErrorCode<P extends ErrorPage> = keyof (typeof PAGE_ERRORS)[P] & string;

/** The line to show for `?error=`; null when there is none. */
export function errorText(page: ErrorPage, code: string | readonly string[] | undefined): string | null {
  if (code === undefined || code === "") return null;
  const messages: Readonly<Record<string, string>> = PAGE_ERRORS[page];
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(messages, code) ? (messages[code] ?? GENERIC_ERROR) : GENERIC_ERROR;
}

/** `path` with `error=<code>` added to its query. */
export function withError<P extends ErrorPage>(path: string, _page: P, code: ErrorCode<P>): string {
  return `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(code)}`;
}
