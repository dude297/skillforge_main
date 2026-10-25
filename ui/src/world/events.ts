// Normalized visualization events. ONE shape for three sources, never mixed:
//   story     illustrative script (labelled "Illustration")
//   recorded  a real backend run, captured through the read-only operator API (sanitized) -> recorded-run.json
//   live      the same API, now
// The scene is a pure fold over these events. It never shows success that isn't authoritative: an action counts as
// verified only after ITS verify event passed, and "all good" only when nothing applied is still unchecked or failed.
import type { LiveEvent } from "../data/live";
import { provenance } from "../data/provenance";
import type { MascotState } from "./sprites";

import { diagnosisText, fmt, modelWrote, type OnCallRun } from "../data/oncall";

export type Dept = "intake" | "server" | "review" | "gate" | "library";
export type VizSource = "story" | "recorded" | "live" | "oncall";
export type Effect = "ticket_in" | "ticket_out" | "approval_wait" | "approval_done" | "applied" | "verified" | "verify_failed"
  | "skill_drafted" | "skill_stored" | "skill_dropped" | "reset";

export interface VizEvent {
  id: string;
  /** audit id (recorded/live): the authoritative order and the dedupe key */
  seq?: number;
  /** the action this event is about (ids restart after a scenario reset; the fold resets with them) */
  action?: number;
  /** task this event belongs to; set by normalize() from task_begin..task_end */
  task?: number;
  dept: Dept;
  mascot: MascotState;
  title: string;
  detail: string;
  /** what a viewer can inspect: short, sanitized facts */
  evidence: string[];
  effects?: Effect[];
  /** task_end only: the backend's own success verdict */
  success?: boolean;
  at?: string;
}

export const DEPTS: Record<Dept, { name: string; role: string }> = {
  intake: { name: "Operations intake", role: "Where new problems arrive: a batch of records whose totals look wrong." },
  server: { name: "Local AI room", role: "The model and the agent's sandbox. Everything runs on this machine; nothing goes to a cloud model." },
  review: { name: "Human review desk", role: "A person approves every change and promotes every skill. The agent can't approve its own work." },
  gate: { name: "Independent check", role: "Code the agent doesn't control re-reads the database after each change, and runs hidden tests on every new skill." },
  library: { name: "Skill library", role: "Verified, person-approved skills. A new problem that matches one exactly takes the short path." },
};

