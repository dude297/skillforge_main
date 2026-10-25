import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
const b = await launchBrowser();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:4173/#/demo");
  await page.evaluate(() => document.fonts.ready);
  for (let k = 1; k <= 7; k++) {
    await page.waitForTimeout(700);
    if ([2, 5, 7].includes(k) || w === 390 && k === 5) await page.screenshot({ path: `screenshots/latest/demo-${k}-${w}.png` });
    if (k === 4 && w === 1440) { await page.keyboard.press("n"); await page.waitForTimeout(200); await page.screenshot({ path: `screenshots/latest/demo-4-notes-${w}.png` }); await page.keyboard.press("n"); }
    await page.keyboard.press("ArrowRight");
  }
  await page.close();
}
await b.close();
