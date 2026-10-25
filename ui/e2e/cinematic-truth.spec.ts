// THE FORGE (cinematic layer): the visual projection never says more than the fold. Pure logic, no browser: imports the
// same adapter modules the 3D scene renders from (the way world-events.spec.ts imports the fold).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { sceneState, type VizEvent } from "../src/world/events";
import { BEAT_ORDER, type Beat } from "../src/cinematic/contract";
import { ILLUSTRATION_ALL, ILLUSTRATION_BEATS, approvalKind, oncallBeats, oncallCtx, oncallHash, oncallScript, toVisual, visualAt } from "../src/cinematic/adapters";
import type { OnCallRun } from "../src/data/oncall";

const run = (): OnCallRun => JSON.parse(readFileSync(new URL("../public/demo/oncall-run.recorded.json", import.meta.url), "utf-8")) as OnCallRun;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const ctx = { beat: "gate" as Beat, progress: 0.5, provenance: "illustration" as const };
const flat = (b: Record<Beat, VizEvent[]>) => BEAT_ORDER.flatMap((k) => b[k]);
const ev = (id: string, dept: VizEvent["dept"], mascot: VizEvent["mascot"], rest: Partial<VizEvent> = {}): VizEvent => ({ id, dept, mascot, title: id, detail: "", evidence: [], ...rest });
/** every prefix of a script, folded and projected the way a timeline stepping through it would */
const prefixes = (evs: VizEvent[], c: Omit<Parameters<typeof visualAt>[1], never> = ctx) => evs.map((_, i) => {
  const slice = evs.slice(0, i + 1);
  return { i, e: evs[i], slice, scene: sceneState(slice), visual: visualAt(slice, c) };
});

test.describe("verified is never shown without the independent check", () => {
  test("applied but not verified: the gate is checking, never passed", () => {
    const es = [ev("in", "intake", "idle", { effects: ["ticket_in"] }), ev("w", "review", "waiting", { action: 1, effects: ["approval_wait"] }),
      ev("ok", "review", "idle", { action: 1, effects: ["approval_done"] }), ev("ap", "gate", "verifying", { action: 1, effects: ["applied"] })];
    expect(visualAt(es, ctx).verify).toBe("checking");
  });

  test("one of two applied actions verified: still checking; a failed one: failed", () => {
    const base = [ev("a1", "gate", "verifying", { action: 1, effects: ["applied"] }), ev("a2", "gate", "verifying", { action: 2, effects: ["applied"] }),
      ev("v1", "gate", "verified", { action: 1, effects: ["verified"] })];
    expect(visualAt(base, ctx).verify).toBe("checking");
    expect(visualAt([...base, ev("f2", "gate", "error", { action: 2, effects: ["verify_failed"] })], ctx).verify).toBe("failed");
    expect(visualAt([...base, ev("v2", "gate", "verified", { action: 2, effects: ["verified"] })], ctx).verify).toBe("passed");
  });

  test("a task_end-style ticket_out with success does not make an unverified action look verified", () => {
    const es = [ev("a1", "gate", "verifying", { action: 1, effects: ["applied"] }), ev("out", "intake", "verified", { effects: ["ticket_out"], success: true })];
    const v = visualAt(es, ctx);
    expect(v.verify).toBe("checking");
    expect(v.ember).not.toBe("verified");
  });

  test("across every prefix of the illustration and the recorded run: passed implies nothing unverified or failed, and a verified event", () => {
    for (const evs of [ILLUSTRATION_ALL, flat(oncallBeats(run()))]) {
      for (const p of prefixes(evs)) {
        if (p.visual.verify === "passed") {
          expect(p.scene.unverified + p.scene.failed, p.e.id).toBe(0);
          expect(p.slice.some((e) => e.effects?.includes("verified")), p.e.id).toBe(true);
        }
        if (p.scene.unverified > 0) expect(p.visual.verify, p.e.id).not.toBe("passed");
        if (p.scene.failed > 0) expect(p.visual.verify, p.e.id).toBe("failed");
      }
    }
  });
});

