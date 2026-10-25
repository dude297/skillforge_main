// Visual QA for the Bootstrap illustration (exp/bootstrap). Needs `npm run preview` (built bundle on :4173).
//   node scripts/bootstrap-shots.mjs [outDir]
// Desktop widths scroll the real page to exact progress values (settled scenes + transition frames); 390 and
// reduced motion capture the settled cards. Any non-local request fails the run (assets must be bundled).
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "screenshots/bootstrap";
const BASE = process.env.BASE ?? "http://127.0.0.1:4173/";
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const problems = [];
const FRAMES = [["1-appliance", 0], ["2-connect", 0.25], ["3-discover", 0.5], ["4-permissions", 0.75],
  ["t1-transition", 0.84], ["t2-transition", 0.9], ["t3-transition", 0.95], ["5-office", 1]];

for (const [w, h, reduced] of [[1440, 900, false], [1024, 768, false], [768, 1024, false], [390, 844, false], [1440, 900, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  page.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) problems.push(`external request ${r.url()}`); });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  await page.goto(`${BASE}#/world/bootstrap`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const tag = `${w}${reduced ? "-reduced" : ""}`;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) problems.push(`${tag}: horizontal overflow ${overflow}px`);
  if (w >= 768 && !reduced) {
    for (const [name, p] of FRAMES) {
      await page.evaluate((p) => {
        const s = document.querySelector("section[aria-labelledby=bs-h]");
        const top = s.getBoundingClientRect().top + scrollY;
        window.scrollTo(0, p === 0 ? 0 : top + p * (s.offsetHeight - innerHeight));
      }, p);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${name}-${tag}.png` });
    }
    // the hand-over: first beat of the world's own story, stage in the same place
    await page.evaluate(() => document.querySelector("#story [data-beat='0']")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/6-world-story-${tag}.png` });
  } else {
    const cards = page.locator("section[aria-labelledby=bs-h-s] li.world-card");
    const n = await cards.count();
    for (let i = 0; i < n; i++) await cards.nth(i).screenshot({ path: `${out}/card${i + 1}-${tag}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "no external requests, no page errors, no horizontal overflow");
