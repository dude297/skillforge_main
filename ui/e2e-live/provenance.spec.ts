// Provenance labels over the REAL backend: who did the work is never overstated. The DB is the enterprise slice run by
// the real router (deterministic skill tasks, deferred and handed-to-a-person decisions) on a MOCK library (scripted
// agent tasks). One `real` task row is a TEST FIXTURE inserted only to prove that "Local model" shows for that mode and
// for nothing else; no model ran anywhere.
import { test, expect } from "@playwright/test";
import { execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, stopServer } from "./server";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORK = path.join(ROOT, "ui", "test-results", "provenance-db");
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}/`;
const PY = process.env.PYTHON ?? "python";
const ENV = { ...process.env, APP_DB: path.join(WORK, "app.db"), SKILLS_DIR: path.join(WORK, "skills"),
  APP_OPERATOR_TOKEN: "provenance-e2e-token-0001-abcdefghijkl", PYTHONIOENCODING: "utf-8", LLM_BASE_URL: "mock" };
const SETUP = [
  "import json",
  "from app import db, skillforge as sf",
  "from experiments.catalog import library, slice as story",
  "c = db.connect(); library.build(c); story.run(c)",
  "sf.task_begin(c, 'TEST FIXTURE real-mode row (no model ran)', 'real'); sf.task_end(c); c.commit()",
  "t = {r['label']: r['id'] for r in c.execute('SELECT id, label FROM tasks')}",
  "print(json.dumps({'det': next(i for l, i in t.items() if l.startswith('Routed freight_week2 ')),",
  "  'mock': t['learn freight (MOCK solve)'], 'real': t['TEST FIXTURE real-mode row (no model ran)']}))",
].join("\n");

let srv: ChildProcess | null = null;
let ids: { det: number; mock: number; real: number };
const chip = (page: import("@playwright/test").Page) => page.getByTestId("task-provenance");

test.beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  ids = JSON.parse(execFileSync(PY, ["-c", SETUP], { cwd: ROOT, env: ENV, encoding: "utf-8" }).trim().split("\n").at(-1)!);
  srv = await startServer(PY, ["-m", "app", "ui", "--port", String(PORT)],
    { cwd: ROOT, env: ENV, base: BASE, log: path.join(WORK, "server.log"), readyMs: 15_000 });
});
test.afterAll(async () => { await stopServer(srv); });

test("console: deterministic, mock and model runs each say who did the work", async ({ page }) => {
  await page.goto(execFileSync(PY, ["-m", "app", "ui", "--link", "--port", String(PORT)], { cwd: ROOT, env: ENV, encoding: "utf-8" }).trim());
  for (const [id, label] of [[ids.det, "Deterministic skill (no model, no agent)"], [ids.mock, "Mock agent (scripted, no model)"],
    [ids.real, "Local model"]] as const) {
    await page.goto(`${BASE}?source=live&task=${id}#/console/investigations`);
    await expect(chip(page)).toHaveText(label, { timeout: 15_000 });
  }
  await page.goto(`${BASE}?source=live&task=${ids.det}#/console/investigations`);
  await expect(page.getByText("Task opened by the router").first()).toBeVisible({ timeout: 15_000 });
  const list = page.getByRole("button", { name: /Routed freight_week2/ });
  await expect(list).toContainText("deterministic skill");
  await expect(list).not.toContainText(/mock agent|local model/);
  // exactly one run in the whole list may say "local model": the labelled fixture row
  await expect(page.locator("button", { hasText: /^.*Task \d+, local model/ })).toHaveCount(1);

  await page.goto(`${BASE}?source=live#/console/history`);
  const row = page.getByRole("row", { name: /Routed freight_week2/ });
  await expect(row).toContainText("deterministic, no model", { timeout: 15_000 });
  await expect(row).not.toContainText("mock agent");
});

test("World: routed decisions that ran nothing say who handles them now", async ({ page }) => {
  await page.goto(execFileSync(PY, ["-m", "app", "ui", "--link", "--port", String(PORT)], { cwd: ROOT, env: ENV, encoding: "utf-8" }).trim());
  await page.goto(`${BASE}#/world`);
  await page.getByRole("radio", { name: /^Live/ }).check({ force: true });
  const panel = page.locator("body");
  await expect(panel.getByText("Deferred: no local model available").first()).toBeAttached({ timeout: 20_000 });
  await expect(panel.getByText("Handed to a person").first()).toBeAttached();
  await expect(panel.getByText(/route needs human|route deferred/)).toHaveCount(0);  // no raw event names left
});
