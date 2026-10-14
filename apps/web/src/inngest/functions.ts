import { EVENT } from "@north/core/events";
import { inngest } from "./client";

/** M0 placeholder: proves the web app serves functions and receives events. */
export const companyCreatedLog = inngest.createFunction(
  { id: "company-created-log", triggers: [{ event: EVENT.companyCreated }] },
  async ({ event, step }) => {
    return step.run("log", async () => ({ companyId: event.data.companyId, seenAt: new Date().toISOString() }));
  },
);

export const functions = [companyCreatedLog];
