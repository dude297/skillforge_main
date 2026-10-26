import { ROUTES } from "../scripts/lib/routes.mjs";
import { expect, liveSourceControls, previewStrip, settle, test } from "./guard";

// Every route renders without errors or overflow. No global strip; hosted mode cannot contact the operator API.
for (const width of [1440, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 900 : 844 } });
    for (const r of ROUTES) {
      test(`${r.hash} loads clean, has no global preview strip, offers no Live source, does not overflow`, async ({ page, net }) => {
        await page.goto(`/${r.hash}`);
        await settle(page);

        expect(await page.title(), "document has a title").not.toBe("");
        const text = await page.locator("#root").innerText();
        expect(text.trim().length, "route rendered something").toBeGreaterThan(40);
        await expect(previewStrip(page)).toHaveCount(0);
        expect(await liveSourceControls(page), "Live must not be offered in the preview").toEqual([]);

        const overflow = await page.evaluate(() => {
          const d = document.documentElement;
          return { doc: d.scrollWidth - d.clientWidth, body: document.body.scrollWidth - d.clientWidth };
        });
        expect(Math.max(overflow.doc, overflow.body), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);

        expect(net.requests.every((q) => new URL(q.url).origin === new URL(page.url()).origin)).toBe(true);
      });
    }
  });
}

test("unknown hash falls back to the story instead of a blank page", async ({ page }) => {
  await page.goto("/#/definitely/not/a/route");
  await settle(page, 400);
  await expect(previewStrip(page)).toHaveCount(0);
  expect((await page.locator("#root").innerText()).trim().length).toBeGreaterThan(40);
});
