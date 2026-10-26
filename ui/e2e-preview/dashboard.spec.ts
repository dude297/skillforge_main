import { expect, previewStrip, test } from "./guard";

test.use({ viewport: { width: 1440, height: 900 } });

test("workspace opens with one clear demo action and no global strip", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start demo", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ember workspace map" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Demo progress" }).locator("li")).toHaveCount(4);
  await expect(previewStrip(page)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("demo pauses for review, reuses a skill, refuses the lookalike, and opens evidence", async ({ page }) => {
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  const next = page.getByRole("button", { name: "Continue demo", exact: true });
  await expect(next).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2600);
  await expect(next).toBeVisible(); // time alone cannot pass the human-review beat
  await next.click();
  await page.getByRole("button", { name: "Try skill reuse", exact: true }).click();
  await page.getByRole("button", { name: "Test a lookalike", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lookalike safely refused" })).toBeVisible();
  await page.getByRole("button", { name: "Inspect the proof", exact: true }).click();
  await expect(page.getByTestId("run-inspector")).toBeVisible();
  await expect(page.getByText("Recorded GB10 run · Oct 25, 2026")).toBeVisible();
});

test("draft creation and editing survive reload", async ({ page }) => {
  await page.goto("/#/dashboard/tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("What do you want Ember to do?", { exact: true }).fill("Check invoice totals");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Check invoice totals", exact: true }).click();
  await page.getByLabel("What do you want Ember to do?", { exact: true }).fill("Check totals and flag mismatches");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Check totals and flag mismatches", exact: true })).toBeVisible();
  await page.getByLabel("Search tasks").fill("does not exist");
  await expect(page.getByRole("heading", { name: "No matching drafts" })).toBeVisible();
});

test("hosted local-system selection stays offline and does not show sample live tasks", async ({ page }) => {
  await page.goto("/#/dashboard/tasks");
  await page.getByLabel("Data source", { exact: true }).selectOption("live");
  await expect(page.getByText("Your local system is unavailable. Saved tasks are still here.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting for your local system" })).toBeVisible();
});
