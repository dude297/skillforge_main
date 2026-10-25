// EXPERIMENT (exp/world): the pixel companion + isometric company. Sources stay labelled; keyboard, reduced motion,
// mobile and accessibility hold; the console is untouched (its own suite runs unchanged).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("world experiment", () => {
  test("story is labelled as an illustration, the replay as a recorded run of real events", async ({ page }) => {
    await page.goto("#/world");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Meet Ember");
    await expect(page.locator("#story").getByText("Illustration").first()).toBeVisible();
    const replay = page.locator("#replay");
    await expect(replay.getByText("Recorded run").first()).toBeVisible();
    await expect(replay.getByText(/40 of 40/)).toBeVisible();
    await expect(replay.getByText(/scripted MOCK \(no model\)/)).toBeVisible();
  });

  test("keyboard: step events, open a department's evidence, Escape returns focus", async ({ page }) => {
    await page.goto("#/world");
    const replay = page.locator("#replay");
    await replay.getByRole("button", { name: "Restart" }).click();
    for (let i = 0; i < 3; i++) await replay.getByRole("button", { name: "Next event" }).click();
    await expect(replay.getByText("3 of 40")).toBeVisible();
    await expect(replay.locator("[aria-live=polite]")).toContainText("Investigating");
    const desk = replay.getByRole("button", { name: /Local AI room/ });
    await desk.focus();
    await page.keyboard.press("Enter");
    const dialog = replay.getByRole("dialog", { name: "Local AI room" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Investigating A-10");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(desk).toBeFocused();
  });

  test("live without the operator API says so and shows nothing invented", async ({ page }) => {
    await page.goto("#/world");
    await page.locator("#replay").locator("label", { hasText: "Live" }).click();
    await expect(page.locator("#replay").getByText(/isn't served by the operator API/).first()).toBeVisible();
    await expect(page.locator("#replay").getByText("0 of 0")).toBeVisible();
  });

  test("reduced motion: no blinking, no walking, no frame timers", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://127.0.0.1:4173/" });
    const page = await ctx.newPage();
    await page.goto("#/world");
    await page.locator("#replay").evaluate((el) => el.scrollIntoView());
    await page.waitForTimeout(500);
    expect(await page.locator(".world-led, .world-pulse").count()).toBe(0);
    const a = await page.locator("#replay svg").last().innerHTML();
    await page.waitForTimeout(800);
    expect(await page.locator("#replay svg").last().innerHTML()).toBe(a); // the sprite frame didn't change
    await ctx.close();
  });

  for (const width of [1440, 390]) {
    test(`no serious accessibility violations, no horizontal scroll at ${width}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, baseURL: "http://127.0.0.1:4173/", reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto("#/world");
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
      await ctx.close();
    });
  }

  test("world to console keeps provenance and task identity (recorded -> Recorded replay of that task)", async ({ page }) => {
    await page.goto("#/world");
    const replay = page.locator("#replay");
    await replay.getByRole("button", { name: "Restart" }).click();
    for (let i = 0; i < 4; i++) await replay.getByRole("button", { name: "Next event" }).click();
    await replay.getByRole("link", { name: "Replay task 1 in the console" }).click();
    await expect(page).toHaveURL(/source=recorded&replay=world&task=1#\/console\/history/);
    await expect(page.getByRole("radio", { name: /^Recorded/ })).toBeChecked();
    await expect(page.getByRole("heading", { name: /Replay: world recorded run, task 1 \(mock agent/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /Replay/ })).toContainText("Recorded run: Loaded from a real");
    await page.getByRole("button", { name: /^(Play|Replay)$/ }).click();
    await expect(page.getByText("Task opened by the operator")).toBeVisible({ timeout: 10_000 });
  });

  test("illustration -> console Preview, never a recorded or live view", async ({ page }) => {
    await page.goto("#/world");
    await page.locator("#story").getByRole("button", { name: /Human review desk/ }).first().focus();
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: "Open the console preview" }).click();
    await expect(page).toHaveURL(/source=synthetic#\/console\/investigations/);
    await expect(page.getByRole("radio", { name: /^Preview/ })).toBeChecked();
  });
});