const NEEDS_HUMAN: Record<string, string> = {
  not_authorized: "this team has no approved automation for it", stale: "a rule it depends on changed; its owner must revalidate",
  ambiguous: "more than one procedure could apply", records_need_person: "some records need a person",
  conflict: "the skill's output was refused", needs_human: "a person decides",
};
const s = (v: unknown) => (v == null ? "?" : typeof v === "string" ? v : JSON.stringify(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Real audit event (sanitized by the operator API) -> visualization event. Unknown events stay visible, generic. */
export function fromAudit(e: LiveEvent): VizEvent {
  const p = e.payload ?? {};
  const base = { id: `a${e.id}`, seq: e.id, at: e.ts, action: num(p.action_id) };
  const who = e.actor.replace(/^human:/, "");
  switch (e.event) {
    case "reset": return { ...base, dept: "intake", mascot: "idle", effects: ["reset"], title: "New data loaded", detail: `Scenario ${s(p.scenario)}`, evidence: [`scenario: ${s(p.scenario)}`] };
    case "task_begin": return { ...base, task: num(p.task_id), dept: "intake", mascot: "idle", effects: ["ticket_in"], title: "A problem arrives", detail: s(p.label),
      evidence: [`task #${s(p.task_id)}`, `done by: ${provenance(p.mode).label}`] };
    case "investigate": return { ...base, dept: "server", mascot: "investigating", title: `Investigating ${s(p.record_id)}`,
      detail: Number(p.findings) ? `${s(p.findings)} field mismatch(es)` : "no direct field mismatch", evidence: [`investigate ${s(p.record_id)}`] };
    case "propose_action": {
      const pr = (p.params ?? {}) as Record<string, unknown>;
      const skill = e.actor.startsWith("skill:");
      return { ...base, dept: skill ? "library" : "server", mascot: "building", title: skill ? "The skill proposes a fix" : "Proposing one bounded fix",
        detail: `${s(p.record_id)}: ${s(pr.field)} → ${s(pr.value)}`, evidence: [`action #${s(p.action_id)}`, `${s(pr.field)} = ${s(pr.value)}`, skill ? e.actor.split("#")[0] : "by the agent"] };
    }
    case "request_approval": return { ...base, dept: "review", mascot: "waiting", effects: ["approval_wait"], title: "Waiting for a person",
      detail: `action #${s(p.action_id)} needs approval`, evidence: ["nothing changes until a person approves"] };
    case "execute_refused": return { ...base, dept: "server", mascot: "error", title: "Acting early: refused",
      detail: `action #${s(p.action_id)} was '${s(p.status)}', not approved`, evidence: ["the policy refused it; nothing changed"] };
    case "approval_approved": return { ...base, dept: "review", mascot: "idle", effects: ["approval_done"], title: `Approved by ${who}`, detail: `action #${s(p.action_id)}`, evidence: [`decided on the host by ${who}`] };
    case "approval_rejected": return { ...base, dept: "review", mascot: "idle", effects: ["approval_done"], title: `Rejected by ${who}`, detail: `action #${s(p.action_id)}`, evidence: ["no change was made"] };
    case "execute_action": {
      const ch = Object.entries((p.changed ?? {}) as Record<string, [unknown, unknown]>).map(([k, [b, a]]) => `${k} ${s(b)} → ${s(a)}`);
      return { ...base, dept: "gate", mascot: "verifying", effects: ["applied"], title: "Applied once; checking", detail: ch.join(", ") || "applied", evidence: [`action #${s(p.action_id)}`, ...ch] };
    }
    case "verify_action": return p.passed === true
      ? { ...base, dept: "gate", mascot: "verified", effects: ["verified"], title: "Verified", detail: `action #${s(p.action_id)} passed the independent check`, evidence: ["the verifier re-read the database"] }
      : { ...base, dept: "gate", mascot: "error", effects: ["verify_failed"], title: "Verification failed", detail: `action #${s(p.action_id)} needs review`, evidence: ["marked for a person; nothing is redone automatically"] };
    case "propose_skill": return { ...base, dept: "library", mascot: p.status === "tested" ? "waiting" : "error", effects: p.status === "tested" ? ["skill_drafted"] : [],
      title: `Skill drafted: ${s(p.name)} v${s(p.version)}`, detail: p.status === "tested" ? "its own tests and the replay passed; a person must promote it" : `status: ${s(p.status)}`,
      evidence: [`status: ${s(p.status)}`] };
    case "skill_approved": return { ...base, dept: "library", mascot: "verified", effects: ["skill_stored"], title: `Skill stored: ${s(p.name)} v${s(p.version)}`,
      detail: `hidden tests passed; promoted by ${who}`, evidence: ["hidden tests: passed", `promoted by ${who}`] };
    case "skill_hidden_validation_failed": return { ...base, dept: "gate", mascot: "error", effects: ["verify_failed"], title: "Hidden tests failed", detail: `${s(p.name)} v${s(p.version)} not promoted`, evidence: [] };
    case "skill_rejected": return { ...base, dept: "review", mascot: "idle", effects: ["skill_dropped"], title: `Skill rejected by ${who}`, detail: `${s(p.name)} v${s(p.version)}`, evidence: [] };
    case "run_skill": return { ...base, dept: "library", mascot: "building", title: `Short path: ${e.actor.replace(/^skill:/, "")}`, detail: `${s(p.proposals)} fix(es) proposed, no model involved`, evidence: ["no model call"] };
    case "run_skill_refused": return { ...base, dept: "library", mascot: "error", title: "Skill refused this data", detail: s(p.reason).replaceAll("_", " "), evidence: ["the agent investigates instead"] };
    case "task_end": return { ...base, task: num(p.task_id), dept: "intake", mascot: p.success ? "verified" : "idle", effects: ["ticket_out"], success: p.success === 1 || p.success === true,
      title: "Problem closed", detail: p.success ? "fixed and verified" : "closed without full verification", evidence: [`${s(p.tool_calls)} tool calls`, `model calls: ${p.model_calls == null ? "not measured" : s(p.model_calls)}`] };
    // router decisions that run nothing: who handles it now, from the router's closed `kind` vocabulary
    case "route_needs_human": return { ...base, dept: "review", mascot: "waiting", title: "Handed to a person",
      detail: NEEDS_HUMAN[s(p.kind)] ?? "a person decides", evidence: ["no model used", "nothing changed"] };
    case "route_deferred": return { ...base, dept: "server", mascot: "idle",
      title: p.kind === "inference_down" ? "Deferred: no local model available" : "Deferred: other work is open",
      detail: "the request is saved", evidence: ["no model used", "nothing changed"] };
    case "route_queued_for_agent": return { ...base, dept: "server", mascot: "idle", title: "Queued for the local model",
      detail: "unfamiliar work: the agent investigates next", evidence: ["nothing changes until a person approves a proposal"] };
    // the router's fast path never touches the local AI room: no model is involved, so nothing is drawn there
    case "route_awaiting_approval": return { ...base, dept: "review", mascot: "waiting", title: "Waiting for a person",
      detail: "an approved skill proposed the change", evidence: ["no model used", "nothing changes until a person approves"] };
    case "route_refused": return { ...base, dept: "intake", mascot: "idle", title: "Refused at intake",
      detail: s(p.reason).slice(0, 120), evidence: ["no model used", "nothing changed"] };
    case "event_completed": return { ...base, dept: "intake", mascot: "idle", title: "Reply sent: done",
      detail: "every change was approved, applied once and verified", evidence: ["no model used"] };
    case "event_completed_partial": return { ...base, dept: "review", mascot: "idle", title: "Partly done: some records need a person",
      detail: Array.isArray(p.held) && p.held.length ? `held: ${p.held.join(", ")}` : "some records were held", evidence: ["held records were not changed"] };
    case "event_needs_review": return { ...base, dept: "review", mascot: "idle", title: "Needs review by a person",
      detail: "a change did not verify; nothing is redone automatically", evidence: [] };
    case "channel_inbound": return { ...base, dept: "intake", mascot: "idle", title: "Message received", detail: `from ${who}`, evidence: [] };
    // anything else is bookkeeping (catalog, environment versions): shown at intake, never as model work
    default: return { ...base, dept: "intake", mascot: "idle", title: e.event.replaceAll("_", " "), detail: `by ${who}`, evidence: [] };
  }
}

/** OnCall run fields -> the guided demo's scene events, grouped by demo scene. Derived only from the run document;
 * a missing part yields no events (never a guessed success). Reuse goes intake -> library: the AI room is skipped. */
export function fromOnCall(r: OnCallRun): { incident: VizEvent[]; synthesis: VizEvent[]; reuse: VizEvent[] } {
  const inc = r.incident, sy = r.synthesis, v = r.verification, a = r.approval, u = r.reuse, f = r.refusal;
  const who = modelWrote(r) ? `the local model (${r.model?.id ?? "id not recorded"})` : "a recorded reference, hand-written ahead of time (not model output)";
  const incident: VizEvent[] = inc ? [
    { id: "o-in", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: `Incident ${inc.id ?? ""}: ${inc.title ?? "untitled"}`,
      detail: inc.summary ?? `service ${fmt(inc.service)}`, evidence: [`service: ${fmt(inc.service)}`] },
    { id: "o-inv", dept: "server", mascot: "investigating", title: "Investigating the evidence",
      detail: `${inc.evidence?.length ?? 0} item(s): logs, metrics, config, deploys`, evidence: (inc.evidence ?? []).map((e) => `${e.kind}: ${e.source_path ?? "path not recorded"}`) },
  ] : [];
  const synthesis: VizEvent[] = [];
  if (sy) synthesis.push({ id: "o-syn", dept: "server", mascot: "building", title: `Writing skill ${fmt(sy.skill_name)} v${fmt(sy.skill_version)}`,
    detail: `code by ${who}`, evidence: [`model requests: ${fmt(sy.model_calls)}`, `latency: ${fmt(sy.latency_ms, " ms")}`] });
  if (v) synthesis.push(
    { id: "o-ver", dept: "gate", mascot: "verifying", action: 900, effects: ["applied"], title: "Hidden and regression tests",
      detail: `${v.hidden?.length ?? 0} hidden, ${v.regression?.length ?? 0} regression`, evidence: ["hidden tests the skill never saw, plus INC-1 regression"] },
    v.passed === true
      ? { id: "o-vok", dept: "gate", mascot: "verified", action: 900, effects: ["verified"], title: "Verified", detail: "every hidden and regression test passed", evidence: [] }
      : { id: "o-vno", dept: "gate", mascot: "error", action: 900, effects: ["verify_failed"], title: v.passed === false ? "Verification failed" : "Verification not measured",
        detail: v.note ?? "not promoted", evidence: [] });
  if (sy && v?.passed === true) synthesis.push({ id: "o-draft", dept: "library", mascot: "waiting", effects: ["skill_drafted"], title: "Skill drafted",
    detail: "waits for a person before it can run", evidence: [`sha256 ${fmt(sy.skill_hash)}`] });
  if (a) {
    synthesis.push({ id: "o-wait", dept: "review", mascot: "waiting", action: 901, effects: ["approval_wait"], title: "Waiting for a person on the host",
      detail: a.command ?? "approval command not recorded", evidence: ["the browser can't approve"] });
    if (a.state === "approved") synthesis.push(
      { id: "o-ok", dept: "review", mascot: "idle", action: 901, effects: ["approval_done"], title: `Approved by ${a.by ?? "a person (name not recorded)"}`, detail: fmt(a.at), evidence: [] },
      { id: "o-store", dept: "library", mascot: "verified", effects: ["skill_stored"], title: "Stored in the library", detail: `sha256 ${fmt(sy?.skill_hash)}`, evidence: [] });
    if (a.state === "rejected") synthesis.push({ id: "o-rej", dept: "review", mascot: "idle", action: 901, effects: ["approval_done", "skill_dropped"],
      title: `Rejected by ${a.by ?? "a person"}`, detail: "the skill is not stored", evidence: [] });
  }
  const reuse: VizEvent[] = [];
  if (u && u.state && u.state !== "not_run") reuse.push(
    { id: "o-r-in", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: `Similar incident ${u.incident_id ?? ""}`.trim(), detail: "same evidence shape", evidence: [] },
    u.state === "done"
      ? { id: "o-r-run", dept: "library", mascot: "building", effects: ["ticket_out"], success: true, title: "Short path: the skill, no model",
        detail: `diagnosis: ${diagnosisText(u.diagnosis)}`, evidence: [`model requests: ${fmt(u.model_calls)}`, `latency: ${fmt(u.latency_ms, " ms")}`] }
      : { id: "o-r-run", dept: "library", mascot: "error", effects: ["ticket_out"], success: false, title: "The skill refused", detail: fmt(u.reason), evidence: [] });
  if (f && f.state) reuse.push(
    { id: "o-f-in", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: `Different incident ${f.incident_id ?? ""}`.trim(), detail: "evidence does not match the skill", evidence: [] },
    { id: "o-f-run", dept: "library", mascot: "error", effects: ["ticket_out"], success: false, title: f.state === "refused" ? "Refused: handed to a person" : `Outcome: ${f.state}`,
      detail: fmt(f.reason), evidence: ["no guess, nothing changed"] });
  return { incident, synthesis, reuse };
}

/** OnCall audit trail entry -> scene event (the World replay). Event names are matched by keyword; anything
 * unrecognised stays visible at intake as bookkeeping, never as model work. */
export function fromOnCallAudit(e: { t: string | null; event: string; detail: string | null }, i: number): VizEvent {
  const n = e.event.toLowerCase(), base = { id: `oa${i}`, seq: i, at: e.t ?? undefined, title: e.event.replaceAll("_", " "), detail: e.detail ?? "", evidence: [] };
  if (/refus/.test(n) || /^refused/i.test(e.detail ?? "")) return { ...base, dept: "library", mascot: "error" };
  if (/reuse|fastpath|fast_path|run_skill/.test(n)) return { ...base, dept: "library", mascot: "building" };
  if (/approv|reject/.test(n)) return /request|pending|wait/.test(n)
    ? { ...base, dept: "review", mascot: "waiting", effects: ["approval_wait"], action: 901 }
    : { ...base, dept: "review", mascot: "idle", effects: ["approval_done"], action: 901 };
  if (/verif|hidden|regression|test/.test(n)) return /fail/.test(n)
    ? { ...base, dept: "gate", mascot: "error", effects: ["applied", "verify_failed"], action: 900 }
    : /start|run|begin/.test(n) ? { ...base, dept: "gate", mascot: "verifying" } : { ...base, dept: "gate", mascot: "verified", effects: ["applied", "verified"], action: 900 };
  if (/store|promot|library/.test(n)) return { ...base, dept: "library", mascot: "verified", effects: ["skill_stored"] };
  if (/synth|model|generat|skill|reference/.test(n)) return { ...base, dept: "server", mascot: "building" };
  if (/investig|evidence|diagnos/.test(n)) return { ...base, dept: "server", mascot: "investigating" };
  if (/incident|received|arriv/.test(n)) return { ...base, dept: "intake", mascot: "idle", effects: ["ticket_in"] };
  return { ...base, dept: "intake", mascot: "idle" };
}

/** Dedupe by id (last delivery wins), restore audit order when every event has one, and stamp task identity. */
export function normalize(events: VizEvent[]): VizEvent[] {
  const byId = new Map<string, VizEvent>();
  for (const e of events) byId.set(e.id, e);
  let out = [...byId.values()];
  if (out.every((e) => e.seq != null)) out = out.sort((a, b) => a.seq! - b.seq!);
  let task: number | undefined;
  return out.map((e) => {
    if (e.effects?.includes("ticket_in") && e.task != null) task = e.task;
    const stamped = { ...e, task: e.task ?? task };
    if (e.effects?.includes("ticket_out")) task = undefined;
    return stamped;
  });
}

/** Illustrative story, in the order the real system enforces (approve BEFORE apply; verify AFTER). */
const STORY_EVENTS: VizEvent[] = [
  { id: "s1", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: "A problem arrives", detail: "Five records; some totals don't match their line items.", evidence: ["no rule exists for this yet"] },
  { id: "s2", dept: "server", mascot: "investigating", title: "Investigating", detail: "Reads each record and the evidence behind it, on the local model.", evidence: ["trusted: line-item export", "untrusted: an old note (ignored)"] },
  { id: "s3", dept: "server", mascot: "building", action: 1, title: "Proposing one bounded fix", detail: "A-102: total 45 → 44, from the trusted line items.", evidence: ["one field, one record", "reason attached"] },
  { id: "s4", dept: "server", mascot: "error", action: 1, title: "Acting early: refused", detail: "It tried to apply the fix before approval. The policy said no.", evidence: ["nothing changed"] },
  { id: "s5", dept: "review", mascot: "waiting", action: 1, effects: ["approval_wait"], title: "Waiting for a person", detail: "The change waits at the review desk with its evidence.", evidence: ["the agent can't approve its own work"] },
  { id: "s6", dept: "review", mascot: "idle", action: 1, effects: ["approval_done"], title: "Approved by Dana", detail: "On the host, with a command bound to exactly this change.", evidence: ["--expect fingerprint"] },
  { id: "s7", dept: "gate", mascot: "verifying", action: 1, effects: ["applied"], title: "Applied once; checking", detail: "The change is applied exactly once, then re-read from the database.", evidence: ["a retry can't apply it twice"] },
  { id: "s8", dept: "gate", mascot: "verified", action: 1, effects: ["verified", "ticket_out"], title: "Verified", detail: "Independent code confirms the record now matches its evidence.", evidence: ["3 of 3 checks passed"] },
  { id: "s9", dept: "library", mascot: "building", title: "Turning the fix into a skill", detail: "Ember writes a small program and its own tests.", evidence: ["own tests: passed", "replay of the approved fix: matched"] },
  { id: "s10", dept: "gate", mascot: "verifying", effects: ["skill_drafted"], title: "Hidden tests decide", detail: "Tests Ember never saw check the new skill.", evidence: ["hidden suite runs on the host"] },
  { id: "s11", dept: "review", mascot: "waiting", title: "A person promotes it", detail: "Nothing enters the library without a named person.", evidence: ["promotion is a host command"] },
  { id: "s12", dept: "library", mascot: "verified", effects: ["skill_stored"], title: "Stored in the library", detail: "Version-locked and active.", evidence: ["sha256 pinned", "can be rolled back"] },
  { id: "s13", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: "A similar problem arrives", detail: "Next week's batch has the same shape.", evidence: ["exact match on the data's fingerprint"] },
  { id: "s14", dept: "library", mascot: "building", action: 2, title: "The short path", detail: "The skill proposes the fix in milliseconds, without the model.", evidence: ["no model call"] },
  { id: "s15", dept: "review", mascot: "waiting", action: 2, effects: ["approval_wait"], title: "Same approval", detail: "A person still decides.", evidence: ["no shortcut around people"] },
  { id: "s16", dept: "review", mascot: "idle", action: 2, effects: ["approval_done"], title: "Approved", detail: "Same command, bound to this change.", evidence: ["--expect fingerprint"] },
  { id: "s17", dept: "gate", mascot: "verifying", action: 2, effects: ["applied"], title: "Applied once; checking", detail: "Same verifier.", evidence: [] },
  { id: "s18", dept: "gate", mascot: "verified", action: 2, effects: ["verified", "ticket_out"], title: "Verified again", detail: "Every change is checked, whoever proposed it.", evidence: ["verified"] },
];

/** Scroll beats group story events (by id, not position); the scene shows the state after the beat's last event. */
const BEAT_DEFS: { until: string; heading: string; body: string }[] = [
  { until: "s1", heading: "A problem nobody wrote a rule for arrives.", body: "A batch of records with totals that don't add up. There's no script for it, so it needs judgment." },
  { until: "s3", heading: "Ember, the AI agent, investigates right here.", body: "It reads the records and the evidence behind them on the local model, then proposes one small, bounded fix. Nothing leaves this machine." },
  { until: "s5", heading: "A person decides.", body: "Ember tried to apply the fix early. The policy refused. The change waits at the review desk until a person approves it." },
  { until: "s8", heading: "Independent code checks the result.", body: "The fix is applied exactly once. Then the gate, code the agent doesn't control, re-reads the database and confirms it." },
  { until: "s10", heading: "The fix becomes a skill.", body: "Ember writes a small program and its own tests. Hidden tests it has never seen decide whether it's correct." },
  { until: "s12", heading: "A person promotes it into the library.", body: "Nothing becomes a skill without a named person. It's version-locked and can be rolled back. A green block on the shelf is a skill that passed everything." },
  { until: "s18", heading: "The next one takes the short path.", body: "A similar problem goes straight to the library: no model needed. The same approval and the same gate still apply." },
];

export const STORY = STORY_EVENTS;
export const BEATS = BEAT_DEFS.map((b) => ({ ...b, end: STORY_EVENTS.findIndex((e) => e.id === b.until) }));

export interface SceneState {
  current: VizEvent | null;
  /** what Ember shows: the last event's pose, corrected so it never claims success the backend hasn't confirmed */
  mascot: MascotState;
  tickets: number;
  /** a person is needed: a change awaiting approval, or a tested skill awaiting promotion */
  waiting: boolean;
  gate: "idle" | "pending" | "pass" | "fail";
  drafted: number;
  stored: number;
  served: boolean;
  /** applied but not yet verified, and failed, action keys (for evidence) */
  unverified: number;
  failed: number;
}

/** Fold events into what the scene draws. Pure; same for every source. */
export function sceneState(events: VizEvent[], pendingApprovals = 0): SceneState {
  const st: SceneState = { current: null, mascot: "idle", tickets: 0, waiting: false, gate: "idle", drafted: 0, stored: 0, served: false, unverified: 0, failed: 0 };
  const pending = new Set<string>(), unverified = new Set<string>(), failed = new Set<string>();
  let passed = false;
  for (const e of normalize(events)) {
    st.current = e;
    const key = e.action != null ? `action-${e.action}` : e.id;
    for (const fx of e.effects ?? []) {
      if (fx === "reset") { pending.clear(); unverified.clear(); failed.clear(); passed = false; } // action rows are wiped
      if (fx === "ticket_in") st.tickets++;
      if (fx === "ticket_out") st.tickets = Math.max(0, st.tickets - 1);
      if (fx === "approval_wait") pending.add(key);
      if (fx === "approval_done") pending.delete(key);
      if (fx === "applied") unverified.add(key);
      if (fx === "verified") { unverified.delete(key); failed.delete(key); passed = true; }
      if (fx === "verify_failed") { unverified.delete(key); failed.add(key); }
      if (fx === "skill_drafted") st.drafted++;
      if (fx === "skill_stored") { st.stored++; st.drafted = Math.max(0, st.drafted - 1); }
      if (fx === "skill_dropped") st.drafted = Math.max(0, st.drafted - 1); // rejected: no longer waiting for a person
    }
    if (e.dept === "server" && e.mascot === "investigating") st.served = true;
  }
  st.unverified = unverified.size;
  st.failed = failed.size;
  st.gate = failed.size ? "fail" : unverified.size ? "pending" : passed ? "pass" : "idle";
  st.waiting = pending.size > 0 || st.drafted > 0 || pendingApprovals > 0;
  let m: MascotState = st.current?.mascot ?? "idle";
  // never celebrate while something applied is unchecked or failed, or when the backend didn't call it a success
  if (m === "verified" && (unverified.size || failed.size)) m = failed.size ? "error" : "verifying";
  if (st.current?.effects?.includes("ticket_out") && st.current.success === false) m = "idle";
  if (pendingApprovals > 0 && m !== "error") m = "waiting"; // live: a person is needed right now
  st.mascot = m;
  return st;
}

/** Where a department/event opens in the console, keeping provenance: illustration -> Preview, recorded -> Recorded
 * (the same run, replayed in History), live -> Live (the same task). Only views the console already has. */
export function consoleLink(source: VizSource, dept: Dept, task?: number): { href: string; label: string } {
  const section = dept === "library" ? "skills" : dept === "server" ? "system" : "investigations";
  if (source === "oncall") return { href: "#/console/investigations/incident", label: "Open the incident proof in the console" };
  if (source === "story") return { href: `?source=synthetic#/console/${section}`, label: "Open the console preview" };
  if (source === "recorded") return { href: `?source=recorded&replay=world${task != null ? `&task=${task}` : ""}#/console/history`, label: `Replay ${task != null ? `task ${task}` : "this run"} in the console` };
  return { href: `?source=live${task != null && section === "investigations" ? `&task=${task}` : ""}#/console/${section}`, label: task != null && section === "investigations" ? `Open task ${task} in the console` : "Open in the console" };
}
