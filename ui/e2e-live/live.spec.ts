// Genuine application integration test: a scripted MOCK agent drives the real backend through the agent tool
// service, a person's decisions are real host CLI commands, and the console shows only what the read-only operator
// API returns. Nothing on screen comes from UI fixtures. (It does not test model autonomy: there is no model.)
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startServer, stopServer } from "./server";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORK = path.join(ROOT, "ui", "test-results", "live-db");
const DB = path.join(WORK, "app.db");
const PORT = 8776, AGENT_PORT = 8775;
const BASE = `http://127.0.0.1:${PORT}/`;
const TOKEN = "live-e2e-operator-token-0001-abcdefghijkl";
const PY = process.env.PYTHON ?? "python";
const ENV = { ...process.env, APP_DB: DB, SKILLS_DIR: path.join(WORK, "skills"), APP_RESULTS: path.join(WORK, "results"),
  APP_OPERATOR_TOKEN: TOKEN, PYTHONIOENCODING: "utf-8" };

let ui: ChildProcess | null = null;
let rehearsal: ChildProcess | null = null;
let rehearsalExit: Promise<number | null> = Promise.resolve(null);

const cli = (...args: string[]) => execFileSync(PY, ["-m", "app", ...args], { cwd: ROOT, env: ENV, encoding: "utf-8" });
// a fresh ONE-TIME login link, minted the way an operator does (`python -m app ui --link`)
const login = async (page: Page) => { await page.goto(cli("ui", "--link", "--port", String(PORT)).trim()); };
/** run the exact host command the console shows, with the operator's name filled in */
const runShown = async (page: Page, re: RegExp) => {
  const cmd = (await page.locator("code", { hasText: re }).first().innerText()).trim().replace("<your name>", "e2e-tester");
  const args = cmd.replace(/^python3 -m app /, "").split(/\s+/);
  return cli(...args);
};

