// Capture the cinematic at given times. Usage: node scripts/cine-shot.mjs <url> <outPrefix> [ms,ms,...] [WxH]
// Reports WebGL availability, console errors and off-origin requests. Works with PW_CHROMIUM_PATH (SwiftShader WebGL).
import { launchBrowser } from "./browser.mjs";
const [url, out = "cine", times = "500,2000,4000,6000,8000,10000", size = "1440x900"] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
const b = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: w, height: h } });
const errors = [], external = [];
const origin = new URL(url).origin;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("request", (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u); });
await page.goto(url);
const gl = await page.evaluate(() => { const c = document.createElement("canvas"); const g = c.getContext("webgl2") || c.getContext("webgl"); return g ? (g.getParameter(g.VERSION) + " | " + (g.getExtension("WEBGL_debug_renderer_info") ? g.getParameter(g.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL) : "")) : "none"; });
let last = 0;
for (const t of times.split(",").map(Number)) { await page.waitForTimeout(t - last); last = t; await page.screenshot({ path: `${out}-${t}.png` }); }
console.log(JSON.stringify({ webgl: gl, errors, external }));
await b.close();
