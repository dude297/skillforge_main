// Runtime cost, measured (CDP Performance metrics in the installed Edge). The GB10 runs inference beside the
// browser, so idle pages must cost ~nothing and scrolling must not produce long tasks.
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";

const BASE = "http://127.0.0.1:4173/";
const b = await launchBrowser();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

async function idle(label, seconds = 5) {
  const a = await metrics();
  await page.waitForTimeout(seconds * 1000);
  const z = await metrics();
  const busy = z.TaskDuration - a.TaskDuration;
  console.log(`${label.padEnd(34)} main-thread busy ${(100 * busy / seconds).toFixed(2)}%  layouts ${z.LayoutCount - a.LayoutCount}  style recalcs ${z.RecalcStyleCount - a.RecalcStyleCount}`);
}

async function scrollStory() {
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async () => {
    const long = [];
    const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration)));
    po.observe({ type: "longtask", buffered: false });
    const end = document.documentElement.scrollHeight - innerHeight;
    let frames = 0, worst = 0, last = performance.now();
    const t0 = last;
    await new Promise((done) => {
      const step = () => {
        const now = performance.now();
        worst = Math.max(worst, now - last); last = now; frames++;
        const k = (now - t0) / 6000;
        window.scrollTo(0, Math.min(1, k) * end);
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    po.disconnect();
    const secs = (performance.now() - t0) / 1000;
    return { fps: frames / secs, worstFrameMs: worst, longTasks: long.length, longestTaskMs: Math.max(0, ...long) };
  });
  console.log(`story full scroll (6 s, rAF-driven)    ${r.fps.toFixed(1)} fps, worst frame ${r.worstFrameMs.toFixed(1)} ms, long tasks ${r.longTasks} (longest ${r.longestTaskMs.toFixed(0)} ms)`);
}

await page.goto(BASE);
await page.waitForTimeout(3500); // after the hero sequence
await idle("story, idle after load");
await scrollStory();
await idle("story, idle at the bottom");
await page.goto(BASE + "#/console/investigations");
await page.waitForTimeout(800);
await idle("console, idle (no run)");
await page.getByRole("button", { name: /^Start/ }).click();
await page.getByRole("button", { name: "Approve change" }).waitFor();
await idle("console, waiting for approval");
await page.goto(BASE + "#/console/history");
await page.getByRole("button", { name: "Replay" }).click();
await idle("console, history replay playing", 4);
await b.close();
