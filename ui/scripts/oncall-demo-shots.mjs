// Guided demo (#/demo) scene screenshots, desktop 1440 and mobile 390, against `vite preview` on :4173.
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
const b = await launchBrowser();
const out = process.argv[2] ?? "screenshots/demo";
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:4173/#/demo");
  await page.evaluate(() => document.fonts.ready);
  for (let k = 1; k <= 6; k++) {
    await page.waitForTimeout(1600); // Ember's walk (1.1 s) settles
    await page.screenshot({ path: `${out}/scene-${k}-${w}.png`, fullPage: w === 390 });
    if (k < 6) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.goto("http://127.0.0.1:4173/#/");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/after-landing-${w}.png` });
  await page.goto("http://127.0.0.1:4173/#/console/investigations/incident");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/after-console-incident-${w}.png` });
  await page.close();
}
await b.close();
