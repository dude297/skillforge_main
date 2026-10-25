// Audit event -> timeline step. Used for live tasks (sanitized events from the operator API) and recorded replays
// (`python3 -m app audit` exports, raw payloads). Only event names and small payload summaries are shown; unknown
// events are listed generically, never dropped.
import type { Step } from "./types";
import { provenance } from "./provenance";

export interface AuditEvent { id: number; ts: string; actor: string; event: string; payload: Record<string, unknown> }

const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};
const who = (actor: string) => actor.replace(/^human:/, "").replace(/^operator:/, "operator ");

/** before/after of the fields an execution changed: from the API's `changed`, or computed from a raw export */
function changes(p: Record<string, unknown>): string {
  let ch = p.changed as Record<string, [unknown, unknown]> | undefined;
  if (!ch && p.before && p.after) {
    const b = p.before as Record<string, unknown>, a = p.after as Record<string, unknown>;
    ch = Object.fromEntries(Object.keys({ ...b, ...a }).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => [k, [b[k], a[k]]]));
  }
  const parts = Object.entries(ch ?? {}).map(([k, [b, a]]) => `${k} ${short(b)} → ${short(a)}`);
  return parts.length ? parts.join(", ") : "no field changed";
}

export function toStep(e: AuditEvent): Step {
  const p = e.payload ?? {};
  const base = { id: `a${e.id}`, state: "done" as const, ms: null };
  switch (e.event) {
    case "reset": return { ...base, kind: "tool", title: "Scenario loaded", result: short(p.scenario) };
    case "task_begin": return { ...base, kind: "human", title: p.mode === "deterministic" ? "Task opened by the router" : "Task opened by the operator", result: `${short(p.label)} (${provenance(p.mode).short})` };
    case "task_end": return { ...base, kind: "human", title: "Task closed", result: `${p.success ? "succeeded" : "did not fully succeed"}; ${short(p.tool_calls)} tool calls; model calls ${p.model_calls == null ? "not measured" : short(p.model_calls)}` };
    case "investigate": return { ...base, kind: "tool", title: `Investigate ${short(p.record_id)}`, call: "investigate", result: Number(p.findings ?? 0) ? `${short(p.findings)} field mismatch(es) found` : "no direct field mismatch" };
    case "propose_action": {
      const params = (p.params ?? {}) as Record<string, unknown>;
      const bySkill = e.actor.startsWith("skill:");
      return { ...base, kind: bySkill ? "skill" : "tool", title: `${bySkill ? "Skill proposes" : "Propose"} a change to ${short(p.record_id)}`, call: `propose_action ${short(params.field)} = ${short(params.value)}`, result: `action #${short(p.action_id)}` };
    }
    case "request_approval": return { ...base, kind: "tool", title: "Ask for approval", call: `request_approval #${short(p.action_id)}` };
    case "approval_approved": return { ...base, kind: "human", title: `Approved by ${who(e.actor)}`, result: `action #${short(p.action_id)}` };
    case "approval_rejected": return { ...base, kind: "human", title: `Rejected by ${who(e.actor)}`, result: `action #${short(p.action_id)}`, state: "skipped" };
    case "execute_refused": return { ...base, kind: "tool", title: "Execution refused", result: `action #${short(p.action_id)} was '${short(p.status)}', not approved`, state: "failed" };
    case "execute_action": return { ...base, kind: "tool", title: "Apply the approved change", call: `execute_action #${short(p.action_id)}`, result: changes(p) };
    case "verify_action": return { ...base, kind: "verify", title: "Independent verification", call: `verify_action #${short(p.action_id)}`,
      result: p.passed ? "passed" : "FAILED", state: p.passed ? "done" : "failed" };
    case "run_skill": return { ...base, kind: "skill", title: `Skill ran: ${who(e.actor).replace(/^skill:/, "")}`, result: `${short(p.proposals)} proposal(s), no model involved` };
    case "run_skill_refused": return { ...base, kind: "skill", title: `Skill refused: ${short(p.name)}`, result: `${short(p.reason).replaceAll("_", " ")}`, state: "skipped" };
    case "run_skill_error": return { ...base, kind: "skill", title: `Skill failed: ${short(p.name)}`, state: "failed" };
    case "propose_skill": return { ...base, kind: "skill", title: `Skill drafted: ${short(p.name)} v${short(p.version)}`,
      result: p.status === "tested" ? "own tests and replay passed; waiting for a person" : `status: ${short(p.status)}`, state: p.status === "failed_tests" ? "failed" : "done" };
    case "skill_approved": return { ...base, kind: "human", title: `Skill promoted by ${who(e.actor)}`, result: `${short(p.name)} v${short(p.version)}; hidden tests passed` };
    case "skill_hidden_validation_failed": return { ...base, kind: "verify", title: "Hidden validation failed", result: `${short(p.name)} v${short(p.version)} not promoted`, state: "failed" };
    case "skill_rejected": return { ...base, kind: "human", title: `Skill rejected by ${who(e.actor)}`, result: `${short(p.name)} v${short(p.version)}`, state: "skipped" };
    case "skill_rollback": return { ...base, kind: "human", title: `Skill rolled back by ${who(e.actor)}`, result: `${short(p.name)} v${short(p.from)} → v${short(p.to)}` };
    case "escalated_no_model": return { ...base, kind: "human", title: "Escalated: no model available", state: "waiting" };
    default: return { ...base, kind: "tool", title: e.event.replaceAll("_", " "), result: `by ${who(e.actor)}` };
  }
}
