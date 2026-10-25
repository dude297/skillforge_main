// Baseline shots: landing + console, for comparison with the guided demo.
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
const b = await launchBrowser();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  for (const [name, url] of [["landing", "#/"], ["console", "#/console/investigations"], ["demo", "#/demo"]]) {
    await page.goto(`http://127.0.0.1:4173/${url}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `screenshots/demo/before-${name}-${w}.png` });
  }
  await page.close();
}
await b.close();
