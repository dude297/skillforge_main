// EXPERIMENT (exp/world): the scene fold under duplicate, missing, delayed, reordered, restarted and failed
// workflows. Rule under test: nothing looks verified unless the authoritative verify event for it passed.
// Pure logic (no browser): imports the same module the scene renders from.
import { test, expect } from "@playwright/test";
import { BEATS, STORY, consoleLink, fromAudit, normalize, sceneState } from "../src/world/events";
import { readFileSync } from "node:fs";
const recorded = JSON.parse(readFileSync(new URL("../src/world/recorded-run.json", import.meta.url), "utf-8")) as { events: unknown[] };
import type { LiveEvent, LiveTask } from "../src/data/live";
import { historyRuns } from "../src/data/liveMap";

let n = 0;
const ev = (event: string, payload: Record<string, unknown> = {}, actor = "agent"): LiveEvent => ({ id: ++n, ts: `2026-10-21 10:00:${String(n % 60).padStart(2, "0")}`, actor, event, payload });
const fold = (es: LiveEvent[], pending = 0) => sceneState(es.map(fromAudit), pending);

/** one task, two actions, everything passing, in authoritative order */
function happy() {
  n = 0;
  return [
    ev("reset", { scenario: "x" }), ev("task_begin", { task_id: 1, label: "t", mode: "mock" }),
    ev("propose_action", { action_id: 1, record_id: "A", params: { field: "total", value: 1 } }), ev("request_approval", { action_id: 1 }),
    ev("propose_action", { action_id: 2, record_id: "B", params: { field: "total", value: 2 } }), ev("request_approval", { action_id: 2 }),
    ev("approval_approved", { action_id: 1 }, "human:dana"), ev("approval_approved", { action_id: 2 }, "human:dana"),
    ev("execute_action", { action_id: 1 }), ev("execute_action", { action_id: 2 }),
    ev("verify_action", { action_id: 1, passed: true }), ev("verify_action", { action_id: 2, passed: true }),
    ev("task_end", { task_id: 1, success: 1, tool_calls: 9, model_calls: null }, "operator"),
  ];
}

test.describe("scene fold: authoritative state only", () => {
  test("happy path ends verified, with nothing pending", () => {
    const st = fold(happy());
    expect(st.gate).toBe("pass");
    expect(st.mascot).toBe("verified");
    expect([st.unverified, st.failed, st.tickets, st.waiting]).toEqual([0, 0, 0, false]);
  });

  test("one of two changes verified is NOT success: gate stays checking, Ember stays pending", () => {
    const es = happy().slice(0, 11); // verify #1 passed, #2 applied but not verified yet (delayed or missing)
    const st = fold(es);
    expect(st.current?.title).toBe("Verified");
    expect(st.gate).toBe("pending");
    expect(st.mascot).toBe("verifying");
    expect(st.unverified).toBe(1);
  });

  test("a missing verify event never turns into success, even when the task closes", () => {
    const es = happy().filter((e) => !(e.event === "verify_action" && e.payload.action_id === 2));
    const st = fold(es);
    expect(st.gate).toBe("pending");
    expect(st.mascot).not.toBe("verified"); // the last event is task_end success=1, but the fold saw no verify for #2
    expect(st.unverified).toBe(1);
  });

  test("approving one of two pending changes still needs a person", () => {
    const st = fold(happy().slice(0, 7));
    expect(st.waiting).toBe(true);
    expect(fold(happy().slice(0, 8)).waiting).toBe(false);
  });

  test("duplicate deliveries change nothing", () => {
    const es = happy();
    const dup = [...es, ...es.slice(2, 12), es[10], es[10]];
    expect(fold(dup)).toEqual(fold(es));
    expect(normalize(dup.map(fromAudit))).toHaveLength(es.length);
  });

  test("reordered delivery is put back in audit order", () => {
    const es = happy();
    const shuffled = [es[11], es[3], es[0], es[12], es[8], es[1], es[10], es[5], es[2], es[9], es[4], es[7], es[6]];
    expect(fold(shuffled)).toEqual(fold(es));
    // even a verify that ARRIVES before its execute can't count early: order comes from audit ids, not arrival
    const early = fold([es[0], es[1], es[2], es[3], es[6], es[10]]); // verify #1 delivered with no execute yet
    expect(early.gate).toBe("pass"); // the verify itself is authoritative for #1 ...
    expect(fold([...es.slice(0, 9), es[10]].concat(es[9])).gate).toBe("pending"); // ... and a later execute of #2 is still unchecked
  });

  test("a failed verification is never shown as success, and wins over earlier passes", () => {
    const es = happy();
    es[11] = { ...es[11], payload: { action_id: 2, passed: false } };
    es[12] = { ...es[12], payload: { task_id: 1, success: 0, tool_calls: 9, model_calls: null } };
    const st = fold(es);
    expect(st.gate).toBe("fail");
    expect(st.mascot).not.toBe("verified");
    expect(fold(es.slice(0, 12)).mascot).toBe("error");
  });

  test("a verify event with a non-boolean 'passed' is a failure, not a pass", () => {
    const es = happy().slice(0, 10);
    n = 100;
    const st = fold([...es, ev("verify_action", { action_id: 1, passed: "yes" }), ev("verify_action", { action_id: 2, passed: true })]);
    expect(st.gate).toBe("fail");
  });

  test("a scenario reset (restart, ids reused) clears per-action state but keeps learned skills", () => {
    const es = happy().slice(0, 10); // two applied, unverified
    n = 200;
    const after = [...es, ev("task_end", { task_id: 1, success: 0 }, "operator"), ev("skill_approved", { name: "k", version: 1 }, "human:dana"),
      ev("reset", { scenario: "y" }), ev("task_begin", { task_id: 2, label: "t2", mode: "mock" }),
      ev("propose_action", { action_id: 1, record_id: "C", params: { field: "total", value: 3 } })];
    const st = fold(after);
    expect([st.unverified, st.failed, st.gate]).toEqual([0, 0, "idle"]);
    expect(st.stored).toBe(1);
    expect(st.current?.task).toBe(2);
  });

  test("live: a pending approval reported by the API means Ember waits, whatever the last event was", () => {
    const st = fold(happy().slice(0, 3), 1);
    expect(st.waiting).toBe(true);
    expect(st.mascot).toBe("waiting");
  });

  test("an empty or unknown stream shows nothing done", () => {
    expect(fold([]).mascot).toBe("idle");
    n = 300;
    const st = fold([ev("something_new", { x: 1 })]);
    expect([st.gate, st.stored, st.mascot]).toEqual(["idle", 0, "idle"]);
  });

  test("task identity is stamped from task_begin..task_end", () => {
    const es = normalize(happy().map(fromAudit));
    expect(es.filter((e) => e.task === 1)).toHaveLength(es.length - 1); // all but the reset before the task
  });
});