test.describe("amber (review waiting) exactly when a person is needed", () => {
  test("review is waiting iff the fold says waiting, across every prefix", () => {
    for (const evs of [ILLUSTRATION_ALL, flat(oncallBeats(run()))]) {
      for (const p of prefixes(evs)) expect(p.visual.review === "waiting", p.e.id).toBe(p.scene.waiting);
    }
  });

  test("independently derived: waiting between approval_wait and approval_done, and while a skill is drafted and not yet stored", () => {
    let pending = 0, drafted = 0;
    for (const p of prefixes(ILLUSTRATION_ALL)) {
      for (const fx of p.e.effects ?? []) {
        if (fx === "approval_wait") pending++;
        if (fx === "approval_done") pending--;
        if (fx === "skill_drafted") drafted++;
        if (fx === "skill_stored") drafted--;
      }
      expect(p.visual.review === "waiting", p.e.id).toBe(pending > 0 || drafted > 0);
    }
  });

  test("no person needed at intake, while investigating, or after a refusal", () => {
    const ids = ["i-in", "i-inv", "i-prop", "rf-in", "rf-out"];
    for (const p of prefixes(ILLUSTRATION_ALL)) if (ids.includes(p.e.id)) expect(p.visual.review, p.e.id).not.toBe("waiting");
  });

  test("a live pending approval makes the review desk wait even with no event for it", () => {
    expect(toVisual(sceneState([ev("in", "intake", "idle", { effects: ["ticket_in"] })], 1), ctx).review).toBe("waiting");
  });
});

test.describe("a refusal never becomes short-path success", () => {
  const out = (success: boolean | undefined) => ev("o", "library", success ? "building" : "error", { effects: ["ticket_out"], success });
  test("ticket_out success true -> short; false -> refused; unreported -> no route", () => {
    expect(visualAt([ev("in", "intake", "idle", { effects: ["ticket_in"] }), out(true)], ctx).route?.kind).toBe("short");
    expect(visualAt([ev("in", "intake", "idle", { effects: ["ticket_in"] }), out(false)], ctx).route?.kind).toBe("refused");
    expect(visualAt([ev("in", "intake", "idle", { effects: ["ticket_in"] }), out(undefined)], ctx).route).toBeNull();
    // also with only the scene (no events)
    expect(toVisual(sceneState([out(false)]), ctx).route?.kind).toBe("refused");
    expect(toVisual(sceneState([out(true)]), ctx).route?.kind).toBe("short");
  });

  test("a refused item never carries a short route, and Ember is not celebrating", () => {
    const evs = ILLUSTRATION_ALL;
    const last = prefixes(evs).at(-1)!;
    expect(last.e.id).toBe("rf-out");
    expect(last.visual.route?.kind).toBe("refused");
    expect(last.visual.ember).not.toBe("verified");
    for (const p of prefixes(evs)) {
      if (p.visual.route?.kind === "short") {
        // short only after a library ticket_out with success === true, and not after a newer ticket_in
        const idx = p.slice.map((e) => e.id).lastIndexOf("sp-run");
        expect(idx, p.e.id).toBeGreaterThanOrEqual(0);
        expect(p.slice.slice(idx + 1).some((e) => e.effects?.includes("ticket_in")), p.e.id).toBe(false);
      }
    }
  });

  test("the recorded refusal ends as refused, the recorded reuse as short", () => {
    const beats = oncallBeats(run());
    const all = flat(beats);
    const iRefuse = all.findIndex((e) => e.id === "o-f-run");
    expect(visualAt(all.slice(0, iRefuse + 1), ctx).route?.kind).toBe("refused");
    expect(visualAt(all.slice(0, all.findIndex((e) => e.id === "o-r-run") + 1), ctx).route?.kind).toBe("short");
  });

  test("a refused reuse in the data is a refusal, not a short path", () => {
    const r = clone(run());
    r.reuse = { ...r.reuse!, state: "refused", reason: "x" };
    const all = flat(oncallBeats(r));
    const v = visualAt(all.slice(0, all.findIndex((e) => e.id === "o-r-run") + 1), ctx);
    expect(v.route?.kind).toBe("refused");
  });

  test("the full route is only used while a ticket is in flight through the AI room", () => {
    for (const p of prefixes(ILLUSTRATION_ALL)) {
      if (p.visual.route?.kind === "full") expect(p.scene.tickets, p.e.id).toBeGreaterThan(0);
    }
  });
});

