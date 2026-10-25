// UI Lab tour: one screenshot per important route at desktop and phone widths, plus console/page errors and any
// request that leaves the origin. Run against `npm run preview` (127.0.0.1:4173), preview or normal build.
//   node scripts/lab-tour.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { launchBrowser } from "./browser.mjs";

const out = process.argv[2] ?? "screenshots/lab";
const BASE = process.env.BASE ?? "http://127.0.0.1:4173/";
const ROUTES = [
  ["story", "#/"], ["onboard", "#/world/onboard"], ["bootstrap", "#/world/bootstrap"], ["world", "#/world"],
  ["console-investigations", "#/console/investigations"], ["console-overview", "#/console/overview"],
  ["console-skills", "#/console/skills"], ["console-history", "#/console/history"],
  ["console-benchmarks", "#/console/benchmarks"], ["console-system", "#/console/system"],
  ["demo", "#/demo"], ["pitch", "#/demo/pitch"],
];
const SIZES = (process.env.SIZES ?? "1440x900,390x844").split(",").map((s) => s.split("x").map(Number));
mkdirSync(out, { recursive: true });
const origin = new URL(BASE).origin;
const report = [];
const browser = await launchBrowser();
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  for (const [name, hash] of ROUTES) {
    const page = await ctx.newPage();
    const errors = [], external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("request", (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith("data:")) external.push(r.url()); });
    await page.goto(BASE + hash, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${out}/${name}-${w}.png` });
    report.push({ route: hash, width: w, errors, external, horizontalOverflowPx: overflow });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.errors.length || r.external.length || r.horizontalOverflowPx > 0);
console.log(`${report.length} captures, ${bad.length} with issues`);
for (const r of bad) console.log(JSON.stringify(r));
