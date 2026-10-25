import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { headersFor, loadVercelConfig, matchRewrite, serveLikeVercel } from "../scripts/lib/vercel-static.mjs";

// vercel.json, exercised against ui/dist through a static server that applies its rewrites and headers.
// (vite preview ignores vercel.json, so this is the only place the real config is tested end to end.)
const dist = fileURLToPath(new URL("../dist", import.meta.url));
const config = loadVercelConfig(fileURLToPath(new URL("../vercel.json", import.meta.url)));

const test = base.extend<object, { site: string }>({
  site: [async ({}, use) => { // eslint-disable-line no-empty-pattern
    const s = await serveLikeVercel({ dist, config });
    await use(s.url);
    await s.close();
  }, { scope: "worker" }],
});
const get = (site: string, path: string) => fetch(new URL(path, site));
const assets = readdirSync(`${dist}/assets`);
const firstAsset = (ext: string) => `/assets/${assets.find((a) => a.endsWith(ext))}`;

test.describe("rewrites", () => {
  test("SPA paths fall back to index.html; /assets and /demo never do", () => {
    for (const p of ["/", "/console", "/console/skills", "/world/onboard", "/anything/else", "/assetsfoo", "/demonstration"]) expect(matchRewrite(config, p), p).toBe("/index.html");
    for (const p of ["/assets/x.js", "/assets/nested/x.css", "/demo/oncall-run.recorded.json", "/demo/x"]) expect(matchRewrite(config, p), p).toBeNull();
  });

  test("real files are served as themselves, not as index.html", async ({ site }) => {
    const js = await get(site, firstAsset(".js"));
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    const css = await get(site, firstAsset(".css"));
    expect(css.headers.get("content-type")).toMatch(/css/);
    const font = await get(site, firstAsset(".woff2"));
    expect(font.headers.get("content-type")).toMatch(/woff2/);
    const run = await get(site, "/demo/oncall-run.recorded.json");
    expect(run.status).toBe(200);
    const j = await run.json();
    expect(j.schema).toBe("skillforge.oncall_run/1");
  });

  test("a missing asset or demo file is a 404, not an HTML page that fails later as a script", async ({ site }) => {
    expect((await get(site, "/assets/nope-123.js")).status).toBe(404);
    expect((await get(site, "/demo/nope.json")).status).toBe(404);
  });

  test("unknown paths and the operator API prefix serve the app shell (no backend exists on Vercel)", async ({ site }) => {
    for (const p of ["/console/skills", "/ui/status", "/ui/tasks"]) {
      const r = await get(site, p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("content-type"), p).toMatch(/text\/html/);
    }
  });
});

test.describe("headers", () => {
  const PATHS = ["/", "/console/skills", "/assets/x-nonexistent.js", "/demo/oncall-run.recorded.json"];

  test("security headers on every response, including 404s", async ({ site }) => {
    for (const p of PATHS) {
      const r = await get(site, p);
      expect(r.headers.get("x-robots-tag"), p).toBe("noindex");
      expect(r.headers.get("x-content-type-options"), p).toBe("nosniff");
      expect(r.headers.get("referrer-policy"), p).toBe("no-referrer");
      const pp = r.headers.get("permissions-policy") ?? "";
      for (const f of ["camera", "microphone", "geolocation"]) expect(pp, `${p} ${f}`).toContain(`${f}=()`);
      expect(r.headers.get("content-security-policy"), p).toBeTruthy();
    }
  });

  test("CSP is strict: self-only, no eval, no inline scripts, no wildcard or remote sources, no framing, no forms", async ({ site }) => {
    const csp = (await get(site, "/")).headers.get("content-security-policy")!;
    const d = Object.fromEntries(csp.split(";").map((s) => s.trim()).filter(Boolean).map((s) => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["img-src"]).toEqual(expect.arrayContaining(["'self'", "data:"]));
    expect(d["worker-src"], "WebGL layer may use blob workers, nothing remote").toEqual(["'self'", "blob:"]);
    expect(d["img-src"]).toEqual(expect.arrayContaining(["blob:"]));
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(d["script-src"].join(" ")).not.toMatch(/unsafe-inline/);
    for (const [k, v] of Object.entries(d)) for (const src of v as string[]) expect(src, `${k} source`).not.toMatch(/^(\*|https?:|wss?:|http:\/\/|https:\/\/)/);
  });

  test("hashed assets are cached for a year as immutable; the app shell and demo data are not", async ({ site }) => {
    expect((headersFor(config, "/assets/index-abc.js") as Record<string, string>)["Cache-Control"]).toMatch(/max-age=31536000.*immutable/);
    const js = await get(site, firstAsset(".js"));
    expect(js.headers.get("cache-control")).toMatch(/max-age=31536000.*immutable/);
    expect((await get(site, "/")).headers.get("cache-control")).toBeNull();
    expect((await get(site, "/demo/oncall-run.recorded.json")).headers.get("cache-control")).toBeNull();
  });
});

test("dist contains only what a public preview should ship", () => {
  const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? all(`${dir}/${e.name}`).map((f) => `${e.name}/${f}`) : [e.name]);
  const files = all(dist);
  expect(files.filter((f) => /\.map$|(^|\/)\.env/.test(f))).toEqual([]);
  expect(files).toContain("index.html");
  expect(files).toContain("demo/oncall-run.recorded.json");
  const html = readFileSync(`${dist}/index.html`, "utf8");
  expect(html, "no inline scripts (CSP script-src 'self')").not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
  expect(html, "no inline <style> or style attributes").not.toMatch(/<style|\sstyle=/);
});
