// Story frames at precise scroll positions (desktop): checks the scrubbed choreography, not just the top.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "screenshots/latest";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "msedge" });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:4173/");
await page.waitForSelector("#act-2", { state: "attached" }); // story chunk is lazy-loaded
await page.evaluate(() => document.fonts.ready);
const at = async (id, f, name) => {
  await page.evaluate(([id, f]) => {
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    // f = 0..1 of the section passing the viewport centre (same reference as the stage's useScroll offset)
    window.scrollTo(0, scrollY + r.top - innerHeight / 2 + f * r.height);
  }, [id, f]);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/frame-${name}.png` });
};
for (const f of [0.2, 0.45]) await at("act-2", f, `act2-${f}`);
for (const f of [0.12, 0.27, 0.42, 0.6, 0.78, 0.92]) await at("act-3", f, `act3-${f}`);
for (const f of [0.15, 0.45]) await at("act-4", f, `act4-${f}`);
await at("act-5", 0.4, "act5");
await b.close();
