// Scans a built `dist/` (run it after `VITE_PREVIEW=1 npm run build`) for things that must never be published:
// secrets, private/loopback/LAN URLs, absolute filesystem paths, source maps, .env files and a baked operator API.
//   node scripts/scan-public.mjs [dist] [--json]
// Exit 1 on any finding that is not in ALLOW below. Every ALLOW entry needs a `reason`; keep the list short.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const root = resolve(args.find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("../dist", import.meta.url)));
const uiDir = fileURLToPath(new URL("..", import.meta.url));

/** Reviewed, deliberate occurrences. { rule, file: RegExp on the dist-relative path, match: RegExp on the matched text, reason } */
const ALLOW = [
  // (empty on purpose: add an entry only with a written reason, e.g. a host command shown to operators that must
  //  mention a loopback address. Whether that is acceptable in a PUBLIC preview is a product decision; see the report.)
];

const BINARY = new Set([".woff2", ".woff", ".ttf", ".otf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp4", ".webm", ".pdf"]);
const BAD_FILE = [
  { rule: "source-map", re: /\.map$/i, why: "source maps expose original source" },
  { rule: "env-file", re: /(^|\/)\.env(\.|$)/i, why: ".env file published" },
  { rule: "key-file", re: /\.(pem|key|p12|pfx|kdbx)$|(^|\/)id_(rsa|ed25519)/i, why: "key material published" },
  { rule: "vcs-or-os-file", re: /(^|\/)(\.git|\.DS_Store|\.npmrc|\.netrc)(\/|$)/, why: "repo/OS/credential file published" },
  { rule: "database-file", re: /\.(db|sqlite3?|log)$/i, why: "data or log file published" },
];

