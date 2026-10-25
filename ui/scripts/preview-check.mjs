// Preview build check: no request to /ui/*, the banner is shown, Live is not offered. Usage: node scripts/preview-check.mjs <base>
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:4174/";
const b = await chromium.launch({ channel: "msedge" });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const hits = [];
page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/ui")) hits.push(r.url()); });
for (const h of ["#/", "#/demo", "#/world", "#/world/onboard", "#/console/investigations", "#/console/investigations/incident", "?source=live#/console/overview"]) {
  await page.goto(base + h); await page.waitForTimeout(1200);
}
const banner = await page.getByText("Read-only preview · recorded/synthetic data").count();
const liveRadio = await page.getByRole("radio", { name: /^Live/ }).count();
await page.goto(base + "#/demo"); await page.waitForTimeout(800);
await page.screenshot({ path: "screenshots/demo/preview-demo-1440.png" });
console.log(JSON.stringify({ uiRequests: hits, banner, liveRadio }));
await b.close();
if (hits.length || !banner || liveRadio) process.exit(1);