async function startUi() {
  ui = await startServer(PY, ["-m", "app", "ui", "--port", String(PORT)],
    { cwd: ROOT, env: ENV, base: BASE, log: path.join(WORK, `ui-${Date.now()}.log`), readyMs: 10_000 });
}
// kill the whole tree: rehearse.py owns a `serve` child that must not outlive it (it would hold the port)
const kill = (p: ChildProcess | null) => {
  if (!p?.pid || p.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  else p.kill();
};
/** stop the console AND wait until the process is gone: taskkill is asynchronous, and an old API still answering
 *  /ui/health would let a test talk to the pre-restore process */
async function stopUi() {
  const p = ui;
  ui = null;
  await stopServer(p);
}
const tasksInDb = () => (JSON.parse(cli("task", "list")).tasks as unknown[]).length;

const steps = (page: Page) => page.getByRole("list", { name: "Agent steps" }).locator(":scope > li");
const stepTitles = async (page: Page) => (await steps(page).locator("p.font-medium").allInnerTexts()).map((t) => t.trim());

test.describe.serial("live console over the real backend", () => {
  test.beforeAll(async () => {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
    await startUi(); // before the DB exists: the console must say so, then recover by itself
  });
  test.afterAll(async () => { await stopUi(); kill(rehearsal); });

  test("a mock-agent run appears step by step, waits for a person, and survives a reload", async ({ page }) => {
    const nonGet: string[] = [], foreign: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") nonGet.push(`${r.method()} ${r.url()}`);
      if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) foreign.push(r.url());
    });
    await login(page);
    await expect(page.getByRole("radio", { name: /^Live/ })).toBeChecked(); // served by the API: starts in Live
    await expect(page.getByText(/no database yet/)).toBeVisible({ timeout: 15_000 }); // nothing invented meanwhile

    rehearsal = spawn(PY, ["scripts/rehearse.py", "--db", DB, "--port", String(AGENT_PORT), "--approve", "manual", "--pace", "0.3"],
      { cwd: ROOT, env: ENV, stdio: "ignore" });
    rehearsalExit = new Promise((res) => rehearsal!.on("exit", (code) => res(code)));

    await page.goto(`${BASE}#/console/investigations`);
    await expect(page.getByRole("heading", { level: 1, name: "Totals check, batch A" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Mock agent (scripted, no model)")).toBeVisible();
    const status = page.locator("#run-h + p");
    await expect(status).toHaveText("Waiting for you", { timeout: 30_000 });
    // the agent's turn ends with its (refused) attempt to act early; then both approvals are pending
    await expect(steps(page).filter({ hasText: "Execution refused" })).toHaveCount(1, { timeout: 30_000 });
    await expect(steps(page).last()).toHaveText(/Waiting for your approval of #1, #2/, { timeout: 15_000 });
    await expect(page.getByText(/^python3 -m app approve 1 2 --by <your name> --expect [0-9a-f]{8},[0-9a-f]{8}$/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^approve/i })).toHaveCount(0); // the browser has no write path

    // event order = audit order
    const titles = await stepTitles(page);
    const at = (t: string) => titles.findIndex((x) => x.startsWith(t));
    expect(at("Task opened")).toBe(0);
    expect(at("Investigate A-101")).toBeLessThan(at("Propose a change to A-102"));
    expect(at("Propose a change to A-102")).toBeLessThan(at("Ask for approval"));
    expect(at("Execution refused")).toBeGreaterThan(at("Ask for approval")); // acting before approval was refused
    expect(titles.at(-1)).toMatch(/^Waiting for your approval of #1, #2/);

    await page.reload(); // all state lives in the backend
    await expect(status).toHaveText("Waiting for you", { timeout: 15_000 });
    expect(await stepTitles(page)).toEqual(titles);

    await runShown(page, /^python3 -m app approve 1 2 /); // the copied command, fingerprints and all
    await expect(page.getByText("Approved by e2e-tester").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^Waiting for a person to promote line-total-reconcile v1/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("python3 -m app skill approve line-total-reconcile 1 --by <your name>").first()).toBeVisible();
    await expect(steps(page).filter({ hasText: "Apply the approved change" })).toHaveCount(2); // retried executes don't duplicate
    await expect(steps(page).filter({ hasText: "Independent verification" }).filter({ hasText: "passed" })).toHaveCount(2);

    cli("skill", "approve", "line-total-reconcile", "1", "--by", "e2e-tester");
    await expect(page.getByRole("heading", { level: 1, name: "Totals check, batch B" })).toBeVisible({ timeout: 30_000 });
    await expect(status).toHaveText("Waiting for you", { timeout: 30_000 });
    await expect(page.getByText(/^Skill ran: line-total-reconcile/)).toBeVisible();
    await expect(page.getByText(/^python3 -m app approve 1 2 3 --by <your name> --expect /)).toBeVisible();
    // a command for act 1's action #1 would now name a different change: the CLI must refuse it
    expect(() => cli("approve", "1", "--by", "e2e-tester", "--expect", "00000000")).toThrow();
    await runShown(page, /^python3 -m app approve 1 2 3 /);
    await expect(status).toHaveText("Verified, handled by a skill", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Same task, before and after" })).toBeVisible();
    await expect(page.getByText("not measured").first()).toBeVisible(); // mock: model calls are unknown, never 0
    expect(await rehearsalExit).toBe(0);

    // the other sections read the same backend
    await page.goto(`${BASE}#/console/skills`);
    await expect(page.getByRole("region", { name: /line-total-reconcile v1 source/ })).toContainText("def run(dataset)");
    await page.goto(`${BASE}#/console/history`);
    await page.getByRole("button", { name: /Totals check, batch A\s*: replay/ }).click();
    await expect(page.getByRole("heading", { name: "Replay: Totals check, batch A" })).toBeVisible();
    expect(nonGet).toEqual([]);
    expect(foreign).toEqual([]); // offline: nothing outside this origin
  });

  test("losing the operator API is shown, keeps the real data marked stale, and recovers", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}#/console/investigations`);
    await expect(page.getByRole("heading", { level: 1, name: "Totals check, batch B" })).toBeVisible({ timeout: 15_000 });
    await stopUi();
    await expect(page.getByText(/Lost the connection to the operator API/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Live (not connected)")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Totals check, batch B" })).toBeVisible(); // stale, labelled
    await startUi();
    await expect(page.getByText(/Lost the connection/)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Live (not connected)")).toHaveCount(0);
  });

  test("a failed verification is shown as needing review, with the failing check", async ({ page }) => {
    execFileSync(PY, ["scripts/rehearse.py", "--db", DB, "--port", String(AGENT_PORT), "--approve", "auto", "--pace", "0",
      "--keep", "--fail-verify", "--restart-service"], { cwd: ROOT, env: ENV, stdio: "ignore" }); // exits 0 only if outcomes match
    await login(page);
    await page.goto(`${BASE}#/console/investigations`);
    await expect(page.locator("#run-h + p")).toHaveText("Needs review", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Needs review" })).toBeVisible();
    const checks = page.getByRole("list", { name: /Verification checks for action 1/ });
    await expect(checks).toContainText("field has target value");
    await expect(checks.getByText(": failed").first()).toBeAttached();
    await page.goto(`${BASE}#/console/overview`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("phone width: no horizontal scroll, no serious accessibility violations", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    for (const sec of ["overview", "investigations", "skills", "history", "system"]) {
      await page.goto(`${BASE}#/console/${sec}`);
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), sec).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${sec}: ${v.id}`)).toEqual([]);
    }
  });

  test("a login link works once; the session survives an API restart", async ({ page, browser }) => {
    const link = cli("ui", "--link", "--port", String(PORT)).trim();
    await page.goto(link);
    await expect(page.getByRole("radio", { name: /^Live/ })).toBeChecked();
    const other = await browser.newContext();
    const p2 = await other.newPage();
    const r = await p2.goto(link); // the same link again, e.g. from browser history
    expect(r?.status()).toBe(401);
    await expect(p2.getByText(/already used/)).toBeVisible();
    await other.close();
    await stopUi();
    await startUi();
    await page.goto(`${BASE}#/console/overview`);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/Sign in/, { timeout: 15_000 });
    await expect(page.getByText("Live (not connected)")).toHaveCount(0, { timeout: 15_000 });
  });

  test("restoring an older database while the console is open resyncs instead of mixing histories", async ({ page }) => {
    const backup = path.join(WORK, "before.db");
    const inBackup = tasksInDb();  // expectations come from the authoritative DB, not from whatever has rendered yet
    cli("db", "backup", backup);
    execFileSync(PY, ["scripts/rehearse.py", "--db", DB, "--port", String(AGENT_PORT), "--approve", "auto", "--pace", "0", "--keep"],
      { cwd: ROOT, env: ENV, stdio: "ignore" });
    const before = tasksInDb();
    expect(before).toBe(inBackup + 2);
    await login(page);
    await page.goto(`${BASE}#/console/history`);
    const rows = page.getByRole("region", { name: "Past runs table" }).locator("tbody tr");
    await expect(rows).toHaveCount(before, { timeout: 20_000 }); // the console shows the newer history first
    await stopUi(); // runbook R15: stop readers, restore, start again
    cli("db", "restore", backup, "--services-stopped"); // no serve in this suite; the console was stopped above
    await startUi();
    await expect(rows).toHaveCount(inBackup, { timeout: 20_000 }); // the two newer tasks are gone, not kept stale
    await page.goto(`${BASE}#/console/investigations`);
    await expect(page.locator("#run-h + p")).toHaveText("Needs review", { timeout: 15_000 }); // newest task in the backup
  });

  test("a console link with ?task= opens that task, not the newest", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}?source=live&task=1#/console/investigations`);
    await expect(page.getByRole("heading", { level: 1, name: "Totals check, batch A" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("radio", { name: /^Live/ })).toBeChecked();
  });
});
