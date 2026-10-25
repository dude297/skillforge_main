// axe-core sweep over every preview route at 1440 and 390, plus a few interactive states.
//   VITE_PREVIEW=1 npm run build && node scripts/a11y-sweep.mjs
// BASE=http://127.0.0.1:4173/ uses a server you already run; otherwise ui/dist is served the way vercel.json says.
// A11Y_OUT=<dir> (default qa-reports/a11y) receives a11y.json and a11y.md. A11Y_REDUCED=1 emulates reduced motion.
// Exit 1 on any serious or critical violation (moderate and minor are reported, not failed).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { launchBrowser } from "./browser.mjs";
import { ROUTES, SIZES } from "./lib/routes.mjs";
import { loadVercelConfig, serveLikeVercel } from "./lib/vercel-static.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = process.env.A11Y_OUT ?? here("../qa-reports/a11y");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FAIL = new Set(["serious", "critical"]);
const settle = async (page) => { await page.waitForLoadState("networkidle"); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1800); };

// Interactive states a static route load never shows.
const STATES = [
  { name: "console-investigation-waiting-for-approval", hash: "#/console/investigations", wide: true, act: async (page) => {
    await page.getByRole("button", { name: /^start/i }).click();
    await page.getByRole("button", { name: /^(simulate approval|approve)/i }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
  } },
  { name: "demo-after-keyboard-steps", hash: "#/demo", wide: true, act: async (page) => {
    await page.keyboard.press("Space");
    for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300); }
    await page.keyboard.press("n");
    await page.waitForTimeout(600);
  } },
];

let server = null, base = process.env.BASE;
if (!base) { server = await serveLikeVercel({ dist: here("../dist"), config: loadVercelConfig(here("../vercel.json")) }); base = server.url; }
const browser = await launchBrowser();
const results = [];

async function scan(ctx, label, hash, size, act) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + hash);
  await settle(page);
  if (act) await act(page);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = r.violations.map((v) => ({
    rule: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, wcag: v.tags.filter((t) => /^wcag\d/.test(t) || t.startsWith("best")),
    nodes: v.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), summary: (n.failureSummary ?? "").split("\n").slice(1).join(" ").slice(0, 220) })),
  }));
  results.push({ route: label, hash, width: size.width, pageErrors: errors, incomplete: r.incomplete.length, violations });
  await page.close();
}

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: process.env.A11Y_REDUCED ? "reduce" : "no-preference" });
  for (const r of ROUTES) await scan(ctx, r.name, r.hash, size);
  for (const s of STATES) await scan(ctx, s.name, s.hash, size, s.act);
  await ctx.close();
}
await browser.close();
await server?.close();

// ---- report
const flat = results.flatMap((r) => r.violations.flatMap((v) => v.nodes.map((n) => ({ route: r.route, hash: r.hash, width: r.width, rule: v.rule, impact: v.impact, target: n.target, summary: n.summary }))));
const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const byRule = new Map();
for (const f of flat) { const k = `${f.impact}|${f.rule}`; const e = byRule.get(k) ?? { impact: f.impact, rule: f.rule, count: 0, routes: new Set(), targets: new Set(), summary: f.summary }; e.count++; e.routes.add(`${f.route}@${f.width}`); e.targets.add(f.target); byRule.set(k, e); }
const groups = [...byRule.values()].sort((a, b) => rank[a.impact] - rank[b.impact] || b.count - a.count);
const blocking = flat.filter((f) => FAIL.has(f.impact));

mkdirSync(out, { recursive: true });
writeFileSync(`${out}/.gitignore`, "*\n"); // reports are generated, never committed
writeFileSync(`${out}/a11y.json`, JSON.stringify({ tags: TAGS, base, scans: results.length, blocking: blocking.length, results }, null, 2));
const md = [
  `# Accessibility sweep (axe-core, ${TAGS.join(", ")})`, "",
  `${results.length} scans (${ROUTES.length} routes + ${STATES.length} states, at ${SIZES.map((s) => s.width).join(" and ")} px). Blocking (serious/critical) nodes: **${blocking.length}**; other nodes: ${flat.length - blocking.length}.`, "",
  results.some((r) => r.pageErrors.length) ? `Page errors during the sweep: ${results.filter((r) => r.pageErrors.length).map((r) => `${r.route}@${r.width}`).join(", ")}\n` : "",
  "## By rule", "", "| impact | rule | nodes | where |", "|---|---|---|---|",
  ...groups.map((g) => `| ${g.impact} | ${g.rule} | ${g.count} | ${[...g.routes].slice(0, 6).join(", ")}${g.routes.size > 6 ? `, +${g.routes.size - 6}` : ""} |`), "",
  "## Every node (route, rule, target, impact); widths merged", "",
  ...[...flat.reduce((m, f) => { const k = `${f.impact}|${f.rule}|${f.route}|${f.target}`; const e = m.get(k) ?? { ...f, widths: [] }; e.widths.push(f.width); return m.set(k, e); }, new Map()).values()]
    .sort((a, b) => rank[a.impact] - rank[b.impact] || a.rule.localeCompare(b.rule) || a.route.localeCompare(b.route))
    .map((f) => `- ${f.impact}: \`${f.rule}\` ${f.route}@${f.widths.join("/")} \`${f.target}\`${f.summary ? ` (${f.summary.replace(/\s+/g, " ").trim()})` : ""}`), "",
].join("\n");
writeFileSync(`${out}/a11y.md`, md);

console.log(`a11y: ${results.length} scans, ${flat.length} violating node(s), ${blocking.length} serious/critical. Report: ${out}/a11y.md`);
for (const g of groups) console.log(`  ${g.impact.padEnd(8)} ${g.rule}  x${g.count}  e.g. ${[...g.targets][0]}  [${[...g.routes].slice(0, 3).join(", ")}]`);
process.exit(blocking.length ? 1 : 0);
