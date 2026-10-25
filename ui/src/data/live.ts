// LIVE adapter for the read-only operator API (app/ui_api.py, `python -m app ui`). Same origin as the console when
// served by that process; GET only, the session is an HttpOnly cookie the browser sends by itself. Every payload is a
// sanitized projection of authoritative backend rows. Nothing here can approve, promote or execute anything.
import type { TaskMode } from "./provenance";
import type { SystemStatus } from "./types";
import { PREVIEW } from "../lib/preview";

const BASE = (import.meta.env.VITE_OPERATOR_API as string | undefined) ?? "/ui";
const TIMEOUT_MS = 6000;

export type LiveResult<T> = { ok: true; data: T } | { ok: false; reason: "unreachable" | "unauthorized" | "bad_response" | "server_error"; detail: string };

export interface LiveEvent { id: number; ts: string; actor: string; event: string; payload: Record<string, unknown> }

export interface LiveTask {
  id: number; label: string; scenario: string | null; mode: TaskMode | string; status: "open" | "closed" | "aborted" | string;
  model: string | null; started_at: number; ended_at: number | null; latency_s: number | null;
  model_calls: number | null; tool_calls: number | null; duplicate_tool_calls: number | null;
  actions_executed: number | null; verifications_passed: number | null; verifications_failed: number | null;
  invariant_violations: number | null; success: number | null; skills_used: string[]; skill_proposed: string[];
  tool_breakdown: Record<string, number> | null;
}

export type WorkflowState = "PENDING" | "WAITING_APPROVAL" | "READY" | "VERIFYING" | "COMPLETED" | "NEEDS_REVIEW" | "CANCELLED" | "FAILED";

export interface LiveAction {
  id: number; fingerprint: string; task_id: number | null; record_id: string; type: string; field: string | null; value: unknown; reason: string;
  status: string; state: WorkflowState; origin: string; created_at: string; current_value: unknown;
  approval: { status: string; decided_by: string | null; requested_at: string; decided_at: string | null } | null;
  execution: { at: string; changed: Record<string, [unknown, unknown]> } | null;
  verifications: { passed: boolean; at: string; checks: { check: string; passed: boolean; actual?: unknown; expected?: unknown }[] }[];
  evidence: { source: string; trusted: boolean; summary: string }[];
}

export interface LiveTaskDetail {
  task: LiveTask; events: LiveEvent[]; events_complete: boolean; events_truncated: boolean;
  tool_calls: { id: number; tool: string; ok: boolean; ms: number; ts: string }[];
  actions: LiveAction[]; skills_proposed: { name: string; version: number; status: string }[];
}

export interface LiveSkill {
  name: string; version: number; parent_version: number | null; status: string; active: boolean; description: string;
  decided_by: string | null; source_task: number | null; created_at: string; sha256: string; touches: string[];
  validation: { lint_errors: number; own_tests_ok: boolean | null; own_tests: Record<string, number> | null; replay_ok: boolean | null };
  hidden_ok: boolean | null;
  optimization: { recommended: boolean | null; retained: boolean | null; warm_speedup: number | null };
  runs: { total: number; ok: number; refused: number; error: number; verified_pass: number; verified_fail: number };
}

export interface LiveStatus extends SystemStatus {
  checked_at: number;
  open_tasks: { id: number; label: string; mode: string; age_s: number }[];
  workflows_by_state: Record<string, number[]>;
  approved_skills: string[];
}

export interface LiveBench { file: string; mtime: number; result: Record<string, unknown> }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const isHealth = (h: unknown) => isObj(h) && "ok" in h && "detail" in h;
const has = (key: string) => (x: unknown) => isObj(x) && x.ok === true && Array.isArray(x[key]);

/** Runtime shape checks: a malformed payload becomes bad_response, never a crash or a half-rendered screen. */
const V = {
  status: (x: unknown) => isObj(x) && isHealth(x.inference) && isHealth(x.sandbox) && isHealth(x.host_service)
    && isObj(x.db) && typeof x.db.quick_check === "string" && Array.isArray(x.next_actions),
  tasks: has("tasks"), events: (x: unknown) => has("events")(x) && typeof (x as { last_id?: unknown }).last_id === "number",
  approvals: has("pending"), skills: has("skills"),
  task: (x: unknown) => isObj(x) && x.ok === true && isObj(x.task) && Array.isArray(x.events) && Array.isArray(x.actions),
  skill: (x: unknown) => isObj(x) && x.ok === true && isObj(x.skill) && isObj(x.files),
  bench: (x: unknown) => isObj(x) && x.ok === true && typeof x.file === "string" && isObj(x.result),
  health: (x: unknown) => isObj(x) && x.ok === true && x.read_only === true,
};

