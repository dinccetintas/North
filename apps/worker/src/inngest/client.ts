import { Inngest } from "inngest";

/** Worker-side Inngest client: owns every agent run and external action. */
export const inngest = new Inngest({ id: "north-worker" });
