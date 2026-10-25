// EXPERIMENT: walk #/world in a treatment: hero, each scroll beat, a department popover, the replay.
//   node scripts/world-tour.mjs <outDir> <daylight|night> [width] [--reduced]
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const [out = "screenshots/world", theme = "daylight", width = "1440"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const reduced = process.argv.includes("--reduced");
const BASE = process.env.BASE ?? "http://127.0.0.1:4173/";
mkdirSync(out, { recursive: true });
const w = Number(width), h = w < 600 ? 844 : 900;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const tag = `${theme}-${w}${reduced ? "-rm" : ""}`;
await page.goto(`${BASE}?t=${theme}#/world`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/${tag}-0hero.png` });
if (w >= 768) {
  const beats = await page.locator(".world-beat").count();
  for (let i = 0; i < beats; i++) {
    await page.locator(".world-beat").nth(i).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForTimeout(reduced ? 300 : 1500);
    await page.screenshot({ path: `${out}/${tag}-beat${i + 1}.png` });
  }
  // a department popover in the story (keyboard: focus + Enter)
  await page.getByRole("button", { name: /Human review desk/ }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${tag}-popover.png` });
  await page.keyboard.press("Escape");
} else {
  await page.screenshot({ path: `${out}/${tag}-cards.png`, fullPage: true });
}
await page.locator("#replay").evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/${tag}-replay-end.png` });
await page.getByRole("button", { name: "Restart" }).click();
for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "Next event" }).click();
await page.waitForTimeout(1300);
await page.getByRole("button", { name: /Independent check/ }).last().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/${tag}-replay-step9.png` });
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
