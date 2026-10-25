// Guided demo (#/demo) must never blank on a bad or partial run file: clear message or "not measured", nothing invented.
import { expect, test, type Page } from "@playwright/test";

async function serve(page: Page, body: string, status = 200) {
  await page.route("**/ui/demo/oncall", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("**/demo/oncall-run.recorded.json", (r) => r.fulfill({ status, contentType: "application/json", body }));
}
const errors = (page: Page) => { const e: string[] = []; page.on("pageerror", (x) => e.push(x.message)); return e; };

test.describe("guided demo resilience", () => {
  for (const [name, body] of [["malformed JSON", "{not json"], ["wrong schema", JSON.stringify({ schema: "other/1", mode: "x" })], ["empty body", ""]] as const) {
    test(`${name}: UNAVAILABLE with a readable reason on scene 3`, async ({ page }) => {
      const errs = errors(page);
      await serve(page, body);
      await page.goto("#/demo");
      await expect(page.getByTestId("mode-banner")).toHaveAttribute("data-mode", "UNAVAILABLE");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("alert").filter({ hasText: "No OnCall run to show" })).toContainText("oncall-run.recorded.json");
      expect(errs).toEqual([]);
    });
  }

  test("run with every section null: all six scenes render, no crash", async ({ page }) => {
    const errs = errors(page);
    const empty = { schema: "skillforge.oncall_run/1", mode: "RECORDED_SIMULATION", generated_at: null, host: null, model: null, incident: null,
      synthesis: null, verification: null, approval: null, reuse: null, refusal: null, telemetry: null, audit: null };
    await serve(page, JSON.stringify(empty));
    await page.goto("#/demo");
    for (let n = 1; n <= 6; n++) {
      await expect(page.getByText(`Scene ${n} of 6`, { exact: true })).toBeVisible();
      await expect(page.locator("#scene-h")).toBeVisible();
      if (n < 6) await page.keyboard.press("ArrowRight");
    }
    await expect(page.getByTestId("run-inspector")).toBeVisible();
    expect(errs).toEqual([]);
  });
});
