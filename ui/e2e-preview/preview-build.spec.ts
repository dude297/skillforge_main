import { expect, previewStrip, settle, test } from "./guard";

// Guard: the whole suite is only meaningful against `VITE_PREVIEW=1 npm run build`.
test("dist is a PREVIEW build (strip present, no live source, operator API never contacted)", async ({ page, net }) => {
  await page.goto("/#/console/overview");
  await settle(page);
  await expect(previewStrip(page), "this looks like a normal build: run `npm run build:preview` first").toBeVisible();
  expect(net.requests.filter((r) => new URL(r.url).pathname.split("/").includes("ui"))).toEqual([]);
});
