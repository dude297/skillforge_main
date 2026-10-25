// SYNTHETIC design preview: a scripted run that exercises every console state. It is NOT backend output and
// every screen that uses it shows the "Synthetic preview" source badge. Values mirror the backend's learn_a
// scenario (derived totals) so the story matches what the real system does.
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Compare, ProposedFix, SkillArtifact, Step, SystemStatus } from "./types";

export type Phase =
  | "idle" | "investigating" | "awaiting_approval" | "executing" | "reconnecting" | "verified" | "verify_failed"
  | "rejected" | "escalated" | "learning" | "awaiting_promotion" | "promoted" | "reusing" | "reuse_approval"
  | "reuse_done";

export interface Faults { modelOffline: boolean; verifyFails: boolean; connectionDrop: boolean }

export interface RunState {
  phase: Phase;
  steps: Step[];
  fix: ProposedFix | null;
  skill: SkillArtifact | null;
  compare: Compare | null;
  banner: { tone: "warn" | "fail" | "signal"; text: string } | null;
  /** toggles for the NEXT run */
  faults: Faults;
  /** snapshot taken at start: a toggle flipped mid-run doesn't change the run in progress */
  runFaults: Faults;
}

const FIX: ProposedFix = {
  actionId: 7, record: "A-102", field: "total", from: "18.00", to: "17.40",
  reason: "Trusted line items add up to 17.40. The record says 18.00.",
  evidence: [
    { source: "line_export", trusted: true, summary: "lines [600, 540, 600], scale 100, sum 17.40" },
    { source: "operator_note", trusted: false, summary: "\"total looked high last month\" (untrusted, ignored)" },
  ],
};

const SKILL_CODE = `def run(dataset):
    records = {r["id"]: r for r in dataset["records"]}
    proposals = []
    for e in dataset["evidence"]:
        rec = records.get(e["record_id"])
        if not e["trusted"] or rec is None or "lines" not in e["data"]:
            continue
        expected = sum(e["data"]["lines"]) / e["data"].get("scale", 1)
        if abs(rec["data"]["total"] - expected) > 1e-9:
            proposals.append({"record_id": rec["id"], "field": "total",
                              "value": expected, "reason": "sum(lines)/scale"})
    return {"proposals": proposals}`;

type Script = { step: Omit<Step, "state">; after?: (s: RunState) => Partial<RunState> }[];

const INVESTIGATE: Script = [
  { step: { id: "s1", kind: "tool", title: "List the records", call: "read_records {}", result: "5 records", ms: 38 } },
  { step: { id: "s2", kind: "tool", title: "Check A-101", call: 'investigate {"record_id": "A-101"}', result: "total matches its line items", ms: 51 } },
  { step: { id: "s3", kind: "tool", title: "Check A-102", call: 'investigate {"record_id": "A-102"}', result: "total 18.00, line items sum to 17.40", ms: 47 } },
  { step: { id: "s4", kind: "tool", title: "Check the remaining three", call: "investigate A-103, A-104, A-105", result: "no discrepancy", ms: 133 } },
  { step: { id: "s5", kind: "tool", title: "Propose one fix", call: 'propose_action {"record_id": "A-102", "field": "total", "value": 17.4}', result: "action #7 proposed", ms: 22 } },
  { step: { id: "s6", kind: "tool", title: "Ask for approval", call: 'request_approval {"action_id": 7}', result: "waiting for a person", ms: 9 } },
];

const EXECUTE: Script = [
  { step: { id: "e1", kind: "tool", title: "Apply the approved fix", call: 'execute_action {"action_id": 7}', result: "A-102 total 18.00 → 17.40", ms: 14 } },
];

const LEARN: Script = [
  { step: { id: "l1", kind: "skill", title: "Draft a skill from this fix", call: 'propose_skill {"name": "line-total-reconcile"}', result: "helper.py and test_helper.py written", ms: 2100 } },
  { step: { id: "l2", kind: "skill", title: "Run the skill's own tests in the sandbox", call: "pytest tests/ (no network, read-only, 512 MB)", result: "3 of 3 passed", ms: 830 },
    after: (s) => ({ skill: s.skill && { ...s.skill, status: "testing", selfTests: { passed: 3, total: 3 } } }) },
  { step: { id: "l3", kind: "verify", title: "Hidden validation on the host", call: "validation/sum_lines.py (never shown to the agent)", result: "11 of 11 cases passed", ms: 1460 },
    after: (s) => ({ skill: s.skill && { ...s.skill, status: "awaiting_promotion", hidden: { passed: 11, total: 11 }, sha256: "41506b7c7fdec463…" } }) },
];

