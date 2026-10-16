import { describe, expect, it } from "vitest";
import { EXPORT_DAILY_CAP, ExportRefusedError } from "@north/db";
import { exportRequestError } from "./export-errors";
import { errorText } from "./page-errors";

/** EXP-1 (M6 review M4, L8): the database's export refusals become the page's fixed lines; nothing of the database's text reaches the URL. */
describe("export request errors", () => {
  it("maps the two refusals to their codes and anything else to request-failed", () => {
    expect(exportRequestError(new ExportRefusedError("An export is already being built for c1000000-0000-4000-8000-000000000001.", "in_progress"))).toBe("in-progress");
    expect(exportRequestError(new ExportRefusedError("Export daily cap reached.", "daily_cap"))).toBe("daily-cap");
    expect(exportRequestError(new Error("connection reset"))).toBe("request-failed");
    expect(exportRequestError({ name: "ExportRefusedError", reason: "in_progress" })).toBe("request-failed");
    expect(exportRequestError(null)).toBe("request-failed");
  });

  it("shows fixed lines for them; the cap in the words is the database's cap", () => {
    expect(errorText("export", "in-progress")).toBe("An export is already being built. It will be ready in a few minutes.");
    expect(errorText("export", "daily-cap")).toBe("You can request 5 exports a day. Try again tomorrow.");
    expect(errorText("export", "daily-cap")).toContain(`${EXPORT_DAILY_CAP} exports a day`);
  });
});
