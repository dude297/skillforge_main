import { test, expect, type Page } from "@playwright/test";

// The Forge intro on #/: skip/replay, the returning-visitor band, WebGL fallback, reduced motion, where three.js loads,
// and the exits into the product. Status truth is covered by cinematic-truth.spec.ts (pure functions).

const forge = (page: Page) => page.locator("section.forge");
/** The film is a lazy chunk on top of the lazy story chunk; give the first mount a generous budget on slow CI. */
const mounted = (page: Page) => expect(forge(page)).toBeAttached({ timeout: 15_000 });
const stage3dRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => { if (/\/assets\/Stage3D-[^/]+\.js$/.test(r.url())) urls.push(r.url()); });
  return urls;
};
/** Make every WebGL context request fail, as on a machine without GPU support. */
const noWebGL = (page: Page) => page.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (/webgl/i.test(type)) return null;
    return (orig as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
  } as typeof orig;
});

test.describe("The Forge intro", () => {
  test("is labelled an illustration, can be skipped with a button or Esc, and replays", async ({ page }) => {
    await page.goto("/");
    await mounted(page);
    await expect(forge(page)).toBeVisible();
    await expect(forge(page).getByText("Illustration, not a recorded run")).toBeVisible();
    const skip = page.getByRole("button", { name: /^skip/i }).filter({ hasNotText: /content/i });
    await expect(skip).toBeVisible();
    await skip.click();
    // skipped: the end frame offers the three real doors and the skip control is gone
    const exits = page.getByRole("navigation", { name: "Where to next" });
    await expect(exits.getByRole("link", { name: "Guided demo" })).toBeVisible();
    await expect(exits.getByRole("link", { name: "Explore the office" })).toBeVisible();
    await expect(exits.getByRole("link", { name: "Open the console" })).toBeVisible();
    await expect(skip).toHaveCount(0);
    // replay starts again from the first beat
    await forge(page).getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("group", { name: "Sequence" }).getByRole("button", { name: /, 1 of 6$/ })).toHaveAttribute("aria-current", "step");

    // Esc skips as well
    await page.keyboard.press("Escape");
    await expect(exits.getByRole("link", { name: "Guided demo" })).toBeVisible();
  });

  test("its exits are real routes", async ({ page }) => {
    await page.goto("/");
    await mounted(page);
    await expect(page.getByRole("button", { name: /^skip (intro|to end)/i })).toBeVisible(); // the film (3D or plan view) is mounted and listening
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "Where to next" }).getByRole("link", { name: "Guided demo" }).click();
    await expect(page).toHaveURL(/#\/demo$/);
    await expect(page.locator("#scene-h")).toBeVisible();
  });

  test("a returning visitor gets the compact band and three.js is never requested", async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem("skillforge.forge.seen", "1"); } catch { /* ignore */ } });
    const reqs = stage3dRequests(page);
    await page.goto("/");
    await mounted(page);
    await expect(forge(page)).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByRole("button", { name: "Replay the intro" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reuse the fix without it.");
    await page.waitForTimeout(800);
    expect(reqs).toEqual([]);
  });

  test("without WebGL it tells the same story as a stepped plan view, and three.js is never requested", async ({ page }) => {
    await noWebGL(page);
    const reqs = stage3dRequests(page);
    await page.goto("/");
    await mounted(page);
    await expect(forge(page)).toHaveAttribute("data-path", "poster");
    await expect(page.getByRole("img", { name: /^Plan view of the SkillForge office/ })).toBeVisible();
    await expect(forge(page).getByText("Illustration, not a recorded run")).toBeVisible();
    await forge(page).getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("group", { name: "Sequence" }).getByRole("button", { name: /, 2 of 6$/ })).toHaveAttribute("aria-current", "step");
    await page.waitForTimeout(500);
    expect(reqs).toEqual([]);
  });

  test("with reduced motion it does not autoplay: the visitor steps through it", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto("/");
    await mounted(page);
    await expect(forge(page)).toHaveAttribute("data-path", /^(stepped-3d|poster)$/);
    const first = page.getByRole("group", { name: "Sequence" }).getByRole("button", { name: /, 1 of 6$/ });
    await expect(first).toHaveAttribute("aria-current", "step");
    await page.waitForTimeout(2500); // longer than the first beat: nothing may advance on its own
    await expect(first).toHaveAttribute("aria-current", "step");
    await forge(page).getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("group", { name: "Sequence" }).getByRole("button", { name: /, 2 of 6$/ })).toHaveAttribute("aria-current", "step");
    await ctx.close();
  });

  test("three.js loads only on the story route, never on the console", async ({ page }) => {
    const reqs = stage3dRequests(page);
    await page.goto("/#/console/investigations");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(reqs, "the console must not load the cinematic").toEqual([]);
    expect(await page.locator("section.forge").count()).toBe(0);
  });
});
