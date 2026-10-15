import type { PaymentsProvider, PaymentsSnapshot } from "../growth-types";
import type { SandboxSink } from "../types";
import { recordSandboxEvent, sandboxRef } from "./record";

/** No M4 company has paying customers and the sandbox invents none: the read is recorded and answers "no data". */
export class SandboxPayments implements PaymentsProvider {
  constructor(private readonly sink?: SandboxSink) {}

  async read(companyId: string): Promise<PaymentsSnapshot | null> {
    await recordSandboxEvent(this.sink, { provider: "payments", op: "read", companyId, ref: sandboxRef("payments"), payload: { data: null } });
    return null;
  }
}
