// Runtime cost of the Bootstrap prelude vs the world without it (same method as perf.mjs: CDP metrics in the
// installed Edge). Needs `npm run preview`. Numbers are this dev box only; the GB10 runs inference beside the browser.
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";

const BASE = "http://127.0.0.1:4173/";
const b = await launchBrowser();

async function measure(hash) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  await page.goto(BASE + hash);
  await page.waitForTimeout(2500);
  const js = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".js"))
    .reduce((n, r) => n + (r.encodedBodySize || 0), 0));
  const idle = async (s = 4) => { const a = await m(); await page.waitForTimeout(s * 1000); const z = await m(); return (100 * (z.TaskDuration - a.TaskDuration)) / s; };
  const idleTop = await idle();
  const scroll = await page.evaluate(async () => {
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
    return { fps: frames / ((performance.now() - t0) / 1000), worst, long: long.length, longest: Math.max(0, ...long), height: document.documentElement.scrollHeight };
  });
  const idleBottom = await idle();
  await page.close();
  console.log(`${hash.padEnd(20)} js ${(js / 1024).toFixed(0)} KB (compressed, all loaded chunks)  page ${scroll.height}px  ` +
    `scroll ${scroll.fps.toFixed(1)} fps, worst frame ${scroll.worst.toFixed(1)} ms, long tasks ${scroll.long} (longest ${scroll.longest.toFixed(0)} ms)  ` +
    `idle busy top ${idleTop.toFixed(2)}% bottom ${idleBottom.toFixed(2)}%`);
}

for (let i = 0; i < 2; i++) for (const h of ["#/world", "#/world/bootstrap"]) await measure(h);
await b.close();