const REUSE: Script = [
  { step: { id: "r1", kind: "verify", title: "Match new data to a known skill", call: "match_skills (signature: shape, kinds, sources, invariants)", result: "exact match: line-total-reconcile v1", ms: 6 } },
  { step: { id: "r2", kind: "skill", title: "Run the skill, no model involved", call: 'run_skill {"name": "line-total-reconcile", "propose": true}', result: "2 fixes proposed", ms: 410 } },
];

const initial = (faults: Faults): RunState => ({
  phase: "idle", steps: [], fix: null, skill: null, compare: null, banner: null, faults, runFaults: faults,
});

type Action =
  | { type: "patch"; patch: Partial<RunState> }
  /** functional update from the CURRENT reducer state (never from a possibly stale ref snapshot) */
  | { type: "apply"; fn: (s: RunState) => Partial<RunState> }
  | { type: "steps"; fn: (steps: Step[]) => Step[] }
  | { type: "reset" }
  | { type: "fault"; key: keyof Faults };

function reducer(s: RunState, a: Action): RunState {
  switch (a.type) {
    case "patch": return { ...s, ...a.patch };
    case "apply": return { ...s, ...a.fn(s) };
    case "steps": return { ...s, steps: a.fn(s.steps) };
    case "reset": return initial(s.faults);
    case "fault": return { ...s, faults: { ...s.faults, [a.key]: !s.faults[a.key] } };
  }
}

const BUSY = new Set<Phase>(["investigating", "executing", "reconnecting", "learning", "reusing"]);
const STEP_GAP = 650; // ms between scripted steps (preview pacing, not a measurement)