test.describe("the illustration script follows the real order", () => {
  const ids = ILLUSTRATION_ALL.map((e) => e.id);
  const at = (id: string) => ids.indexOf(id);
  const fxAt = (fx: string, action?: number) => ILLUSTRATION_ALL.findIndex((e) => e.effects?.includes(fx as never) && (action == null || e.action === action));

  test("approval -> applied -> verified, for the first change and for the reuse", () => {
    for (const a of [1, 2]) {
      const w = fxAt("approval_wait", a), d = fxAt("approval_done", a), ap = fxAt("applied", a), v = fxAt("verified", a);
      expect([w, d, ap, v].every((i) => i >= 0)).toBe(true);
      expect(w).toBeLessThan(d);
      expect(d).toBeLessThan(ap);
      expect(ap).toBeLessThan(v);
    }
  });

  test("incident -> investigating -> proposal -> person -> applied -> verified -> skill drafted -> stored -> reuse -> refusal", () => {
    const order = ["i-in", "i-inv", "i-prop", "i-wait", "i-ok", "i-app", "i-ver", "i-write", "i-draft", "i-store", "sp-in", "sp-run", "sp-wait", "sp-ok", "sp-app", "sp-ver", "rf-in", "rf-out"];
    expect(ids).toEqual(order);
  });

  test("the skill is drafted only after the change was verified and stored only after it was drafted", () => {
    expect(fxAt("skill_drafted")).toBeGreaterThan(fxAt("verified", 1));
    expect(fxAt("skill_stored")).toBeGreaterThan(fxAt("skill_drafted"));
    expect(at("sp-in")).toBeGreaterThan(fxAt("skill_stored"));
  });

  test("the reuse proposal and the first one use distinct action ids; the refusal has none", () => {
    expect(ILLUSTRATION_ALL.find((e) => e.id === "sp-run")?.action).toBe(2);
    expect(ILLUSTRATION_ALL.find((e) => e.id === "i-prop")?.action).toBe(1);
    expect(ILLUSTRATION_ALL.find((e) => e.id === "rf-out")?.action).toBeUndefined();
  });

  test("the folded script ends with nothing pending, a stored skill, and the refusal", () => {
    const st = sceneState(ILLUSTRATION_ALL);
    expect([st.waiting, st.unverified, st.failed, st.stored, st.drafted, st.tickets]).toEqual([false, 0, 0, 1, 0, 0]);
    expect(st.gate).toBe("pass");
    expect(st.current?.id).toBe("rf-out");
  });

  test("beats cover the film in order and the empty ones are empty", () => {
    expect(ILLUSTRATION_BEATS.awaken).toEqual([]);
    expect(ILLUSTRATION_BEATS.enter).toEqual([]);
    for (const b of ["storm", "gate", "forge", "shortpath"] as Beat[]) expect(ILLUSTRATION_BEATS[b].length).toBeGreaterThan(0);
    expect(ILLUSTRATION_BEATS.gate.map((e) => e.id)).toEqual(["i-wait", "i-ok", "i-app", "i-ver"]);
  });

  test("no measured claims: no digits, units, ratios or names in illustration copy", () => {
    for (const e of ILLUSTRATION_ALL) {
      const text = [e.title, e.detail, ...e.evidence].join(" ");
      expect(text, e.id).not.toMatch(/\d/);
      expect(text, e.id).not.toMatch(/\b(ms|seconds?|percent|faster|saved?|savings)\b|%/i);
    }
  });

  test("an illustration never shows a hash, even if one is passed", () => {
    const evs = ILLUSTRATION_ALL.slice(0, ids.indexOf("i-store") + 1);
    const v = visualAt(evs, { ...ctx, hash: { value: "a".repeat(64), kind: "illustration" } });
    expect(v.artifact?.phase).toBe("stored");
    expect(v.artifact?.hash).toBeNull();
    expect(visualAt(evs, { ...ctx, hash: { value: "a".repeat(64), kind: "recorded_reference" } }).artifact?.hash).toBeNull(); // provenance illustration wins
  });

  test("artifact phases follow the fold: condensing -> awaiting_person -> stored, and none before", () => {
    const phaseAt = (id: string) => prefixes(ILLUSTRATION_ALL).find((p) => p.e.id === id)!.visual.artifact?.phase ?? null;
    expect(phaseAt("i-ver")).toBeNull();
    expect(phaseAt("i-write")).toBe("condensing");
    expect(phaseAt("i-draft")).toBe("awaiting_person");
    expect(phaseAt("i-store")).toBe("stored");
    expect(phaseAt("rf-out")).toBe("stored");
  });
});

