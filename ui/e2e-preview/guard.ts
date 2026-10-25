// Network and error guard for the hosted-preview suite. Importing `test` from here attaches the guard to every page
// automatically and fails the test at the end if the page broke ANY of the preview's trust rules:
//   - a request left the origin
//   - a request went to the operator API (a "ui" path segment, e.g. /ui/status)
//   - any request was not a GET (no POST/PUT/PATCH/DELETE/OPTIONS: nothing can approve, promote or execute)
//   - a console error, an uncaught page error, a failed request or an HTTP >= 400 from the origin
import { expect, test as base, type Page } from "@playwright/test";

export interface Net {
  /** every request the page made, in order */
  requests: { method: string; url: string }[];
  problems: string[];
  /** resets the log (keeps nothing) so a test can assert "this interaction made no request" */
  mark(): number;
  since(mark: number): { method: string; url: string }[];
}

const SKIP_SCHEMES = /^(data|blob|about):/;
const operatorPath = (u: URL) => u.pathname.split("/").includes("ui");

export function attach(page: Page, origin: string): Net {
  const net: Net = {
    requests: [], problems: [],
    mark: () => net.requests.length,
    since: (m) => net.requests.slice(m),
  };
  page.on("request", (r) => {
    const url = r.url();
    if (SKIP_SCHEMES.test(url)) return;
    net.requests.push({ method: r.method(), url });
    const u = new URL(url);
    if (u.origin !== origin) net.problems.push(`off-origin request: ${r.method()} ${url}`);
    if (operatorPath(u)) net.problems.push(`operator API request: ${r.method()} ${url}`);
    if (r.method() !== "GET") net.problems.push(`non-GET request: ${r.method()} ${url}`);
  });
  page.on("response", (r) => {
    const url = r.url();
    if (!SKIP_SCHEMES.test(url) && new URL(url).origin === origin && r.status() >= 400) net.problems.push(`HTTP ${r.status()}: ${url}`);
  });
  page.on("requestfailed", (r) => {
    if (/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) return; // navigation cancelled an in-flight fetch
    net.problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  page.on("console", (m) => { if (m.type() === "error") net.problems.push(`console error: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => net.problems.push(`page error: ${e.message.slice(0, 200)}`));
  page.on("dialog", (d) => { net.problems.push(`unexpected dialog: ${d.message().slice(0, 80)}`); void d.dismiss(); });
  return net;
}

export const test = base.extend<{ net: Net }>({
  net: [async ({ page, baseURL }, use) => {
    const net = attach(page, new URL(baseURL!).origin);
    await use(net);
    expect(net.problems, "preview trust rules (origin, operator API, non-GET, errors)").toEqual([]);
  }, { auto: true }],
});
export { expect };

/** Wait for the app to render and settle (fonts, lazy route chunk, entry animations). */
export async function settle(page: Page, ms = 900) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

/** The preview strip. Matched by its stable phrase, not by role or styling. */
export const previewStrip = (page: Page) => page.getByText(/read-only preview/i).first();

/** Any control that offers the live source: radio, tab, button, option or menu item whose name starts with "Live". */
export async function liveSourceControls(page: Page): Promise<string[]> {
  const names: string[] = [];
  for (const role of ["radio", "tab", "button", "option", "menuitem", "menuitemradio", "checkbox", "switch"] as const) {
    const loc = page.getByRole(role, { name: /^live\b/i });
    for (let i = 0; i < await loc.count(); i++) names.push(`${role}: ${(await loc.nth(i).innerText().catch(() => "")).trim() || "(unnamed)"}`);
  }
  return names;
}

/** Requests that are neither code/asset chunks, the app shell document, nor the bundled recorded fixtures: i.e. "data" traffic. */
export const dataRequests = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => { const p = new URL(r.url).pathname; return !p.startsWith("/assets/") && p !== "/" && !p.startsWith("/demo/") && p !== "/index.html"; });
