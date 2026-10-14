import { EVENT } from "@north/core/events";
import { inngest } from "./client";

/** M0: the worker acknowledges the kill switch; M2 wires cancellation and campaign pauses. */
export const killSwitchAck = inngest.createFunction(
  { id: "kill-switch-ack", triggers: [{ event: EVENT.companyKillSwitch }] },
  async ({ event, step }) =>
    step.run("ack", async () => ({ companyId: event.data.companyId, stoppedAt: new Date().toISOString() })),
);

export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "worker/ping" }] },
  async ({ step }) => step.run("pong", async () => ({ pong: true, at: new Date().toISOString() })),
);

export const functions = [killSwitchAck, ping];