const IPV4_PRIVATE = String.raw`(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})(?![\d]|\.\d)`;
// secret: true => the match is redacted in the report
const RULES = [
  { rule: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, secret: true },
  { rule: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/g, secret: true },
  { rule: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, secret: true },
  { rule: "openai-key", re: /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{32,}/g, secret: true },
  { rule: "nvidia-key", re: /\bnvapi-[A-Za-z0-9_-]{16,}/g, secret: true },
  { rule: "slack-token", re: /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g, secret: true },
  { rule: "slack-webhook", re: /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/g, secret: true },
  { rule: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, secret: true },
  { rule: "stripe-key", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/g, secret: true },
  { rule: "private-key-block", re: /-----BEGIN [A-Z0-9 ]*KEY(?: BLOCK)?-----/g, secret: true },
  { rule: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, secret: true },
  { rule: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g, secret: true },
  { rule: "assigned-secret", re: /\b(?:api[_-]?key|secret|passwd|password|auth[_-]?token|access[_-]?token|agent[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{20,}["']/gi, secret: true },
  { rule: "private-url-loopback", re: /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s"'`)<>]*/gi },
  { rule: "private-url-lan", re: new RegExp(`https?://(?:[^\\s"'\`/@]*@)?${IPV4_PRIVATE}[^\\s"'\`)<>]*`, "g") },
  { rule: "private-host-suffix", re: /(?:https?:\/\/|\/\/|@|["'`\s=])[a-z0-9][a-z0-9.-]*\.(?:local|internal|lan|ts\.net|home\.arpa)(?::\d+)?(?=[\s"'`/:)<>,;]|$)/gi },
  { rule: "loopback-host-bare", re: /(?<![\w.-])(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?![\w-])/g },
  { rule: "lan-ip-bare", re: new RegExp(IPV4_PRIVATE, "g") },
  { rule: "abs-path-unix-home", re: /(?<![\w.-])\/(?:home|Users|root)\/[A-Za-z0-9_.-]+(?:\/[\w.@-]+)*/g },
  { rule: "abs-path-windows", re: /\b[A-Za-z]:\\{1,2}(?:Users|Windows|Program Files|home|dev|src|projects?)\\{1,2}[^\s"'`<>]*/gi },
  { rule: "operator-api-absolute-url", re: /https?:\/\/[^\s"'`]+\/ui\/(?:status|tasks|approvals|skills|events|health|bench|demo)\b/g },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield { path: p, rel: relative(root, p).split("\\").join("/"), size: st.size };
  }
}

// Values that must not be baked: whatever VITE_OPERATOR_API is in the environment or in a .env* file in ui/.
function operatorApiValues() {
  const vals = new Set();
  if (process.env.VITE_OPERATOR_API) vals.add(process.env.VITE_OPERATOR_API);
  for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const p = join(uiDir, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*VITE_OPERATOR_API\s*=\s*["']?([^"'\s#]+)/);
      if (m) vals.add(m[1]);
    }
  }
  return [...vals].filter((v) => v.length > 3 && v !== "/ui"); // "/ui" is the in-bundle default, not a baked value
}

const ctx = (text, i, len) => text.slice(Math.max(0, i - 40), i).replace(/\s+/g, " ") + "⟦" + text.slice(i, i + len).replace(/\s+/g, " ").slice(0, 80) + "⟧" + text.slice(i + len, i + len + 40).replace(/\s+/g, " ");
const redact = (s) => (s.length <= 8 ? "***" : `${s.slice(0, 6)}…(${s.length} chars)`);
const lineCol = (text, i) => { const before = text.slice(0, i); const line = before.split("\n").length; return `${line}:${i - before.lastIndexOf("\n")}`; };

if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`scan-public: ${root} does not exist. Build first: npm run build:preview`); process.exit(2); }
const baked = operatorApiValues();
const findings = [], allowed = [], hosts = new Map();
let files = 0, bytes = 0;
const push = (f) => {
  const a = ALLOW.find((x) => x.rule === f.rule && x.file.test(f.file) && x.match.test(f.match));
  (a ? allowed : findings).push(a ? { ...f, reason: a.reason } : f);
};

for (const f of walk(root)) {
  files++; bytes += f.size;
  for (const b of BAD_FILE) if (b.re.test(f.rel)) push({ rule: b.rule, file: f.rel, where: "(file name)", match: f.rel, context: b.why });
  if (BINARY.has(extname(f.rel).toLowerCase())) continue;
  const text = readFileSync(f.path, "utf8");
  if (/^\/\/# sourceMappingURL=|\/\*# sourceMappingURL=/m.test(text)) push({ rule: "source-map-reference", file: f.rel, where: "-", match: "sourceMappingURL", context: "bundle points at a source map" });
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      push({ rule: r.rule, file: f.rel, where: lineCol(text, m.index), match: r.secret ? redact(m[0]) : m[0].trim(), context: r.secret ? "(redacted)" : ctx(text, m.index, m[0].length) });
    }
  }
  if (/VITE_OPERATOR_API/.test(text)) {
    const i = text.indexOf("VITE_OPERATOR_API");
    push({ rule: "operator-api-env-name", file: f.rel, where: lineCol(text, i), match: "VITE_OPERATOR_API", context: ctx(text, i, 17) });
  }
  for (const v of baked) {
    for (let i = text.indexOf(v); i !== -1; i = text.indexOf(v, i + v.length)) push({ rule: "operator-api-baked", file: f.rel, where: lineCol(text, i), match: v, context: ctx(text, i, v.length) });
  }
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.set(m[1].toLowerCase(), (hosts.get(m[1].toLowerCase()) ?? 0) + 1);
}

if (asJson) {
  console.log(JSON.stringify({ root, files, bytes, findings, allowed, externalHostReferences: Object.fromEntries(hosts) }, null, 2));
} else {
  console.log(`scan-public: ${files} files, ${(bytes / 1024).toFixed(0)} KiB in ${root}`);
  const refs = [...hosts].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} (${n})`);
  console.log(`info: hostnames mentioned as text (not requests; the e2e suite proves no request leaves the origin): ${refs.join(", ") || "none"}`);
  for (const a of allowed) console.log(`allowed [${a.rule}] ${a.file} ${a.match}: ${a.reason}`);
  if (findings.length) {
    console.error(`\nFAIL: ${findings.length} finding(s)`);
    for (const f of findings) console.error(`  [${f.rule}] ${f.file}:${f.where}  ${f.match}\n      ${f.context}`);
  } else console.log("OK: no secrets, private URLs, absolute paths, source maps, .env files or baked operator API.");
}
process.exit(findings.length ? 1 : 0);
