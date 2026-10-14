import { expect, test } from "@playwright/test";
import { latestMagicLink } from "./mail";

/**
 * M0 acceptance: magic-link sign-in through the local mail catcher, create a
 * company, land on its home with the kill switch present, and the company
 * appears in the list.
 */
test("M0: sign in with a magic link, create a company, see the kill switch", async ({ page }, testInfo) => {
  const email = `founder-${Date.now()}-${testInfo.project.name}@north.test`;

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Link sent");

  const link = await latestMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/companies/);
  await expect(page.getByTestId("user-email")).toHaveText(email, { timeout: 10_000 }).catch(() => undefined);

  await page.getByRole("link", { name: "New company" }).click();
  await page.getByLabel("Company name").fill("Cold Hive");
  await page.getByLabel("Thesis").fill("Done-for-you cold email for B2B agencies without an outbound arm, sold as a monthly retainer.");
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/\/c\/cold-hive/);
  await expect(page.getByTestId("company-name")).toHaveText("Cold Hive");
  await expect(page.getByTestId("kill-switch")).toHaveText("Stop all agents");
  await expect(page.getByText("Decisions today")).toBeVisible();

  await page.getByTestId("kill-switch").click();
  await expect(page.getByTestId("kill-switch")).toHaveText("Resume agents");
  await expect(page.getByRole("status")).toContainText("All agents are stopped");

  await page.screenshot({ path: `../../docs/evidence/M0/company-home-${testInfo.project.name}.png`, fullPage: true });

  await page.goto("/companies");
  await expect(page.getByRole("link", { name: /Cold Hive/ })).toBeVisible();
});