test.describe("sources stay separate", () => {
  test("story events and recorded events never share ids or provenance links", () => {
    const rec = normalize((recorded.events as LiveEvent[]).map(fromAudit));
    const storyIds = new Set(STORY.map((e) => e.id));
    expect(rec.some((e) => storyIds.has(e.id))).toBe(false);
    expect(STORY.every((e) => e.seq == null && e.at == null)).toBe(true); // illustrations carry no timestamps or audit ids
    expect(consoleLink("story", "review").href).toContain("source=synthetic");
    expect(consoleLink("recorded", "review", 2).href).toBe("?source=recorded&replay=world&task=2#/console/history");
    expect(consoleLink("live", "gate", 7).href).toBe("?source=live&task=7#/console/investigations");
    expect(consoleLink("live", "library", 7).href).toBe("?source=live#/console/skills");
  });

  test("the recorded run folds to its real outcome: both tasks closed, verified, one skill stored", () => {
    const st = sceneState((recorded.events as LiveEvent[]).map(fromAudit));
    expect([st.gate, st.mascot, st.stored, st.unverified, st.failed, st.tickets]).toEqual(["pass", "verified", 1, 0, 0, 0]);
  });

  test("every story beat ends on a real story event", () => {
    expect(BEATS.every((b) => b.end >= 0)).toBe(true);
    expect(sceneState(STORY).mascot).toBe("verified");
  });

  test("a task whose changes were all rejected never ends verified", () => {
    n = 400;
    const st = fold([ev("task_begin", { task_id: 9, label: "r", mode: "real" }, "operator"),
      ev("propose_action", { action_id: 1, record_id: "A", params: { field: "total", value: 1 } }), ev("request_approval", { action_id: 1 }),
      ev("approval_rejected", { action_id: 1 }, "human:dana"), ev("task_end", { task_id: 9, success: 0 }, "operator")]);
    expect([st.mascot, st.gate, st.waiting]).toEqual(["idle", "idle", false]);
  });
});

test("deterministic router work is never drawn or labelled as model work", () => {
  // the router's fast path and bookkeeping events stay out of the Local AI room
  for (const e of [ev("route_awaiting_approval", {}, "router"), ev("route_refused", { reason: "bad ref" }, "router"),
    ev("event_completed", {}, "router"), ev("event_completed_partial", { held: ["PO-8103"] }, "router"),
    ev("channel_inbound", {}, "router"), ev("catalog_register", {}, "router")]) {
    expect(fromAudit(e).dept, e.event).not.toBe("server");
  }
  // an OPEN routed task (skills_used not filled in yet) is a skill run in History, not "Agent with model"
  const [row] = historyRuns([{ id: 3, label: "Routed", scenario: null, mode: "deterministic", status: "open", model: null, started_at: 0,
    ended_at: null, latency_s: null, model_calls: null, tool_calls: null, duplicate_tool_calls: null, actions_executed: null,
    verifications_passed: null, verifications_failed: null, skills_used: [] } as unknown as LiveTask]);
  expect(row.path).toBe("skill");
});