test.describe("the recorded OnCall run", () => {
  test("is recorded, carries the run's own hash, and its approval is simulated", () => {
    const r = run();
    const s = oncallScript(r);
    expect(s.provenance).toBe("recorded");
    expect(s.hash).toEqual({ value: "ab4217f30ca8a01692065b122a35fa4fc49b5219661259d103acea03e8be8624", kind: "recorded_reference" });
    expect(oncallHash(r).value).toBe(r.synthesis?.skill_hash);
    expect(s.approvalKind).toBe("simulated");
    expect(approvalKind(r)).toBe("simulated");
    expect(s.modelWrote).toBe(false);
    expect(oncallCtx(r).modelRan).toBe(false);
  });

  test("beats group the fold's events in order: incident, synthesis up to the wait, the decision, reuse + refusal", () => {
    const b = oncallBeats(run());
    expect(b.awaken).toEqual([]);
    expect(b.enter).toEqual([]);
    expect(b.storm.map((e) => e.id)).toEqual(["o-in", "o-inv"]);
    expect(b.gate.map((e) => e.id)).toEqual(["o-syn", "o-ver", "o-vok", "o-draft", "o-wait"]);
    expect(b.forge.map((e) => e.id)).toEqual(["o-ok", "o-store"]);
    expect(b.shortpath.map((e) => e.id)).toEqual(["o-r-in", "o-r-run", "o-f-in", "o-f-run"]);
  });

  test("the recorded hash reaches the visual only for the stored/drafted skill, as a recorded reference", () => {
    const r = run();
    const all = flat(oncallBeats(r));
    const c = { ...oncallCtx(r), beat: "forge" as Beat, progress: 1 };
    const v = visualAt(all.slice(0, all.findIndex((e) => e.id === "o-store") + 1), c);
    expect(v.artifact).toEqual({ phase: "stored", hash: r.synthesis!.skill_hash, hashKind: "recorded_reference" });
    expect(v.provenance).toBe("recorded");
  });

  test("the approval wait is amber, the simulated approval then stores the skill; the gate checks before the skill is drafted", () => {
    const all = flat(oncallBeats(run()));
    const ps = prefixes(all, { ...oncallCtx(run()), beat: "gate", progress: 1 });
    const by = (id: string) => ps.find((p) => p.e.id === id)!.visual;
    expect(by("o-syn").artifact?.phase).toBe("condensing");
    expect(by("o-ver").verify).toBe("checking");
    expect(by("o-ver").artifact?.phase).toBe("condensing"); // still being tested: not yet awaiting a person
    expect(by("o-vok").verify).toBe("passed");
    expect(by("o-draft").artifact?.phase).toBe("awaiting_person");
    expect(by("o-wait").review).toBe("waiting");
    // the fold keeps asking for a person until the skill is actually stored (the approval event alone does not store it)
    expect(by("o-ok").review).toBe("waiting");
    expect(by("o-ok").artifact?.phase).toBe("awaiting_person");
    expect(by("o-store").review).toBe("decided");
    expect(by("o-store").artifact?.phase).toBe("stored");
  });

  test("the machine is not drawn as working when the run recorded no model", () => {
    const r = run();
    const c = oncallCtx(r);
    const v = visualAt(flat(oncallBeats(r)).slice(0, 2), { ...c, beat: "storm", progress: 1 });
    expect(v.ember).toBe("investigating");
    expect(v.machine.working).toBe(false);
    expect(visualAt(flat(oncallBeats(r)).slice(0, 2), { ...ctx, provenance: "recorded" }).machine.working).toBe(true); // default when nothing says otherwise
  });

  test("verification.passed === false never yields a stored (or drafted, or awaiting) artifact", () => {
    for (const passed of [false, null]) {
      const r = clone(run());
      r.verification!.passed = passed;
      const all = flat(oncallBeats(r));
      const st = sceneState(all);
      expect([st.stored, st.drafted], String(passed)).toEqual([0, 0]);
      for (const p of prefixes(all, { ...oncallCtx(r), beat: "forge", progress: 1 })) {
        expect(p.visual.artifact?.phase ?? null, p.e.id).not.toBe("stored");
        expect(p.visual.artifact?.phase ?? null, p.e.id).not.toBe("awaiting_person");
        expect(p.visual.library.stored, p.e.id).toBe(0);
      }
      const b = oncallBeats(r);
      expect(b.forge, String(passed)).toEqual([]);
      expect(b.shortpath, String(passed)).toEqual([]); // no stored skill, no reuse to show
      expect(st.gate).toBe("fail");
    }
  });

  test("a rejected skill is never stored", () => {
    const r = clone(run());
    r.approval = { ...r.approval!, state: "rejected" };
    const st = sceneState(flat(oncallBeats(r)));
    expect([st.stored, st.drafted]).toEqual([0, 0]);
    expect(oncallBeats(r).shortpath).toEqual([]);
  });

  test("a pending approval stays amber and shows no stored skill", () => {
    const r = clone(run());
    r.approval = { ...r.approval!, state: "pending" };
    const all = flat(oncallBeats(r));
    const v = visualAt(all, { ...oncallCtx(r), beat: "gate", progress: 1 });
    expect(v.review).toBe("waiting");
    expect(v.library.stored).toBe(0);
    expect(oncallBeats(r).forge).toEqual([]);
  });

  test("missing parts give beats without events, never a guessed success", () => {
    const r = clone(run());
    r.incident = null; r.synthesis = null; r.verification = null; r.approval = null; r.reuse = null; r.refusal = null;
    const b = oncallBeats(r);
    for (const k of BEAT_ORDER) expect(b[k], k).toEqual([]);
    expect(approvalKind(r)).toBe("none");
    expect(oncallHash(r).value).toBeNull();

    const noReuse = clone(run()); noReuse.reuse = null; noReuse.refusal = null;
    expect(oncallBeats(noReuse).shortpath).toEqual([]);
    const notRun = clone(run()); notRun.reuse = { ...notRun.reuse!, state: "not_run" }; notRun.refusal = null;
    expect(oncallBeats(notRun).shortpath).toEqual([]);
    const noApproval = clone(run()); noApproval.approval = null;
    expect(oncallBeats(noApproval).shortpath).toEqual([]); // not stored: no short path
  });

  test("a missing hash is null, never made up", () => {
    const r = clone(run());
    r.synthesis!.skill_hash = null;
    const all = flat(oncallBeats(r));
    const v = visualAt(all, { ...oncallCtx(r), beat: "forge", progress: 1 });
    expect(v.artifact?.hash).toBeNull();
  });
});

test.describe("toVisual passes through only what it is given", () => {
  test("progress is clamped, beat/provenance are copied, no hash without ctx", () => {
    const st = sceneState(ILLUSTRATION_ALL);
    const v = toVisual(st, { beat: "enter", progress: 7, provenance: "illustration" });
    expect(v.progress).toBe(1);
    expect(v.beat).toBe("enter");
    expect(v.artifact?.hash).toBeNull();
    expect(toVisual(st, { beat: "enter", progress: Number.NaN, provenance: "illustration" }).progress).toBe(0);
  });

  test("the machine powers up with the awaken beat only", () => {
    const empty = sceneState([]);
    expect(toVisual(empty, { beat: "awaken", progress: 0.4, provenance: "illustration" }).machine.power).toBeCloseTo(0.4);
    expect(toVisual(empty, { beat: "storm", progress: 0.4, provenance: "illustration" }).machine.power).toBe(1);
  });
});
