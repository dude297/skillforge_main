// Guided demo (#/demo) over an OnCall run. The run file is the e2e placeholder fixture (served in place of
// demo/oncall-run.recorded.json), so these tests never depend on what another process last recorded.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromOnCall, fromOnCallAudit, sceneState } from "../src/world/events";
import { fmt, runMode, type OnCallRun } from "../src/data/oncall";

const FIXTURE: OnCallRun = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/oncall-run.placeholder.json", import.meta.url)), "utf8"));

async function serve(page: Page, run: OnCallRun) {
  await page.route("**/ui/demo/oncall", (r) => r.fulfill({ status: 404, body: "{}" })); // no live endpoint
  await page.route("**/demo/oncall-run.recorded.json", (r) => r.fulfill({ json: run }));
}
const banner = (page: Page) => page.getByTestId("mode-banner");
const scene = (page: Page, n: number) => expect(page.getByText(`Scene ${n} of 6`, { exact: true })).toBeVisible();

test.describe("guided demo", () => {
  test("pure mapping: null is never 0, reuse skips the AI room, approval is not invented", () => {
    expect(fmt(null)).toBe("not measured");
    expect(fmt(0)).toBe("0");
    expect(runMode(FIXTURE)).toBe("RECORDED SCRIPTED SIMULATION");
    expect(runMode(FIXTURE, "reuse")).toBe("DETERMINISTIC SKILL");
    expect(runMode(null)).toBe("UNAVAILABLE");
    expect(runMode({ ...FIXTURE, mode: "LIVE_REAL_MODEL" })).toBe("RECORDED SCRIPTED SIMULATION"); // live mode, reference code: not a model
    expect(runMode({ ...FIXTURE, mode: "LIVE_REAL_MODEL", synthesis: { ...FIXTURE.synthesis!, provenance: "model" } })).toBe("LIVE REAL MODEL");
    const g = fromOnCall(FIXTURE);
    expect(g.reuse.map((e) => e.dept)).not.toContain("server");
    expect(g.synthesis.some((e) => e.effects?.includes("approval_done"))).toBe(false); // pending: nobody approved
    expect(sceneState([...g.incident, ...g.synthesis]).waiting).toBe(true);
    expect(fromOnCallAudit({ t: null, event: "verified", detail: null }, 0).dept).toBe("gate");
    expect(fromOnCallAudit({ t: null, event: "reuse_inc3", detail: "refused: x" }, 1).mascot).toBe("error");
  });

  test("six scenes by keyboard, mode banner per scene, evidence with source paths", async ({ page }) => {
    await serve(page, FIXTURE);
    await page.goto("#/demo");
    await scene(page, 1);
    await expect(banner(page)).toHaveAttribute("data-mode", "RECORDED SCRIPTED SIMULATION");
    await page.keyboard.press("ArrowRight");
    await scene(page, 2);
    await page.keyboard.press("ArrowRight");
    await scene(page, 3);
    await expect(page.getByText("fixtures/oncall/logs/checkout-api.log")).toBeVisible();
    await expect(page.locator("[data-mascot]")).toHaveAttribute("data-mascot", "investigating");
    await page.keyboard.press("ArrowRight");
    await scene(page, 4);
    await expect(page.getByTestId("code-author")).toContainText("not model output");
    await expect(page.getByText("python -m app approve 1 --by <name>", { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await scene(page, 5);
    await expect(banner(page)).toHaveAttribute("data-mode", "DETERMINISTIC SKILL");
    await expect(page.getByTestId("ember-state")).toContainText("skill library");
    await expect(page.getByRole("table", { name: /side by side/ })).toContainText("not measured"); // first run: null, not 0
    await expect(page.getByTestId("refusal-reason")).toContainText("does not match");
    await page.keyboard.press("ArrowRight");
    await scene(page, 6);
    await expect(banner(page)).toHaveAttribute("data-mode", "RECORDED SCRIPTED SIMULATION");
    const insp = page.getByTestId("run-inspector");
    await insp.getByRole("button", { name: /Approval/ }).click();
    await expect(insp).toContainText("pending");
    await insp.getByRole("button", { name: /Telemetry/ }).click();
    await expect(insp).toContainText("not available");
    await page.locator("#scene-h").click(); // keys belong to a focused control; step from the page itself
    await page.keyboard.press("ArrowLeft");
    await scene(page, 5);
  });

  test("a scene you step to takes focus; the arrows still work after using the control bar", async ({ page }) => {
    await serve(page, FIXTURE);
    await page.goto("#/demo");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await scene(page, 2);
    await expect(page.locator("#scene-h")).toBeFocused();
    await page.getByRole("button", { name: "Next", exact: true }).focus(); // focus sits in the bar after a mouse click
    await page.keyboard.press("ArrowRight");
    await scene(page, 3);
    await page.getByRole("button", { name: /^Scene 5/ }).focus();
    await page.keyboard.press("ArrowLeft");
    await scene(page, 2);
    await expect(page.getByRole("list", { name: "Scenes" }).getByRole("button", { name: /^Scene 2/ })).toHaveAttribute("aria-current", "step");
  });

  test("simulated approval: wording never calls it a person's decision", async ({ page }) => {
    await serve(page, { ...FIXTURE, approval: { ...FIXTURE.approval!, state: "approved", by: "recorded-sim", kind: "simulated" as const, at: "2026-10-25 09:00:04" } });
    await page.goto("#/demo");
    await page.getByRole("button", { name: /^Scene 4/ }).click();
    await expect(page.getByTestId("approval-state")).toHaveText("Simulated approval, not a person's decision");
    await page.getByRole("button", { name: /^Scene 5/ }).click();
    await expect(page.getByTestId("reuse-simulated")).toContainText("simulated approval");
  });

  test("autoplay stops at the approval desk when the skill is not approved", async ({ page }) => {
    test.setTimeout(90_000);
    await serve(page, FIXTURE);
    await page.goto("#/demo");
    await page.getByRole("button", { name: /^Scene 3/ }).click();
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.getByTestId("autoplay-stopped")).toBeVisible({ timeout: 40_000 });
    await scene(page, 4);
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible(); // paused, not advanced
    await expect(page.getByTestId("approval-state")).toHaveText("Waiting for a person");
  });

  test("approved run: autoplay continues to reuse; scripted approval is labelled as not a person", async ({ page }) => {
    test.setTimeout(90_000);
    await serve(page, { ...FIXTURE, approval: { ...FIXTURE.approval!, state: "approved", by: "recorded-sim (agent, not a human)", at: "2026-10-25 09:00:04" } });
    await page.goto("#/demo");
    await page.getByRole("button", { name: /^Scene 4/ }).click();
    await expect(page.getByTestId("not-human")).toBeVisible();
    await page.getByRole("button", { name: "Play" }).click();
    await scene(page, 5);
  });

  test("no run file: UNAVAILABLE, nothing filled in", async ({ page }) => {
    await page.route("**/ui/demo/oncall", (r) => r.fulfill({ status: 404, body: "" }));
    await page.route("**/demo/oncall-run.recorded.json", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("#/demo");
    await expect(banner(page)).toHaveAttribute("data-mode", "UNAVAILABLE");
    await page.getByRole("button", { name: /^Scene 3/ }).click();
    await expect(page.getByText("No OnCall run to show")).toBeVisible();
  });

  test("reduced motion: no running animations on the demo stage", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: `http://127.0.0.1:${process.env.PORT ?? 4173}/` });
    const page = await ctx.newPage();
    await serve(page, FIXTURE);
    await page.goto("#/demo");
    await page.getByRole("button", { name: /^Scene 3/ }).click();
    await expect(page.locator("[data-mascot]")).toHaveAttribute("data-mascot", "investigating");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
    await ctx.close();
  });

  test("console incident view uses the same proof", async ({ page }) => {
    await serve(page, FIXTURE);
    await page.goto("#/console/investigations/incident");
    await expect(page.getByTestId("run-inspector")).toContainText("INC-FIXTURE-1");
    await expect(banner(page)).toHaveAttribute("data-mode", "RECORDED SCRIPTED SIMULATION");
  });

  test("approval: only kind=host_cli counts as a person; a simulated approval is never shown as waiting", async ({ page }) => {
    const sim = { ...FIXTURE, approval: { ...FIXTURE.approval!, state: "approved", by: "x", kind: "simulated" as const } };
    await serve(page, sim);
    await page.goto("#/console/investigations/incident");
    const nav = page.getByRole("navigation", { name: "Run records" });
    await expect(nav).toContainText("approved by an agent or test, not a person");
    await expect(nav).not.toContainText("waiting for a person");
    await page.unrouteAll();
    await serve(page, { ...sim, approval: { ...sim.approval, by: "Dana", kind: "host_cli" as const } });
    await page.reload();
    await nav.getByRole("button", { name: /^Approval/ }).click();
    await expect(page.getByTestId("run-inspector")).toContainText("yes: typed on the host");
  });

  test("phone width: no horizontal scroll on scenes 4 and 6 and the incident view; office rooms open a detail", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: `http://127.0.0.1:${process.env.PORT ?? 4173}/` });
    const page = await ctx.newPage();
    await serve(page, FIXTURE);
    const noScroll = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.goto("#/demo");
    await page.getByRole("button", { name: /^Scene 4/ }).click();
    await noScroll();
    await page.getByRole("button", { name: /^Scene 6/ }).click();
    await noScroll();
    await page.goto("#/console/investigations/incident");
    await expect(page.getByTestId("run-inspector")).toBeVisible();
    await noScroll();
    await page.goto("#/world");
    await page.getByRole("button", { name: /Human review desk\. Show what happens here/ }).last().click();
    await expect(page.getByRole("dialog")).toBeInViewport();
    await ctx.close();
  });
});
