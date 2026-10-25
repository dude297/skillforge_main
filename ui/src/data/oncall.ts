// OnCall run (schema skillforge.oncall_run/1): one incident -> synthesized skill -> verification -> host approval ->
// deterministic reuse + one refusal. Live from GET /ui/demo/oncall, else the static recorded file shipped in dist.
// Any field may be null: null renders as "not measured", never 0. Pure helpers here also run in Node (e2e imports).
export type EvidenceKind = "log" | "metric" | "config" | "deploy";
export interface OnCallRun {
  schema: string;
  mode: "LIVE_REAL_MODEL" | "RECORDED_SIMULATION" | string;
  generated_at: string | null;
  host: string | null;
  model: { id: string | null; endpoint: string | null; available: boolean | null; note: string | null } | null;
  incident: { id: string | null; title: string | null; service: string | null; summary: string | null;
    evidence: { kind: EvidenceKind | string; name: string | null; excerpt: string | null; source_path: string | null }[] | null } | null;
  synthesis: { provenance: "model" | "recorded_reference" | string | null; model_calls: number | null; latency_ms: number | null;
    prompt_tokens: number | null; completion_tokens: number | null; code: string | null; skill_name: string | null;
    skill_version: number | string | null; skill_hash: string | null } | null;
  verification: { hidden: { name: string; pass: boolean | null }[] | null; regression: { name: string; pass: boolean | null }[] | null;
    passed: boolean | null; note: string | null } | null;
  approval: { state: "pending" | "approved" | "rejected" | string | null; by: string | null; at: string | null; command: string | null; kind?: "simulated" | "host_cli" | null } | null;
  reuse: { incident_id: string | null; path: string | null; model_calls: number | null; latency_ms: number | null; diagnosis: string | Record<string, unknown> | null;
    state: "done" | "refused" | "not_run" | string | null; reason: string | null } | null;
  refusal: { incident_id: string | null; state: string | null; reason: string | null } | null;
  telemetry: { gpu: unknown; note: string | null } | null;
  audit: { t: string | null; event: string; detail: string | null }[] | null;
}
export type OnCallOrigin = "endpoint" | "file";
export type DemoMode = "LIVE REAL MODEL" | "RECORDED SCRIPTED SIMULATION" | "DETERMINISTIC SKILL" | "UNAVAILABLE";

export const SCHEMA = "skillforge.oncall_run/1";
export const NM = "not measured";
/** null/undefined/non-finite -> "not measured"; 0 stays 0 because 0 was measured */
export const fmt = (v: unknown, unit = ""): string =>
  v == null || (typeof v === "number" && !Number.isFinite(v)) ? NM
    : `${typeof v === "number" ? v.toLocaleString("en-US") : typeof v === "object" ? JSON.stringify(v) : String(v)}${unit}`;
/** reuse.diagnosis may be a string or a structured object: one readable line either way */
export const diagnosisText = (d: unknown): string => {
  if (d == null || typeof d !== "object") return fmt(d);
  const o = d as Record<string, unknown>;
  return o.root_cause_class ? [o.root_cause_class, o.recommended_remediation].filter(Boolean).map(String).join(": ") : JSON.stringify(d);
};
export const isOnCallRun = (x: unknown): x is OnCallRun =>
  typeof x === "object" && x !== null && (x as { schema?: unknown }).schema === SCHEMA && typeof (x as { mode?: unknown }).mode === "string";

/** Who wrote the code. Only provenance "model" on a LIVE_REAL_MODEL run is model output; anything else is not. */
export const modelWrote = (r: OnCallRun | null) => r?.mode === "LIVE_REAL_MODEL" && r.synthesis?.provenance === "model";

/** The run-level banner. Reuse scenes show DETERMINISTIC SKILL only when the fast path actually ran. */
export function runMode(r: OnCallRun | null, scene: "run" | "reuse" = "run"): DemoMode {
  if (!r) return "UNAVAILABLE";
  if (scene === "reuse") return r.reuse?.state === "done" ? "DETERMINISTIC SKILL" : "UNAVAILABLE";
  return modelWrote(r) ? "LIVE REAL MODEL" : "RECORDED SCRIPTED SIMULATION";
}

export const approved = (r: OnCallRun | null) => r?.approval?.state === "approved";
/** Fail safe: only approval.kind === "host_cli" (typed on the host CLI) counts as a person; missing or "simulated" never does. */
export const humanApproved = (r: OnCallRun | null) => approved(r) && r?.approval?.kind === "host_cli";

