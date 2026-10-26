import { dataRequests, expect, previewStrip, settle, test } from "./guard";

// Cold loads (new page, full URL): what a judge gets from a pasted link. Vercel serves index.html for any path;
// the hash picks the route. Expectations use the nav hrefs (stable), not copy.
const CASES: { hash: string; topNav: string; sectionNav?: string }[] = [
  { hash: "#/", topNav: "#/dashboard" },
  { hash: "#/story", topNav: "#/story" },
  { hash: "#/dashboard/tasks", topNav: "#/dashboard/tasks" },
  { hash: "#/dashboard/skills", topNav: "#/dashboard/skills" },
  { hash: "#/dashboard/activity", topNav: "#/dashboard/activity" },
  { hash: "#/dashboard/evidence", topNav: "#/dashboard/evidence" },
  { hash: "#/world/onboard", topNav: "#/world/onboard" },
  { hash: "#/world/bootstrap", topNav: "#/world/onboard" },
  { hash: "#/world", topNav: "#/world" },
  { hash: "#/console/overview", topNav: "#/console", sectionNav: "#/console/overview" },
  { hash: "#/console/investigations", topNav: "#/console", sectionNav: "#/console/investigations" },
  { hash: "#/console/investigations/incident", topNav: "#/console", sectionNav: "#/console/investigations" },
  { hash: "#/console/skills", topNav: "#/console", sectionNav: "#/console/skills" },
  { hash: "#/console/history", topNav: "#/console", sectionNav: "#/console/history" },
  { hash: "#/console/benchmarks", topNav: "#/console", sectionNav: "#/console/benchmarks" },
  { hash: "#/console/system", topNav: "#/console", sectionNav: "#/console/system" },
  { hash: "#/demo", topNav: "#/demo" },
  { hash: "#/demo/pitch", topNav: "#/demo" },
];

for (const c of CASES) {
  test(`cold load of ${c.hash} lands on the right route`, async ({ page }) => {
    await page.goto(`/${c.hash}`);
    await settle(page, 500);
    expect(new URL(page.url()).hash).toBe(c.hash);
    await expect(page.locator(`a[href="${c.topNav}"][aria-current="page"]:visible`).first()).toBeVisible();
    if (c.sectionNav) await expect(page.locator(`a[href="${c.sectionNav}"][aria-current="page"]`).first()).toBeVisible();
    await expect(previewStrip(page)).toHaveCount(0);
  });
}

test("hash changes after load route without a reload or a request", async ({ page, net }) => {
  await page.goto("/#/console/overview");
  await settle(page, 500);
  const before = net.mark();
  const marker = await page.evaluate(() => { (window as unknown as { __k: number }).__k = 1; return 1; });
  await page.evaluate(() => { location.hash = "#/console/skills"; });
  await expect(page.locator('a[href="#/console/skills"][aria-current="page"]').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __k?: number }).__k)).toBe(marker); // same document
  expect(dataRequests(net.since(before))).toEqual([]);
  await page.goBack();
  await expect(page.locator('a[href="#/console/overview"][aria-current="page"]').first()).toBeVisible();
});
