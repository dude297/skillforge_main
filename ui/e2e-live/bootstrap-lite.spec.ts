// EXPERIMENT (exp/bootstrap-lite): Bootstrap Lite against the REAL backend (`python -m experiments.bootstrap_lite`) and
// a throwaway database. Nothing on screen comes from UI fixtures. The only setup shortcut is a MOCK learn (scripted
// agent, no model) so that one approved skill exists and the "Active" state can be shown truthfully.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startServer, stopServer } from "./server";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORK = path.join(ROOT, "ui", "test-results", "bootstrap-lite-db");
const DB = path.join(WORK, "app.db");
const PORT = 8786;
const BASE = `http://127.0.0.1:${PORT}/`;
const TOKEN = "bootstrap-lite-e2e-token-0001-abcdefghijkl";
const PY = process.env.PYTHON ?? "python";
const ENV = { ...process.env, APP_DB: DB, SKILLS_DIR: path.join(WORK, "skills"), APP_RESULTS: path.join(WORK, "results"),
  APP_OPERATOR_TOKEN: TOKEN, PYTHONIOENCODING: "utf-8", LLM_BASE_URL: "mock" };
const SETUP = "from app import db, bench; c = db.connect(); db.load_scenario(c); bench.learn(c, bench.MockAgent()); "
  + "db.load_scenario(c, 'data/learning/learn_b.json'); c.commit()";

let srv: ChildProcess | null = null;
const digest = () => createHash("sha256").update(readFileSync(DB)).digest("hex");
const login = async (page: Page) => {
  await page.goto(execFileSync(PY, ["-m", "app", "ui", "--link", "--port", String(PORT)], { cwd: ROOT, env: ENV, encoding: "utf-8" }).trim());
};
const steps = (page: Page) => page.getByRole("navigation", { name: "Onboarding steps" });
const item = (page: Page, id: string) => page.locator(`[data-item="${id}"]`);
async function noSeriousA11y(page: Page) {
  const r = await new AxeBuilder({ page }).include("section[aria-labelledby=bl-h]").analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
}
async function discover(page: Page, workspace: RegExp) {
  await page.goto(`${BASE}#/world/onboard`);
  await page.reload();  // a hash-only goto keeps the previous discovery in memory
  await page.getByRole("radio", { name: workspace }).check();
  await page.getByRole("button", { name: "Run read-only discovery" }).click();
  await expect(page.getByTestId("active-now")).toBeVisible();
}

test.beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  execFileSync(PY, ["-c", SETUP], { cwd: ROOT, env: ENV });
  srv = await startServer(PY, ["-m", "experiments.bootstrap_lite", "--port", String(PORT)],
    { cwd: ROOT, env: ENV, base: BASE, log: path.join(WORK, "server.log"), readyMs: 15_000 });
});
test.afterAll(async () => { await stopServer(srv); });

test("supply-chain workspace: five steps, only the pinned check claimed active, nothing written", async ({ page }) => {
  const before = digest();
  await login(page);
  await discover(page, /ops-freight-accrual-week2/);
  // the one sentence a non-technical reviewer reads: on unified-alpha only the pinned freight check works for freight
  await expect(page.getByTestId("active-now")).toHaveText("Active now: Independent check: carrier_invoice_net on freight_accrued");
  await expect(page.getByRole("definition").filter({ hasText: /^0$/ })).toHaveCount(1);  // writes performed
  await noSeriousA11y(page);

  await steps(page).getByRole("button", { name: /Roles and capabilities/ }).click();
  await expect(item(page, "records")).toContainText("Found only");
  await expect(item(page, "inference")).toContainText("Unavailable");  // no model on this box: unknown is never active
  await expect(item(page, "check-carrier_invoice_net")).toContainText("Active");
  await expect(item(page, "check-carrier_invoice_net")).toContainText("pins.json");
  for (const ex of ["ex-chat", "ex-git", "ex-erp"]) await expect(item(page, ex)).toContainText("Example only");
  await expect(page.locator('[data-item] [data-state="active"]')).toHaveCount(1);
  await noSeriousA11y(page);

  await page.getByRole("button", { name: /Next: Workflows and permissions/ }).click();
  await expect(item(page, "wf-learn-3e9a87a79dee7434")).toContainText("Found only");
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("cell", { name: "No", exact: true })).toHaveCount(3);
  await expect(table.getByRole("cell", { name: "Yes", exact: true })).toHaveCount(0);
  await noSeriousA11y(page);

  await page.getByRole("button", { name: /Next: Your office/ }).click();
  await expect(page.getByRole("group", { name: "Your office, with nothing running yet" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Rooms" }).getByRole("listitem").filter({ has: page.getByRole("heading") })).toHaveCount(5);
  await noSeriousA11y(page);
  // the existing Daylight World follows, unchanged
  await page.getByRole("link", { name: "Continue to the office" }).click();
  await expect(page.locator("#story")).toBeInViewport();
  await expect(page.locator("#replay")).toBeAttached();
  expect(digest()).toBe(before);
});

test("an exact-match approved skill is Active; the same skill is only Approved where it doesn't fit", async ({ page }) => {
  await login(page);
  await discover(page, /learn-b-derived-totals/);
  await expect(page.getByTestId("active-now")).toContainText("Skill line-total-reconcile v1");
  await steps(page).getByRole("button", { name: /Roles and capabilities/ }).click();
  await expect(item(page, "records")).toContainText("Set up, not working");  // loaded in the app DB, nothing running
  await expect(item(page, "skill-line-total-reconcile")).toContainText("Active");
  await discover(page, /lookalike/);
  await steps(page).getByRole("button", { name: /Roles and capabilities/ }).click();
  await expect(item(page, "skill-line-total-reconcile")).toContainText("Approved, not in use here");
});

test("keyboard only: choose, discover, walk every step", async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}#/world/onboard`);
  await page.getByRole("radio", { name: /ops-freight-accrual-week2/ }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Run read-only discovery" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: /Step 2 of 5/ })).toBeFocused();
  for (const n of [3, 4, 5]) {
    await page.getByRole("button", { name: /^Next:/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`Step ${n} of 5`) })).toBeFocused();
  }
  await expect(steps(page).getByRole("button", { name: /Your office/ })).toHaveAttribute("aria-current", "step");
});

test("phone width and reduced motion: whole flow, no horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await login(page);
  await discover(page, /ops-freight-accrual-week2/);
  for (let i = 0; i < 3; i++) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: /^Next:/ }).click();
  }
  await expect(page.getByRole("group", { name: "Your office, with nothing running yet" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ctx.close();
});

test("without a session the page says so and shows no data", async ({ page }) => {
  await page.goto(`${BASE}#/world/onboard`);
  await expect(page.getByRole("alert")).toContainText("Not signed in");
  await expect(page.locator("section[aria-labelledby=bl-h]").getByRole("radio")).toHaveCount(0);
  await expect(page.getByTestId("active-now")).toHaveCount(0);
});