/** One step of the technical proof: a master list row with its detail rows. */
export interface ProofStep { id: string; label: string; status: "ok" | "fail" | "wait" | "sim" | "none"; rows: [string, string][] }
const pass = (v: boolean | null | undefined) => (v === true ? "passed" : v === false ? "failed" : NM);

export function proofSteps(r: OnCallRun): ProofStep[] {
  const s = r.synthesis, v = r.verification, a = r.approval, u = r.reuse, f = r.refusal;
  const tests = [...(v?.hidden ?? []).map((t) => ["hidden", t] as const), ...(v?.regression ?? []).map((t) => ["regression", t] as const)];
  return [
    { id: "incident", label: `Incident ${r.incident?.id ?? ""}`.trim(), status: r.incident ? "ok" : "none", rows: [
      ["Title", fmt(r.incident?.title)], ["Service", fmt(r.incident?.service)], ["Evidence items", fmt(r.incident?.evidence?.length)],
      ["Host", fmt(r.host)], ["Generated", fmt(r.generated_at)]] },
    { id: "synthesis", label: "Skill synthesis", status: s ? "ok" : "none", rows: [
      ["Written by", modelWrote(r) ? `local model ${r.model?.id ?? ""}`.trim() : "recorded reference, hand-written ahead of time (not model output)"],
      ["Model", fmt(r.model?.id)], ["Endpoint", fmt(r.model?.endpoint)], ["Model available", r.model?.available == null ? NM : r.model.available ? "yes" : "no"],
      ["Model requests", fmt(s?.model_calls)], ["Latency", fmt(s?.latency_ms, " ms")],
      ["Tokens (prompt / completion)", `${fmt(s?.prompt_tokens)} / ${fmt(s?.completion_tokens)}`],
      ["Skill", `${fmt(s?.skill_name)} v${fmt(s?.skill_version)}`], ["sha256", fmt(s?.skill_hash)]] },
    { id: "verification", label: "Verification", status: v?.passed === true ? "ok" : v?.passed === false ? "fail" : "none", rows: [
      ...tests.map(([k, t]) => [`${k}: ${t.name}`, pass(t.pass)] as [string, string]),
      ["Overall", pass(v?.passed)], ...(v?.note ? [["Note", v.note] as [string, string]] : [])] },
    { id: "approval", label: "Approval", status: humanApproved(r) ? "ok" : a?.state === "rejected" ? "fail" : a?.state === "approved" ? "sim" : "wait", rows: [
      ["State", fmt(a?.state)], ["By", fmt(a?.by)], ["Decided by a person", humanApproved(r) ? "yes: typed on the host (name as typed, not identity-verified)" : a?.state === "approved" ? "no: typed by an agent or test (marked in the approver name)" : "not yet"], ["At", fmt(a?.at)], ["Host command", fmt(a?.command)]] },
    { id: "reuse", label: `Reuse ${u?.incident_id ?? ""}`.trim(), status: u?.state === "done" ? "ok" : u?.state === "refused" ? "fail" : "none", rows: [
      ["State", fmt(u?.state)], ["Path", fmt(u?.path)], ["Model requests", fmt(u?.model_calls)], ["Latency", fmt(u?.latency_ms, " ms")],
      ["Diagnosis", diagnosisText(u?.diagnosis)], ...(u?.reason ? [["Reason", u.reason] as [string, string]] : [])] },
    { id: "refusal", label: `Refusal ${f?.incident_id ?? ""}`.trim(), status: f?.state === "refused" ? "ok" : "none", rows: [
      ["State", fmt(f?.state)], ["Reason", fmt(f?.reason)]] },
    { id: "telemetry", label: "Telemetry", status: r.telemetry?.gpu == null ? "none" : "ok", rows: [
      ["GPU", r.telemetry?.gpu == null ? "not available" : JSON.stringify(r.telemetry.gpu)], ["Note", fmt(r.telemetry?.note)]] },
    { id: "audit", label: "Audit trail", status: r.audit?.length ? "ok" : "none",
      rows: r.audit?.length ? r.audit.map((e) => [`${e.t ?? "time not recorded"}  ${e.event}`, e.detail ?? ""] as [string, string]) : [["Events", "none recorded"]] },
  ];
}
