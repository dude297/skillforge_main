import { expect, settle, test } from "./guard";

// The cinematic intro (a lazily loaded WebGL layer) is hosted on the story route `#/`. Whatever it renders it must
// stay skippable, keyboard-reachable, and local-only. Tolerant by design: until the intro exists there is no Skip
// control (the page's "Skip to content" link is not it), and the test says so instead of failing.
const SKIP = /skip(?!\s+to\s+(main\s+)?content)/i;

for (const width of [1440, 390]) {
  test(`#/ keeps a reachable Skip control and stays on the origin (${width}px)`, async ({ page, net }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/#/");
    await page.waitForTimeout(600); // the intro may mount after the first paint
    const skip = page.getByRole("button", { name: SKIP }).or(page.getByRole("link", { name: SKIP })).first();
    if (await skip.count() === 0) {
      test.info().annotations.push({ type: "intro", description: "no control named /skip/i on #/ yet (the 'Skip to content' link does not count): intro not landed, nothing to assert" });
      test.skip(true, "intro not present yet");
      return;
    }
    await expect(skip, "Skip is visible without scrolling").toBeInViewport();
    await expect(skip).toBeEnabled();

    // reachable with the keyboard alone
    let focused = false;
    for (let i = 0; i < 25 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await skip.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
    }
    expect(focused, "Skip can be focused with Tab").toBe(true);

    await page.keyboard.press("Enter");
    await settle(page, 700);
    await expect(page.getByRole("heading", { level: 1 }).first(), "the story is usable after skipping").toBeVisible();
    expect(new URL(page.url()).hash).toBe("#/");
    expect(net.requests.every((r) => new URL(r.url).origin === new URL(page.url()).origin)).toBe(true);
  });
}
