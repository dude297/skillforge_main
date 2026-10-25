// Visual QA screenshots against the built app (vite preview on :4173). Uses the installed Microsoft Edge via
// Playwright's channel option: no browser download. Deterministic: fonts awaited, fixed viewport sizes.
//   node scripts/shoot.mjs [outDir] [--reduced]
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "screenshots";
const reduced = process.argv.includes("--reduced");
const BASE = process.env.BASE ?? "http://127.0.0.1:4173/";
const ALL = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const WIDTHS = process.env.ONLY ? ALL.filter(([w]) => String(w) === process.env.ONLY) : ALL;
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
for (const [w, h] of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const tag = `${w}${reduced ? "-rm" : ""}`;

  await page.goto(BASE);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(reduced ? 300 : 2800); // let the one page-load sequence finish
  await page.screenshot({ path: `${out}/story-hero-${tag}.png` });
  // representative scroll positions through the five acts
  for (const n of [1, 2, 3, 4, 5]) {
    // the visible copy of act n centred in the viewport (desktop: scrubbed stage; mobile: static scene follows)
    await page.evaluate((id) => {
      const el = [...document.querySelectorAll(`#${id}, #${id}-s`)].find((e) => e.offsetParent !== null);
      el?.scrollIntoView({ block: "center", behavior: "instant" });
    }, `act-${n}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/story-act${n}-${tag}.png` });
  }

  for (const sec of ["overview", "skills", "history", "system"]) {
    await page.goto(BASE + "#/console/" + sec);
    await page.waitForTimeout(450);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${out}/section-${sec}-${tag}.png`, fullPage: true, animations: "disabled" });
  }
  await page.goto(BASE + "#/console/investigations");
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/console-idle-${tag}.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: /^Start/ }).click();
  await page.getByRole("button", { name: "Approve change" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/console-approval-${tag}.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Approve change" }).click();
  await page.getByRole("button", { name: "Turn this fix into a skill" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Turn this fix into a skill" }).click();
  await page.getByRole("button", { name: "Promote skill" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/console-skill-${tag}.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Promote skill" }).click();
  await page.getByRole("button", { name: "Run on new data" }).click();
  await page.getByRole("button", { name: "Approve both fixes" }).waitFor({ timeout: 15000 });
  if (process.env.DEBUG) for (let i = 0; i < 5; i++) { console.log(await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter((x) => x.textContent.includes("Approve both")); return JSON.stringify(b.map((x) => [x.getBoundingClientRect().y, getComputedStyle(x.closest(".p-5")).opacity])) + " scrollY=" + scrollY; })); await page.waitForTimeout(300); }
  // Geometry sampled stable (same y over 1.5 s, opacity 1, no scroll; see DEBUG above), yet Playwright's rAF
  // stability check stalls only in this sequence at 1024: harness quirk, so this one click skips it.
  await page.getByRole("button", { name: "Approve both fixes" }).click({ force: true });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/console-reuse-${tag}.png`, fullPage: true, animations: "disabled" });
  console.log(tag, errors.length ? `ERRORS: ${errors.join(" | ")}` : "no console errors");
  await ctx.close();
}
await browser.close();
