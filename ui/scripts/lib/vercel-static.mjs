// Serves a build directory the way vercel.json says Vercel will: filesystem first, then `rewrites`, with the
// configured `headers` on every response. Used by check-csp and the preview suite's config spec, because
// `vite preview` ignores vercel.json. Source patterns are treated as anchored regular expressions, which covers the
// two forms we use ("/(.*)" and "/assets/(.*)"); anything with a :param is rejected loudly rather than guessed.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain",
};

export function loadVercelConfig(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourceRegex(src) {
  if (/:[A-Za-z_]/.test(src)) throw new Error(`vercel-static: path-to-regexp params are not emulated: ${src}`);
  return new RegExp(`^${src}$`);
}

export function matchRewrite(config, pathname) {
  for (const r of config.rewrites ?? []) if (sourceRegex(r.source).test(pathname)) return r.destination;
  return null;
}

export function headersFor(config, pathname) {
  const out = {};
  for (const h of config.headers ?? []) {
    if (!sourceRegex(h.source).test(pathname)) continue;
    for (const { key, value } of h.headers) out[key] = value;
  }
  return out;
}

/** @returns {Promise<{ url: string, close: () => Promise<void> }>} */
export async function serveLikeVercel({ dist, config, port = 0, host = "127.0.0.1" }) {
  const root = resolve(dist);
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const send = (status, body, type, extra = {}) => {
      res.writeHead(status, { "Content-Type": type, ...headersFor(config, pathname), ...extra });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    try {
      let file = normalize(join(root, pathname === "/" ? "index.html" : pathname));
      if (file !== root && !file.startsWith(root + sep)) return send(403, "forbidden", "text/plain");
      let st = await stat(file).catch(() => null);
      if (st?.isDirectory()) { file = join(file, "index.html"); st = await stat(file).catch(() => null); }
      if (!st) {
        const dest = matchRewrite(config, pathname);
        if (!dest) return send(404, "not found", "text/plain");
        file = join(root, dest);
      }
      send(200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
    } catch (e) {
      send(500, String(e), "text/plain");
    }
  });
  await new Promise((ok) => server.listen(port, host, ok));
  const { port: p } = server.address();
  return { url: `http://${host}:${p}/`, close: () => new Promise((ok) => server.close(() => ok())) };
}
