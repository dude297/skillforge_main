// EXPERIMENT (exp/world): the RENDERED scene (not just the fold) never shows complete success while any relevant
// action is pending, rejected, applied-but-unverified or failed. Live mode is fed crafted, sanitized API payloads by
// request interception: the same shapes the read-only operator API returns.
import { test, expect, type Page } from "@playwright/test";

type Ev = { id: number; ts: string; actor: string; event: string; payload: Record<string, unknown> };
const mk = (rows: [string, Record<string, unknown>, string?][]): Ev[] =>
  rows.map(([event, payload, actor], i) => ({ id: i + 1, ts: `2026-10-25 10:00:${String(i).padStart(2, "0")}`, actor: actor ?? "agent", event, payload }));

async function liveWorld(page: Page, events: Ev[], pending: { id: number; task_id: number }[] = []) {
  await page.route("**/ui/**", (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/ui\//, "");
    const body: Record<string, unknown> = {
      health: { ok: true, service: "skillforge-operator-api", read_only: true },
      tasks: { ok: true, tasks: [] }, skills: { ok: true, skills: [] },
      approvals: { ok: true, pending: pending.map((a) => ({ ...a, fingerprint: "deadbeef", record_id: "A", field: "total", value: 1, state: "WAITING_APPROVAL", evidence: [], verifications: [] })) },
      events: { ok: true, events, last_id: events.length, anchor: null },
      status: { ok: true, inference: { ok: null, detail: "unknown" }, sandbox: { ok: null, detail: "unknown" }, host_service: { ok: null, detail: "unknown" }, db: { quick_check: "ok" }, next_actions: [] },
    };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body[p] ?? { ok: false }) });
  });
  await page.goto("#/world");
  await page.locator("#replay").evaluate((el) => el.scrollIntoView());
  await page.locator("#replay label", { hasText: "Live" }).click();
  const scene = page.locator("#replay [role=group][data-mascot]");
  await expect(page.locator("#replay").getByText(`${events.length} of ${events.length}`)).toBeVisible({ timeout: 10_000 });
  return scene;
}

const begin = ["task_begin", { task_id: 1, label: "t", mode: "real" }, "operator"] as [string, Record<string, unknown>, string];
const two = (extra: [string, Record<string, unknown>, string?][]) => mk([begin,
  ["propose_action", { action_id: 1, record_id: "A", params: { field: "total", value: 1 } }], ["request_approval", { action_id: 1 }],
  ["propose_action", { action_id: 2, record_id: "B", params: { field: "total", value: 2 } }], ["request_approval", { action_id: 2 }], ...extra]);

test.describe("rendered world never implies complete success without authority", () => {
  test("one of two changes verified -> still checking", async ({ page }) => {
    const scene = await liveWorld(page, two([["approval_approved", { action_id: 1 }, "human:dana"], ["approval_approved", { action_id: 2 }, "human:dana"],
      ["execute_action", { action_id: 1 }], ["execute_action", { action_id: 2 }], ["verify_action", { action_id: 1, passed: true }]]));
    await expect(scene).toHaveAttribute("data-mascot", "verifying");
    await expect(scene).toHaveAttribute("data-gate", "pending");
    await expect(page.locator("#replay").getByText("Ember: verification pending")).toBeVisible();
  });

  test("a change still pending approval -> a person is needed, not done", async ({ page }) => {
    const scene = await liveWorld(page, two([["approval_approved", { action_id: 1 }, "human:dana"], ["execute_action", { action_id: 1 }],
      ["verify_action", { action_id: 1, passed: true }]]), [{ id: 2, task_id: 1 }]);
    await expect(scene).toHaveAttribute("data-mascot", "waiting");
    await expect(scene).toHaveAttribute("data-waiting", "true");
  });

  test("rejected changes and an unsuccessful close -> never verified", async ({ page }) => {
    const scene = await liveWorld(page, two([["approval_rejected", { action_id: 1 }, "human:dana"], ["approval_rejected", { action_id: 2 }, "human:dana"],
      ["task_end", { task_id: 1, success: 0, tool_calls: 6, model_calls: 4 }, "operator"]]));
    await expect(scene).toHaveAttribute("data-mascot", "idle");
    await expect(scene).toHaveAttribute("data-gate", "idle");
  });

  test("a failed verification -> error and a red gate, even after another change passed", async ({ page }) => {
    const scene = await liveWorld(page, two([["approval_approved", { action_id: 1 }, "human:dana"], ["approval_approved", { action_id: 2 }, "human:dana"],
      ["execute_action", { action_id: 1 }], ["execute_action", { action_id: 2 }], ["verify_action", { action_id: 2, passed: false }], ["verify_action", { action_id: 1, passed: true }]]));
    await expect(scene).toHaveAttribute("data-gate", "fail");
    await expect(scene).not.toHaveAttribute("data-mascot", "verified");
  });

  test("only when every applied change passed does it show verified", async ({ page }) => {
    const scene = await liveWorld(page, two([["approval_approved", { action_id: 1 }, "human:dana"], ["approval_approved", { action_id: 2 }, "human:dana"],
      ["execute_action", { action_id: 1 }], ["execute_action", { action_id: 2 }], ["verify_action", { action_id: 1, passed: true }], ["verify_action", { action_id: 2, passed: true }]]));
    await expect(scene).toHaveAttribute("data-mascot", "verified");
    await expect(scene).toHaveAttribute("data-gate", "pass");
  });
});

test("the usability script only references UI that exists", async ({ page }) => {
  // USABILITY_TEST.md tells participants/moderators to use these exact things; if the UI drifts, this fails
  await page.goto("#/world");
  for (const text of ["Follow one problem", "Watch a real run", "Recorded run"]) await expect(page.getByText(text).first()).toBeAttached();
  await expect(page.getByLabel("How to read the office").first()).toBeAttached();
  const replay = page.locator("#replay");
  await replay.getByRole("button", { name: "Restart" }).click();
  for (let i = 0; i < 4; i++) await replay.getByRole("button", { name: "Next event" }).click();
  await expect(replay.getByRole("link", { name: /^Replay task \d+ in the console$/ })).toBeVisible();
  await expect(replay.getByText(/scripted MOCK \(no model\)/)).toBeVisible(); // the provenance cue Task 4 scores
  await expect(page.getByRole("button", { name: /Human review desk/ }).first()).toBeAttached();
});
