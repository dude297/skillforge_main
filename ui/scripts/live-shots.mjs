// Screenshots of the LIVE console served by the operator API (`python -m app ui`), i.e. real backend state.
//   node scripts/live-shots.mjs [outDir] [--watch N]     (run from ui/, with the same APP_OPERATOR_TOKEN/APP_DB env
//   as the running `python -m app ui`: it mints its own one-time login link with `python -m app ui --link`)
// --watch N: capture the Investigations view once a second for N seconds (use while scripts/rehearse.py runs): a
//   frame-by-frame recording of real backend state. --video also records .webm (needs Playwright's ffmpeg:
//   `npx playwright install ffmpeg`, a small one-time download into the Playwright cache).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "screenshots/live";
const watchAt = process.argv.indexOf("--watch");
const watch = watchAt > 0 ? Number(process.argv[watchAt + 1]) : 0;
const video = process.argv.includes("--video");
const BASE = process.env.BASE ?? "http://127.0.0.1:8766/";
const PORT = new URL(BASE).port || "8766";
const link = () => execFileSync(process.env.PYTHON ?? "python", ["-m", "app", "ui", "--link", "--port", PORT], { cwd: "..", encoding: "utf-8" }).trim();
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const errors = [];
for (const [w, h] of watch ? [[1440, 900]] : [[1440, 900], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: watch ? "no-preference" : "reduce",
    ...(watch && video ? { recordVideo: { dir: `${out}/video`, size: { width: w, height: h } } } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(link());
  await page.evaluate(() => document.fonts.ready);
  if (watch) {
    await page.goto(`${BASE}#/console/investigations`);
    for (let i = 0; i < watch; i++) {
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${out}/watch-${String(i).padStart(3, "0")}.png` });
    }
    await ctx.close(); // finalizes the video
    continue;
  }
  // presenter: beats 4-6 use this system's records when they exist
  await page.goto(`${BASE}#/demo`);
  await page.waitForTimeout(1500);
  for (let k = 1; k <= 5; k++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    if (k >= 3) await page.screenshot({ path: `${out}/present-beat${k + 1}-${w}.png` });
  }
  for (const sec of ["overview", "investigations", "skills", "history", "benchmarks", "system"]) {
    await page.goto(`${BASE}#/console/${sec}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${sec}-${w}.png`, fullPage: sec !== "investigations" || w < 600 });
  }
  // every task in the list, newest first
  await page.goto(`${BASE}#/console/investigations`);
  await page.waitForTimeout(1200);
  const n = await page.getByRole("complementary", { name: /^All/ }).getByRole("button").count();
  for (let i = 0; i < n; i++) {
    await page.getByRole("complementary", { name: /^All/ }).getByRole("button").nth(i).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/task${i}-${w}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
