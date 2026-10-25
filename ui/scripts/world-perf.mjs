// EXPERIMENT: same measurements for the 2.5D scene (ui, :4173 #/world replay playing) and the 3D spike (:4175).
// Installed Edge with the hardware GPU (ANGLE/D3D11). Prints one JSON object; numbers are from THIS dev box.
import { chromium } from "@playwright/test";
import { launchBrowser } from "./browser.mjs";
import { execSync, spawn } from "node:child_process";

const WINDOW_MS = 6000;
const TARGETS = {
  "2.5D": { url: "http://127.0.0.1:4173/?t=daylight#/world", setup: async (p) => {
    await p.locator("#replay").evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await p.getByRole("button", { name: "Restart" }).click();
    await p.getByRole("button", { name: /^(Play|Replay)$/ }).click();
  } },
  "3D": { url: "http://127.0.0.1:4175/", setup: async () => {} },
};

const gpuCpu = () => { // CPU seconds used so far by Edge's GPU process(es)
  try {
    return Number(execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*--type=gpu-process*' } | ForEach-Object { (Get-Process -Id $_.ProcessId).CPU } | Measure-Object -Sum).Sum"`).toString().trim() || 0);
  } catch { return null; }
};

function burner(seconds) { // a CPU-bound "busy workload": N processes counting loop iterations
  const n = 4;
  return Promise.all(Array.from({ length: n }, () => new Promise((res) => {
    const p = spawn("python", ["-c", `import time\nt=time.time()+${seconds}\nn=0\nwhile time.time()<t:\n n+=1\nprint(n)`]);
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.on("close", () => res(Number(out.trim())));
  }))).then((xs) => xs.reduce((a, b) => a + b, 0));
}

async function measure(browser, name, { width = 1440, height = 900, throttle = 1, reduced = false, load = false } = {}) {
  const t = TARGETS[name];
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  let bytes = 0, js = 0; const foreign = [];
  const types = new Map();
  cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; if (types.get(e.requestId) === "Script") js += e.encodedDataLength; });
  page.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1")) foreign.push(r.url()); });
  const t0 = Date.now();
  await page.goto(t.url, { waitUntil: "load" });
  await page.waitForSelector("[role=group] svg, canvas", { timeout: 20000 });
  const ready = Date.now() - t0;
  await page.waitForTimeout(1000);
  await t.setup(page);
  await page.waitForTimeout(1000);
  const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const before = await m(), g0 = gpuCpu();
  const work = load ? burner(WINDOW_MS / 1000) : Promise.resolve(null);
  const frames = await page.evaluate((ms) => new Promise((res) => {
    const out = []; let last = performance.now(); const end = last + ms;
    const tick = (now) => { out.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else res(out); };
    requestAnimationFrame(tick);
  }), WINDOW_MS);
  const after = await m(), g1 = gpuCpu(), burned = await work;
  const sorted = [...frames].sort((a, b) => a - b);
  await ctx.close();
  return {
    target: name, viewport: `${width}x${height}`, cpu_throttle: throttle, reduced_motion: reduced, busy_workload: load,
    ready_ms: ready, transferred_kb: Math.round(bytes / 1024), js_kb: Math.round(js / 1024), foreign_requests: foreign.length,
    js_heap_mb: +(after.JSHeapUsedSize / 1048576).toFixed(1), dom_nodes: after.Nodes,
    fps: +(frames.length / (WINDOW_MS / 1000)).toFixed(1), frame_p95_ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
    long_frames_over_33ms: frames.filter((f) => f > 33.4).length,
    main_thread_busy_pct: +(((after.TaskDuration - before.TaskDuration) / (WINDOW_MS / 1000)) * 100).toFixed(1),
    gpu_process_cpu_s: g0 == null || g1 == null ? null : +(g1 - g0).toFixed(2),
    workload_iterations: burned,
  };
}

const browser = await launchBrowser({ args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
const results = [];
const baseline = await burner(WINDOW_MS / 1000);
for (const name of Object.keys(TARGETS)) {
  results.push(await measure(browser, name));
  results.push(await measure(browser, name, { load: true }));
  results.push(await measure(browser, name, { width: 390, height: 844, throttle: 4 }));
  results.push(await measure(browser, name, { reduced: true }));
}
await browser.close();
console.log(JSON.stringify({ workload_baseline_iterations: baseline, results }, null, 1));
