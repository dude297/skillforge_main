// EXPERIMENT (exp/bootstrap): the Bootstrap illustration in front of the Daylight World. It must say it's an
// illustration, never claim a connection SkillForge doesn't have, hand over to the unchanged world, and keep the
// console one link away. #/world itself is covered, unchanged, by world.spec.ts.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "#/world/bootstrap";
const scrubbed = (page: Page) => page.locator("section[aria-labelledby=bs-h]");

async function toProgress(page: Page, p: number) {
  await scrubbed(page).waitFor();
  await page.evaluate((p) => {
    const s = document.querySelector("section[aria-labelledby=bs-h]") as HTMLElement;
    const top = s.getBoundingClientRect().top + scrollY;
    window.scrollTo(0, top + p * (s.offsetHeight - innerHeight));
  }, p);
  await page.waitForTimeout(400);
}

test.describe("bootstrap illustration", () => {
  test("says it is an illustration, and the statuses are the true ones", async ({ page }) => {
    await page.goto(ROUTE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your company. Your AI. Your rules.");
    await expect(page.getByText("An illustration: nothing on this page connects to anything.")).toBeVisible();
    await expect(scrubbed(page).getByText("Illustration").first()).toBeVisible();
    const list = page.getByRole("list", { name: "Connections in this illustration" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list.getByRole("listitem").filter({ hasText: /: supported,/ })).toHaveCount(1);  // only local records
    await expect(list).toContainText("Business records (local database): supported, SkillForge can read it; nothing on this page checked it");
    await expect(list).toContainText("Local model (vLLM on this machine): configured, unverified");
    // an illustration performs no check, so it never claims a live state
    for (const word of [/\bconnected\b/i, /\bavailable\b(?! )/i, /healthy/i, /running/i])
      await expect(scrubbed(page).getByText(word)).toHaveCount(0);
    await expect(list).toContainText("Team chat (Slack, through NemoClaw): awaiting authorization");
    await expect(list).toContainText("ERP (SAP or similar): unavailable, not built yet");
    // no live/recorded provenance and no "verified" success state anywhere in the prelude
    await expect(scrubbed(page).getByText(/^(Live|Recorded run)$/)).toHaveCount(0);
    await expect(scrubbed(page).getByText(/(?<!not |un)verified/i)).toHaveCount(0);  // "unverified" is the honest label
    // the same office follows, but its hero is replaced by the prelude
    await expect(page.getByRole("heading", { name: /Meet Ember/ })).toHaveCount(0);
    await expect(page.locator("#story")).toBeAttached();
    await expect(page.locator("#replay")).toBeAttached();
  });

  test("scroll drives the scenes; keyboard reaches every scene, the office and the console", async ({ page }) => {
    await page.goto(ROUTE);
    const stage = scrubbed(page).getByRole("img", { name: /^Illustration, scene/ });
    await expect(stage).toHaveAccessibleName(/scene 1 of 5: Appliance/);
    await toProgress(page, 0.5);
    await expect(stage).toHaveAccessibleName(/scene 3 of 5: Discover/);
    const nav = page.getByRole("navigation", { name: "Bootstrap scenes" });
    await nav.getByRole("button", { name: "Permissions" }).focus();
    await page.keyboard.press("Enter");
    await expect(nav.getByRole("button", { name: "Permissions" })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("list", { name: "Example manifest" })).toBeInViewport();
    await page.getByRole("link", { name: "Skip to the office" }).first().press("Enter");
    await expect(page.locator("#story")).toBeInViewport();
    await page.goto(ROUTE);
    await page.getByRole("link", { name: "Open the console" }).first().press("Enter");
    await expect(page).toHaveURL(/#\/console/);
  });

  test("the office it ends on is the world's own, and the world still works after it", async ({ page }) => {
    await page.goto(ROUTE);
    await toProgress(page, 1);
    await expect(scrubbed(page).getByRole("img", { name: /scene 5 of 5: Your office/ })).toBeVisible();
    const replay = page.locator("#replay");
    await replay.scrollIntoViewIfNeeded();
    await replay.getByRole("button", { name: "Restart" }).click();
    for (let i = 0; i < 3; i++) await replay.getByRole("button", { name: "Next event" }).click();
    await expect(replay.getByText("3 of 40")).toBeVisible();
    await replay.getByRole("button", { name: /Local AI room/ }).press("Enter");
    await expect(replay.getByRole("dialog", { name: "Local AI room" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(replay.getByRole("dialog")).toHaveCount(0);
  });

  test("reduced motion: settled scenes, nothing scrubbed, nothing blinking", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(ROUTE);
    await expect(scrubbed(page)).toHaveCount(0);
    await expect(page.locator("section[aria-labelledby=bs-h-s] ol > li")).toHaveCount(5);
    await expect(page.locator("section[aria-labelledby=bs-h-s] .world-led, section[aria-labelledby=bs-h-s] .world-pulse")).toHaveCount(0);
    await ctx.close();
  });

  test("no request leaves this machine", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1:4173/") && !r.url().startsWith("data:")) external.push(r.url()); });
    await page.goto(ROUTE);
    for (const p of [0.25, 0.5, 0.75, 1]) await toProgress(page, p);
    expect(external).toEqual([]);
  });

  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    test(`no serious accessibility violations, no horizontal scroll at ${width}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height } });
      const page = await ctx.newPage();
      await page.goto(ROUTE);
      await page.locator("main").waitFor();  // the lazy chunk must have mounted before axe looks (seen racing under load)
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      const res = await new AxeBuilder({ page }).include("main").analyze();
      expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
      if (width < 768) await expect(page.locator("section[aria-labelledby=bs-h-s] ol > li")).toHaveCount(5);
      await ctx.close();
    });
  }
});