async function get<T>(path: string, valid: (x: unknown) => boolean, timeoutMs = TIMEOUT_MS): Promise<LiveResult<T>> {
  // hosted preview: no operator API exists, so no request is ever made
  if (PREVIEW) return { ok: false, reason: "unreachable", detail: "read-only preview: no live system is connected" };
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, { signal: ctl.signal, credentials: "same-origin", cache: "no-store" });
    if (r.status === 401) return { ok: false, reason: "unauthorized", detail: "not signed in: open the URL printed by `python3 -m app ui` once" };
    let data: unknown = null;
    try { data = await r.json(); } catch { /* handled below */ }
    if (!r.ok) {
      const msg = isObj(data) && isObj(data.error) ? String(data.error.message) : `HTTP ${r.status}`;
      return { ok: false, reason: r.status >= 500 ? "server_error" : "bad_response", detail: msg };
    }
    return valid(data) ? { ok: true, data: data as T } : { ok: false, reason: "bad_response", detail: "unexpected response shape" };
  } catch (e) {
    return { ok: false, reason: "unreachable", detail: ctl.signal.aborted ? `no answer within ${timeoutMs / 1000} s` : e instanceof Error ? e.message : String(e) };
  } finally {
    window.clearTimeout(timer);
  }
}

export const live = {
  base: BASE,
  health: () => get<{ ok: true }>("/health", V.health),
  status: (timeoutMs?: number) => get<LiveStatus>("/status", V.status, timeoutMs),
  tasks: (limit = 50) => get<{ tasks: LiveTask[] }>(`/tasks?limit=${limit}`, V.tasks),
  task: (id: number) => get<LiveTaskDetail>(`/tasks/${Math.trunc(id)}`, V.task),
  events: (after: number) => get<{ events: LiveEvent[]; last_id: number; anchor: { id: number; ts: string; event: string } | null }>(`/events?after=${Math.max(0, Math.trunc(after))}&limit=500`, V.events),
  approvals: () => get<{ pending: LiveAction[] }>("/approvals", V.approvals),
  skills: () => get<{ skills: LiveSkill[] }>("/skills", V.skills),
  skill: (name: string, version: number) => get<{ skill: LiveSkill; files: Record<string, string>; files_note: string | null }>(
    `/skills/${encodeURIComponent(name)}/${Math.trunc(version)}`, V.skill),
  benchLatest: () => get<LiveBench>("/bench/latest", V.bench),
  // EXPERIMENT (exp/bootstrap-lite): served only by `python -m experiments.bootstrap_lite`; discovery is read-only
  workspaces: () => get<{ workspaces: LiteWorkspace[] }>("/bootstrap/workspaces", has("workspaces")),
  discover: (id: string) => get<LiteDiscovery>(`/bootstrap/discover/${encodeURIComponent(id)}`,
    (x) => has("capabilities")(x) && has("workflows")(x) && has("permissions")(x) && isObj((x as { manifest?: unknown }).manifest), 30_000),
};

export type LiteState = "illustrative" | "discovered" | "configured" | "approved" | "active" | "unavailable";
export interface LiteWorkspace { id: string; file: string; name: { untrusted_text: string }; supported: boolean; why_not: string | null; kind: string }
export interface LiteItem { id: string; name: string; room: "intake" | "server" | "review" | "gate" | "library" | null; state: LiteState; evidence: string; next_step: string | null }
export interface LiteDiscovery {
  ok: true; workspace: LiteWorkspace; read_only: true; writes_performed: number; status_checked_at: number | null;
  capabilities: LiteItem[]; workflows: LiteItem[];
  permissions: { action: string; fields: string[]; human_approval: boolean; granted: boolean; how: string }[];
  summary: { active: string[]; counts: Record<LiteState, number> };
  manifest: {
    environment: { name: { untrusted_text: string }; description: { untrusted_text: string }; records: number; record_kinds: string[]; evidence_sources: string[]; signature: string };
    tool_inventory: Record<string, string>;
    roles: { agent: string[]; human_only: string[]; router: string[] };
    unverified_assumptions: string[];
  };
}

export { approveCommand, disableCommand, promoteCommand, rejectCommand, rollbackCommand } from "./commands";
