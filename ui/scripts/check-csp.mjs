// Loads every route (and the interactive flows) of the PREVIEW build in Chromium while serving dist exactly as
// vercel.json says: rewrites plus the real response headers, including the Content-Security-Policy. Fails on any
// `securitypolicyviolation` event, CSP console message, page error or off-origin request.
//   VITE_PREVIEW=1 npm run build && node scripts/check-csp.mjs [dist] [vercel.json]
// CSP_OVERRIDE="<policy>" tries a different policy against the same build (for tightening experiments).
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.mjs";
import { ROUTES, SIZES } from "./lib/routes.mjs";
import { exerciseAll } from "./lib/exercise.mjs";
import { loadVercelConfig, serveLikeVercel, headersFor } from "./lib/vercel-static.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = process.argv[2] ?? here("../dist");
const config = loadVercelConfig(process.argv[3] ?? here("../vercel.json"));
if (process.env.CSP_OVERRIDE) {
  for (const h of config.headers) for (const x of h.headers) if (x.key === "Content-Security-Policy") x.value = process.env.CSP_OVERRIDE;
}
const csp = headersFor(config, "/")["Content-Security-Policy"];
if (!csp) { console.error("vercel.json sets no Content-Security-Policy for /"); process.exit(1); }

const server = await serveLikeVercel({ dist, config });
const origin = new URL(server.url).origin;
const browser = await launchBrowser();
const problems = [];
const seen = new Set();

async function watch(page, where) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: (e.sample || "").slice(0, 80), source: e.sourceFile ? `${e.sourceFile}:${e.lineNumber}` : "" }));
  });
  page.on("console", (m) => { if (m.type() === "error" || /content security policy|refused to/i.test(m.text())) problems.push({ where, kind: "console", text: m.text().slice(0, 160) }); });
  page.on("pageerror", (e) => problems.push({ where, kind: "pageerror", text: e.message }));
  page.on("request", (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith("data:")) problems.push({ where, kind: "off-origin", text: r.url() }); });
}
async function collect(page, where) {
  const v = await page.evaluate(() => window.__csp ?? []).catch(() => []);
  for (const x of v) {
    const key = `${x.directive}|${x.blocked}|${x.sample}`;
    if (!seen.has(key + where)) { seen.add(key + where); problems.push({ where, kind: "csp-violation", text: JSON.stringify(x) }); }
  }
}

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, baseURL: server.url });
  for (const r of ROUTES) {
    const page = await ctx.newPage();
    const where = `${r.hash} @${size.width}`;
    await watch(page, where);
    const resp = await page.goto(r.hash, { waitUntil: "networkidle" });
    if (resp && resp.headers()["content-security-policy"] !== csp) problems.push({ where, kind: "header", text: "response lacks the configured CSP" });
    await page.waitForTimeout(800);
    await collect(page, where);
    await page.close();
  }
  if (size.width === 1440) {
    const page = await ctx.newPage();
    await watch(page, "interactions");
    const done = await exerciseAll(page);
    await collect(page, "interactions");
    console.log("interactions exercised:", JSON.stringify(done));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
await server.close();

console.log(`CSP: ${csp}`);
if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  [${p.kind}] ${p.where}: ${p.text}`);
  process.exit(1);
}
console.log(`OK: ${ROUTES.length} routes x ${SIZES.length} sizes plus interactions, no CSP violation, console error or off-origin request.`);
