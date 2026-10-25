// EXPERIMENT screenshots for exp/world (vite preview on :4173, installed Edge).
//   node scripts/world-shots.mjs [outDir] [route...]   e.g. node scripts/world-shots.mjs screenshots/world "#/world/lab"
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "screenshots/world";
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ["#/world/lab", "#/world"];
const BASE = process.env.BASE ?? "http://127.0.0.1:4173/";
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];
for (const [w, h] of (process.env.SIZES ?? "1440x900").split(",").map((s) => s.split("x").map(Number))) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const r of routes) {
    await page.goto(BASE + r);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    const name = r.replace(/[#/]+/g, "-").replace(/^-|-$/g, "") || "home";
    for (let f = 0; f < Number(process.env.FRAMES ?? 1); f++) {
      await page.screenshot({ path: `${out}/${name}-${w}${f ? `-f${f}` : ""}.png`, fullPage: process.env.FULL === "1" });
      await page.waitForTimeout(170);
    }
  }
  await page.close();
}
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