export function useSyntheticRun() {
  const [state, dispatch] = useReducer(reducer, { modelOffline: false, verifyFails: false, connectionDrop: false }, initial);
  const timers = useRef<number[]>([]);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const clearAll = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearAll, []);

  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  const appendStep = (step: Step) => dispatch({ type: "steps", fn: (st) => [...st, step] });
  const setStep = (id: string, patch: Partial<Step>) =>
    dispatch({ type: "steps", fn: (steps) => steps.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  /** Play a script: each step appears as running, then completes. Calls done() after the last one. */
  const play = useCallback((script: Script, done: () => void, offset = 0) => {
    script.forEach(({ step, after }, i) => {
      later(offset + i * STEP_GAP, () => dispatch({ type: "steps", fn: (st) => [...st, { ...step, state: "running" }] }));
      later(offset + i * STEP_GAP + STEP_GAP * 0.7, () => {
        setStep(step.id, { state: "done" });
        if (after) dispatch({ type: "apply", fn: after });
      });
    });
    later(offset + script.length * STEP_GAP, done);
  }, []);

  const start = useCallback(() => {
    if (BUSY.has(stateRef.current.phase)) return; // a second click must not schedule a second set of timers
    clearAll();
    dispatch({ type: "reset" });
    const { modelOffline } = stateRef.current.faults;
    dispatch({ type: "apply", fn: (s) => ({ phase: "investigating", runFaults: s.faults }) });
    if (modelOffline) {
      later(STEP_GAP, () => dispatch({ type: "patch", patch: {
        phase: "escalated",
        steps: [{ id: "x1", kind: "tool", title: "Start an investigation", call: "POST /v1/chat/completions", result: "connection refused after 3 attempts", state: "failed", ms: null }],
        banner: { tone: "warn", text: "The local model is not responding. New investigations are paused and escalated to a person. Approved skills still run without it." },
      } }));
      return;
    }
    play(INVESTIGATE, () => {
      appendStep({ id: "h1", kind: "human", title: "Waiting for your approval", state: "waiting" });
      dispatch({ type: "patch", patch: { phase: "awaiting_approval", fix: FIX } });
    });
  }, [play]);

  // Human actions are accepted only in the phase that asks for them: a click that lands early (e.g. on a panel that
  // is still animating out, or before the script reached the waiting step) must not race the script.
  const decide = useCallback((approve: boolean) => {
    if (stateRef.current.phase !== "awaiting_approval") return;
    setStep("h1", { state: approve ? "done" : "skipped", title: approve ? "Approved by you" : "Rejected by you" });
    if (!approve) {
      dispatch({ type: "patch", patch: { phase: "rejected", banner: { tone: "warn", text: "Rejected. Nothing was changed; the proposal is closed." } } });
      return;
    }
    dispatch({ type: "patch", patch: { phase: "executing" } });
    const { connectionDrop, verifyFails } = stateRef.current.runFaults;
    const verify = () => {
      const passed = !verifyFails;
      appendStep({
        id: "v1", kind: "verify", title: "Independent verification", call: 'verify_action {"action_id": 7}',
        result: passed ? "4 of 4 checks passed against the database" : "field_has_target_value failed: another writer changed A-102",
        state: passed ? "done" : "failed", ms: 11,
      });
      dispatch({ type: "patch", patch: passed
        ? { phase: "verified", banner: null }
        : { phase: "verify_failed", banner: { tone: "fail", text: "Verification failed. The change is recorded and marked for review; nothing is retried automatically." } } });
    };
    if (connectionDrop) {
      later(STEP_GAP, () => dispatch({ type: "patch", patch: { phase: "reconnecting", banner: { tone: "warn", text: "Connection to the host service lost. Reconnecting (attempt 2 of 3)." } } }));
      later(STEP_GAP * 3, () => {
        dispatch({ type: "steps", fn: (st) => [...st, { id: "e1", kind: "tool", title: "Apply the approved fix (retried)", call: 'execute_action {"action_id": 7}', result: "already executed: the first attempt landed; nothing applied twice", state: "done", ms: 12 }] });
        dispatch({ type: "patch", patch: { phase: "executing", banner: { tone: "signal", text: "Reconnected. The retry found the fix already applied and reported it instead of applying it again." } } });
        later(STEP_GAP, verify);
      });
      return;
    }
    play(EXECUTE, verify);
  }, [play]);

  const learn = useCallback(() => {
    if (stateRef.current.phase !== "verified") return;
    dispatch({ type: "patch", patch: { phase: "learning", banner: null, skill: {
      name: "line-total-reconcile", version: 1, status: "drafting", sha256: null, selfTests: null, hidden: null, code: SKILL_CODE } } });
    play(LEARN, () => {
      appendStep({ id: "h2", kind: "human", title: "Waiting for you to promote the skill", state: "waiting" });
      dispatch({ type: "patch", patch: { phase: "awaiting_promotion" } });
    });
  }, [play]);

  const promote = useCallback(() => {
    if (stateRef.current.phase !== "awaiting_promotion") return;
    setStep("h2", { state: "done", title: "Promoted by you" });
    dispatch({ type: "apply", fn: (s) => ({ phase: "promoted", skill: s.skill && { ...s.skill, status: "approved" } }) });
  }, []);

  const reuse = useCallback(() => {
    const { phase, skill } = stateRef.current;
    if (!(phase === "promoted" || (phase === "escalated" && skill?.status === "approved"))) return;
    dispatch({ type: "patch", patch: { phase: "reusing", banner: null, steps: [], fix: null } });
    play(REUSE, () => {
      appendStep({ id: "h3", kind: "human", title: "Waiting for your approval of 2 fixes", state: "waiting" });
      dispatch({ type: "patch", patch: { phase: "reuse_approval" } });
    });
  }, [play]);

  const approveReuse = useCallback(() => {
    if (stateRef.current.phase !== "reuse_approval") return;
    setStep("h3", { state: "done", title: "Approved by you" });
    dispatch({ type: "steps", fn: (st) => [...st, { id: "r3", kind: "verify", title: "Apply and verify both fixes", call: "execute_action ×2, verify_action ×2", result: "2 of 2 verified", state: "done", ms: 31 }] });
    dispatch({ type: "patch", patch: { phase: "reuse_done", compare: {
      source: "synthetic", label: "Example values for the design preview. Real numbers come from the benchmark run on the GB10.",
      rows: [
        { mode: "A", title: "Agent with model", model_calls: 14, seconds: 41.2, tool_calls: 9 },
        { mode: "C", title: "Learned skill", model_calls: 0, seconds: 0.4, tool_calls: 7 },
      ] } } });
  }, []);

  return {
    state,
    start, decide, learn, promote, reuse, approveReuse,
    toggleFault: (key: keyof Faults) => dispatch({ type: "fault", key }),
  };
}

// Preview never claims health: green pills beside a Synthetic badge read as a live system or as faked health.
export const SYNTHETIC_STATUS = {
  inference: { ok: null, model: "not connected (preview)", detail: "preview: no model is connected" },
  sandbox: { ok: null, detail: "preview: no sandbox is connected" },
  host_service: { ok: null, detail: "preview: no host service is connected" },
  db: { quick_check: "ok" },
  next_actions: [],
} satisfies SystemStatus;

/** Full canonical run as a flat step list, for History replay (synthetic preview). */
export const REPLAY_STEPS: Step[] = ([
  ...INVESTIGATE.map((s) => s.step),
  { id: "h1", kind: "human", title: "Approved by Dana" },
  ...EXECUTE.map((s) => s.step),
  { id: "v1", kind: "verify", title: "Independent verification", call: 'verify_action {"action_id": 7}', result: "4 of 4 checks passed against the database", ms: 11 },
  ...LEARN.map((s) => s.step),
  { id: "h2", kind: "human", title: "Skill promoted by Dana" },
] satisfies Omit<Step, "state">[]).map((s) => ({ ...s, state: "done" as const }));
