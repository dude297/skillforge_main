import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, stopServer } from "./server";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORK = path.join(ROOT, "ui", "test-results", "bl-shots-db");
const ENV = { ...process.env, APP_DB: path.join(WORK, "app.db"), SKILLS_DIR: path.join(WORK, "skills"), APP_OPERATOR_TOKEN: "shots-token-0001-abcdefghijklmnopqrstuv", LLM_BASE_URL: "mock" };
test("shots", async ({ browser }) => {
  rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
  execFileSync("python", ["-m", "app", "reset"], { cwd: ROOT, env: ENV });
  const s = await startServer("python", ["-m", "experiments.bootstrap_lite", "--port", "8787"],
    { cwd: ROOT, env: ENV, base: "http://127.0.0.1:8787/", log: path.join(WORK, "server.log"), readyMs: 15_000 });
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(execFileSync("python", ["-m", "app", "ui", "--link", "--port", "8787"], { cwd: ROOT, env: ENV, encoding: "utf-8" }).trim());
      await page.goto("http://127.0.0.1:8787/#/world/onboard"); await page.reload();
      await page.getByRole("button", { name: "Run read-only discovery" }).waitFor();
      await page.screenshot({ path: `screenshots/bootstrap-lite/${w}-1.png`, fullPage: true });
      await page.getByRole("button", { name: "Run read-only discovery" }).click();
      await page.getByTestId("active-now").waitFor();
      for (const n of [2, 3, 4, 5]) {
        await page.locator("section[aria-labelledby=bl-h]").screenshot({ path: `screenshots/bootstrap-lite/${w}-${n}.png` });
        if (n < 5) await page.getByRole("button", { name: /^Next:/ }).click();
      }
    }
  } finally {
    await stopServer(s);  // before: a fixed 2.5 s sleep instead of readiness, and s.kill() unawaited and skipped on failure
  }
});
