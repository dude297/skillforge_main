import { expect, previewStrip, settle, test } from "./guard";

// Guard: the whole suite is only meaningful against `VITE_PREVIEW=1 npm run build`.
test("preview console has no global strip or live source and never contacts the operator API", async ({ page, net }) => {
  await page.goto("/#/console/overview");
  await settle(page);
  await expect(previewStrip(page)).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /^Live/ })).toHaveCount(0);
  expect(net.requests.filter((r) => new URL(r.url).pathname.split("/").includes("ui"))).toEqual([]);
});
