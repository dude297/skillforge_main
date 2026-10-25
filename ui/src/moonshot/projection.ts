// Pure, deterministic projection: OnCall run artifact -> Living System graph. No network, no clock, no randomness, no model.
// Fail closed: a beat unlocks only when the artifact proves its precondition; unknown stays "unknown"/null; a simulated
// approval is never a person's; model_calls is 0 only if the payload says 0. Also runs in Node (e2e imports it).
import { diagnosisText, humanApproved, modelWrote, type OnCallRun } from "../data/oncall";
import { BEATS, beatIndex, clean, STATE_TEXT, type BeatId, type BeatInfo, type Evidence, type MoonshotEdge, type MoonshotGraph, type MoonshotNode, type NodeState, type Provenance, type Resolved, type Step } from "./types";

export type Origin = "endpoint" | "file" | null;
const ARTIFACT = "oncall-run.recorded.json";
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const st = (at: BeatId, state: NodeState, label?: string): Step => ({ at, state, label });

/** The state of an item at a beat: its last step at or before that beat; null before it first appears. */
export function resolveAt<T extends { steps: Step[] }>(item: T, beat: BeatId): Resolved<T> | null {
  let cur: Step | null = null;
  for (const s of item.steps) if (beatIndex(s.at) <= beatIndex(beat)) cur = s;
  return cur ? { item, state: cur.state, label: cur.label ?? null, at: cur.at } : null;
}
export const stateText = (r: Resolved<unknown>): string => r.label ?? STATE_TEXT[r.state];

const SRC_LABEL: Record<string, string> = { log: "Engine log", metric: "Metrics", config: "Serving config", deploy: "Release record" };
const SRC_ORDER = ["log", "metric", "config", "deploy"];

export function emptyGraph(banner: string): MoonshotGraph {
  const ev: Record<string, Evidence> = {};
  const prov: Provenance = { kind: "recorded", artifact: ARTIFACT, capturedAt: null };
  const ember: MoonshotNode = { id: "ember", kind: "ember", label: "Ember", summary: "No data: nothing is projected, nothing is claimed.", provenance: prov, evidenceIds: [], steps: [st("bootstrap", "unavailable")], facts: [["Task", "No active task"]], permissions: ["Cannot act: read-only view"] };
  const plinth: MoonshotNode = { id: "plinth", kind: "bootstrap", label: "Workspace", sublabel: "no data", summary: "The recording could not be loaded.", provenance: prov, evidenceIds: [], steps: [st("bootstrap", "unavailable")], facts: [["Source", "unavailable"]], permissions: [] };
  const beats: BeatInfo[] = BEATS.map((id, i) => ({ id, title: TITLES[id], caption: i === 0 ? banner : "Locked: no data.", source: "none", unlocked: i === 0, gate: false, lockedReason: i === 0 ? null : "No data loaded" }));
  return {
    mode: "unavailable", modeLabel: "UNAVAILABLE", banner, workspaceId: null, lastUpdated: null, nodes: [ember, plinth],
    edges: [{ id: "edge:plinth-ember", from: "plinth", to: "ember", kind: "observed", relation: "root", provenance: prov, evidenceIds: [], steps: [st("bootstrap", "unavailable")], humanApprovalRequired: null, independentlyVerified: null, modelCalls: null, latencyMs: null, improvementPct: null, facts: [] }],
    evidence: ev, beats, emberByBeat: Object.fromEntries(BEATS.map((b) => [b, "idle"])) as MoonshotGraph["emberByBeat"],
    truth: { referenceSkill: false, approvalSimulated: false, approvalPending: false, modelCalls: null, reuseDone: false, refused: false },
  };
}

const TITLES: Record<BeatId, string> = { bootstrap: "Bootstrap", explore: "Explore", propose: "Propose", test: "Test", approval: "Await approval", reuse: "Reuse", refuse: "Refuse" };

export function projectOnCallToGraph(run: OnCallRun | null, origin: Origin): MoonshotGraph {
  if (!run) return emptyGraph("The OnCall artifact is unavailable. Nothing is shown as discovered, tested or approved.");

  const live = origin === "endpoint" && modelWrote(run);
  const prov: Provenance = live ? { kind: "live", source: "GET /ui/demo/oncall", observedAt: run.generated_at } : { kind: "recorded", artifact: origin === "endpoint" ? "operator API (recorded simulation)" : ARTIFACT, capturedAt: run.generated_at };
  const reference = !modelWrote(run);
  const v = run.verification, ap = run.approval, ru = run.reuse, rf = run.refusal, sy = run.synthesis, inc = run.incident;
  const audit = dedupe(run.audit ?? [], (e) => `${e.t}|${e.event}|${e.detail}`);
  const aud = (name: string) => audit.find((e) => e.event === name);
  const evidence: Record<string, Evidence> = {};
  for (const e of audit) evidence[`audit:${e.event}`] = { id: `audit:${e.event}`, type: "audit", source: ARTIFACT, description: clean(e.detail ?? e.event), at: e.t };

  const verifyPassed = v?.passed === true, verifyFailed = v?.passed === false;
  const approvalDone = ap?.state === "approved", rejected = ap?.state === "rejected";
  const human = humanApproved(run), simulated = approvalDone && !human;
  const pendingSeen = !!aud("pending_approval") || (!approvalDone && !rejected);
  const reuseDone = approvalDone && ru?.state === "done";
  const refused = approvalDone && rf?.state === "refused";
  const modelCalls = num(ru?.model_calls);
  const hidden = v?.hidden ?? [], regr = v?.regression ?? [];
  const hp = hidden.filter((t) => t.pass === true).length, rp = regr.filter((t) => t.pass === true).length;
  const suiteText = (n: number, total: number) => (total ? `${n}/${total}` : "Not measured");

  const items = dedupe(inc?.evidence ?? [], (e) => `${e.kind}|${e.name}`);
  const kinds = [...new Set(items.map((e) => String(e.kind)))].sort((a, b) => (SRC_ORDER.indexOf(a) + 99 * +(SRC_ORDER.indexOf(a) < 0)) - (SRC_ORDER.indexOf(b) + 99 * +(SRC_ORDER.indexOf(b) < 0)) || a.localeCompare(b)).slice(0, 4);
  const sources: MoonshotNode[] = kinds.map((k) => {
    const mine = items.filter((e) => String(e.kind) === k);
    const ids = mine.map((e, i) => { const id = `ev:${k}:${i}`; evidence[id] = { id, type: k, source: clean(e.source_path ?? e.name, 120), description: clean(e.excerpt ?? e.name, 400), at: run.generated_at }; return id; });
    return {
      id: `src:${k}`, kind: "source", label: SRC_LABEL[k] ?? clean(k, 18), sublabel: `${mine.length} item${mine.length === 1 ? "" : "s"}`,
      summary: `Read-only evidence of type "${clean(k, 24)}" attached to the incident. Discovered in the artifact, not a live connection.`,
      provenance: prov, evidenceIds: ids, steps: [st("bootstrap", "discovered")],
      facts: [["Type", clean(k, 24)], ...mine.map((e, i): [string, string] => [`Item ${i + 1}`, clean(e.name, 90)])],
      permissions: ["Read-only. Found in a fixture, which does not imply it is reachable or granted live"],
    };
  });

  const nodes: MoonshotNode[] = [];
  nodes.push({
    id: "ember", kind: "ember", label: "Ember", sublabel: "SkillForge agent", provenance: prov, evidenceIds: [],
    summary: "The SkillForge familiar. Ember is not an authority: it cannot approve, and clicking it changes nothing.",
    steps: [st("bootstrap", "active", "Idle")], facts: [["Reads", "evidence listed in the artifact (read-only)"]], permissions: ["No approval authority", "Cannot execute actions", "A person approves on the host"],
  });
  nodes.push({
    id: "plinth", kind: "bootstrap", label: "Workspace host", sublabel: clean(run.host, 24), provenance: prov, evidenceIds: ["audit:incident_loaded"].filter((i) => evidence[i]),
    summary: "Where the roots start. In this recording the host is a dev box placeholder: this is not GB10 evidence.",
    steps: [st("bootstrap", "configured")],
    facts: [["Host", clean(run.host)], ["Generated", clean(run.generated_at)], ["Mode", clean(run.mode)], ["Model", run.model?.id ? clean(run.model.id) : "none called (model_calls: Not measured)"], ["GPU telemetry", run.telemetry?.gpu == null ? "Not measured" : clean(run.telemetry.gpu)]],
    permissions: ["Configured does not mean healthy or reachable"],
  });
  nodes.push(...sources);
  const svc = clean(inc?.service ?? "service", 40);
  if (inc) {
    nodes.push({
      id: "service", kind: "service", label: "Inference Gateway", sublabel: svc, provenance: prov, evidenceIds: ["audit:incident_loaded"].filter((i) => evidence[i]),
      summary: `Conceptual label for the serving path the OnCall scenario exercises. The artifact names the service "${svc}"; no gateway connector is configured or implied.`,
      steps: [st("explore", "discovered")], facts: [["Service in artifact", svc], ["Summary", clean(inc.summary)]], permissions: ["No connector exists: this is a label over fixture data"],
    });
    nodes.push({
      id: "incident1", kind: "incident", label: clean(inc.id ?? "INC-1", 12), sublabel: "the incident", provenance: prov, evidenceIds: ["audit:incident_loaded"].filter((i) => evidence[i]),
      summary: clean(inc.title), steps: [st("explore", "discovered", "Investigated")],
      facts: [["Title", clean(inc.title)], ["Service", svc], ["Evidence items", String(items.length)], ["Source", "SYNTHETIC fixture (per the audit trail)"]], permissions: ["Read-only investigation"],
    });
  }
  nodes.push({
    id: "workflow", kind: "workflow", label: "Incident Recovery", sublabel: "conceptual workflow", provenance: prov, evidenceIds: [],
    summary: "The workflow the proposal would shorten. A label for the OnCall scenario, not a configured automation.",
    steps: [st("propose", "proposed"), ...(reuseDone ? [st("reuse", "active", "Reuse path lit (proposal only)")] : [])],
    facts: [["What it is", "conceptual label; mapped to the OnCall demo"], ["Applied changes", "none: the reuse run only proposes (never applied)"]], permissions: ["Proposals only: a person approves and applies"],
  });
  const skillName = clean(sy?.skill_name ?? "skill", 48);
  const skillSteps: Step[] = [st("propose", "proposed", reference ? "Proposed (reference)" : "Proposed")];
  if (verifyPassed) skillSteps.push(st("test", "tested")); else if (verifyFailed) skillSteps.push(st("test", "failed"));
  if (verifyPassed) {
    if (pendingSeen) skillSteps.push(st("approval", "awaiting_approval"));
    else if (human) skillSteps.push(st("approval", "approved")); else if (simulated) skillSteps.push(st("approval", "approved_simulated"));
    if (approvalDone) skillSteps.push(st("reuse", human ? "approved" : "approved_simulated"));
    else if (rejected) skillSteps.push(st("approval", "refused", "Rejected"));
  }
  evidence["skill"] = { id: "skill", type: "skill", source: ARTIFACT, description: `${skillName} v${clean(sy?.skill_version)} sha256 ${clean(sy?.skill_hash, 20)}`, at: run.generated_at };
  evidence["hidden"] = { id: "hidden", type: "tests", source: ARTIFACT, description: `Hidden suite ${suiteText(hp, hidden.length)}`, at: run.generated_at };
  evidence["regression"] = { id: "regression", type: "tests", source: ARTIFACT, description: `Regression ${suiteText(rp, regr.length)}`, at: run.generated_at };
  evidence["approval"] = { id: "approval", type: "approval", source: ARTIFACT, description: `${clean(ap?.state)} by ${clean(ap?.by)} (${ap?.kind === "host_cli" ? "host CLI" : "SIMULATED, not a person"})`, at: ap?.at ?? null };
  nodes.push({
    id: "skill", kind: "skill", label: skillName.length > 24 ? `${skillName.slice(0, 23)}…` : skillName, sublabel: `v${clean(sy?.skill_version)}`, provenance: prov, evidenceIds: ["skill", "audit:recorded_reference"].filter((i) => evidence[i]),
    summary: reference ? "A hand-written reference skill, not model output. The recording shows it moving through tests and a SIMULATED approval." : `Skill written by local model ${clean(run.model?.id)}.`,
    steps: skillSteps,
    facts: [["Written by", reference ? "hand-written reference (an agent, not the model)" : `local model ${clean(run.model?.id)}`], ["Version", clean(sy?.skill_version)], ["sha256", clean(sy?.skill_hash, 64)], ["Model calls (synthesis)", clean(sy?.model_calls)], ["Latency (synthesis)", sy?.latency_ms == null ? "Not measured" : `${sy.latency_ms} ms`]],
    permissions: ["Exact-match only; refuses on fingerprint mismatch", "Approving the skill does not remove per-action human approval", "Proposes; never applies"],
  });
  const vSteps: Step[] = verifyPassed ? [st("test", "tested", `Tests passed ${suiteText(hp, hidden.length)} + ${suiteText(rp, regr.length)}`)] : verifyFailed ? [st("test", "failed")] : [st("test", "unknown", "Not measured")];
  nodes.push({
    id: "verifier", kind: "verifier", label: "Independent tests", sublabel: `hidden ${suiteText(hp, hidden.length)}`, provenance: prov, evidenceIds: ["hidden", "regression"],
    summary: `Hidden suite ${suiteText(hp, hidden.length)}, regression ${suiteText(rp, regr.length)}. ${clean(v?.note ?? "")}`, steps: vSteps,
    facts: [...hidden.map((t): [string, string] => [`hidden: ${clean(t.name, 60)}`, t.pass === true ? "passed" : t.pass === false ? "failed" : "Not measured"]), ...regr.map((t): [string, string] => [`regression: ${clean(t.name, 60)}`, t.pass === true ? "passed" : t.pass === false ? "failed" : "Not measured"])],
    permissions: ["Tests passed is not host-approved, and not executed"],
  });
  const gateSteps: Step[] = [];
  if (verifyPassed) {
    if (pendingSeen) gateSteps.push(st("approval", "awaiting_approval", "Needs a person"));
    if (approvalDone) gateSteps.push(st(pendingSeen ? "reuse" : "approval", human ? "approved" : "approved_simulated", human ? "Approved on host" : "SIMULATED approval"));
    else if (rejected) gateSteps.push(st("approval", "refused", "Rejected"));
  }
  nodes.push({
    id: "gate", kind: "human_gate", label: "Host approval", sublabel: "a person, at the host CLI", provenance: prov, evidenceIds: ["approval", "audit:pending_approval"].filter((i) => evidence[i]),
    summary: simulated ? "Pending until a person runs the approve command on the host. This recording then shows an approval typed by an agent: it is not a person's." : human ? "Approved by a person on the host (name as typed, not identity-verified)." : "Waiting for a person on the host.",
    steps: gateSteps,
    facts: [["State in artifact", clean(ap?.state)], ["By", clean(ap?.by)], ["Decided by a person", human ? "yes (host CLI; not identity-verified)" : approvalDone ? "NO: simulated by an agent" : "not yet"], ["At", clean(ap?.at)], ["Host command (recorded, not run here)", clean(ap?.command, 260)]],
    permissions: ["This view cannot approve, promote or execute", "Approval happens on the host CLI only"],
  });
  const routerOk = reuseDone;
  nodes.push({
    id: "router", kind: "router", label: "Exact-match router", sublabel: "core matcher", provenance: prov, evidenceIds: ["audit:reuse_inc2"].filter((i) => evidence[i]),
    summary: "Routes a recurring incident to an approved skill only when the structural match is exact AND the incident fingerprint is equal.",
    steps: routerOk ? [st("reuse", "active", "Exact match")] : approvalDone ? [st("reuse", "unknown")] : [],
    facts: [["Rule", "core matcher exact + incident fingerprint equal"], ["Result on INC-2", clean(ru?.reason)]], permissions: ["Fail closed: any mismatch refuses"],
  });
  if (ru) {
    evidence["reuse"] = { id: "reuse", type: "reuse", source: ARTIFACT, description: `${clean(ru.incident_id)} ${clean(ru.state)}: model_calls ${clean(ru.model_calls)}, ${ru.latency_ms == null ? "latency Not measured" : `${ru.latency_ms} ms`}`, at: aud("reuse_inc2")?.t ?? null };
    nodes.push({
      id: "incident2", kind: "incident", label: clean(ru.incident_id ?? "INC-2", 12), sublabel: "recurrence", provenance: prov, evidenceIds: ["reuse"],
      summary: `Compatible recurrence. Path: ${clean(ru.path)}. ${diagnosisText(ru.diagnosis)}`, steps: reuseDone ? [st("reuse", "active", "Proposal only")] : approvalDone ? [st("reuse", "unknown")] : [],
      facts: [["Path", clean(ru.path)], ["Model calls", clean(ru.model_calls)], ["Latency", ru.latency_ms == null ? "Not measured" : `${ru.latency_ms} ms (recorded)`], ["Diagnosis", clean(diagnosisText(ru.diagnosis), 300)], ["Outcome", "proposal only; never applied"]],
      permissions: ["Proposal only: a person approves and applies it"],
    });
  }
  if (rf) {
    evidence["refusal"] = { id: "refusal", type: "refusal", source: ARTIFACT, description: clean(rf.reason, 500), at: aud("reuse_inc3")?.t ?? null };
    nodes.push({
      id: "incident3", kind: "incident", label: clean(rf.incident_id ?? "INC-3", 12), sublabel: "lookalike", provenance: prov, evidenceIds: ["refusal"],
      summary: "Looks structurally like INC-1 but is a different failure. Sent to the same route.", steps: refused ? [st("refuse", "discovered", "Lookalike")] : [],
      facts: [["Why it is different", "disk-full OSError, not GPU OOM"]], permissions: ["Read-only"],
    });
    nodes.push({
      id: "refusal", kind: "refusal", label: "Refused", sublabel: "fingerprint mismatch", provenance: prov, evidenceIds: ["refusal"],
      summary: clean(rf.reason, 600), steps: refused ? [st("refuse", "refused")] : [],
      facts: [["State", clean(rf.state)], ["Reason (verbatim from artifact)", clean(rf.reason, 600)], ["Success badge", "never shown for a refusal"]], permissions: ["Stopping point: no action, no growth"],
    });
  }

  const E = (e: Omit<MoonshotEdge, "provenance" | "humanApprovalRequired" | "independentlyVerified" | "modelCalls" | "latencyMs" | "improvementPct" | "facts" | "evidenceIds"> & Partial<MoonshotEdge>): MoonshotEdge => ({
    provenance: prov, evidenceIds: [], humanApprovalRequired: null, independentlyVerified: null, modelCalls: null, latencyMs: null, improvementPct: null, facts: [], ...e,
  });
  const edges: MoonshotEdge[] = [];
  edges.push(E({ id: "edge:plinth-ember", from: "plinth", to: "ember", kind: "observed", relation: "Root: the workspace feeds Ember", steps: [st("bootstrap", "configured")] }));
  for (const s of sources) {
    edges.push(E({ id: `edge:plinth-${s.id}`, from: "plinth", to: s.id, kind: "observed", relation: "Root: found in the artifact", steps: [st("bootstrap", "discovered")], evidenceIds: s.evidenceIds }));
    edges.push(E({ id: `edge:${s.id}-ember`, from: s.id, to: "ember", kind: "observed", relation: "Ember reads this (read-only)", steps: [st("bootstrap", "discovered")], evidenceIds: s.evidenceIds }));
  }
  if (inc) {
    edges.push(E({ id: "edge:ember-incident1", from: "ember", to: "incident1", kind: "observed", relation: "Ember investigates the incident", steps: [st("explore", "active", "Investigated")], evidenceIds: ["audit:incident_loaded"].filter((i) => evidence[i]) }));
    edges.push(E({ id: "edge:incident1-service", from: "incident1", to: "service", kind: "observed", relation: "Incident affects the service", steps: [st("explore", "discovered")] }));
  }
  const pSteps: Step[] = [st("propose", "proposed")];
  if (verifyPassed) pSteps.push(st("test", "tested")); else if (verifyFailed) pSteps.push(st("test", "failed"));
  if (verifyPassed) {
    if (pendingSeen) pSteps.push(st("approval", "awaiting_approval"));
    if (approvalDone) pSteps.push(st(pendingSeen ? "reuse" : "approval", human ? "approved" : "approved_simulated"));
    else if (rejected) pSteps.push(st("approval", "refused", "Rejected"));
  }
  edges.push(E({
    id: "edge:gateway-recovery", from: "service", to: "workflow", kind: "proposed", primary: true, label: true,
    relation: "Suggested: skip model investigation for a recurring, exactly-matching incident",
    steps: pSteps, evidenceIds: ["skill", "hidden", "regression", "approval", "audit:pending_approval"].filter((i) => evidence[i]),
    humanApprovalRequired: true, independentlyVerified: verifyPassed ? true : verifyFailed ? false : null, modelCalls, latencyMs: num(ru?.latency_ms), improvementPct: null,
    reason: "Hypothesis from the recorded OnCall run, not a measurement.",
    facts: [["Mapped to", "OnCall scenario (recorded)"], ["Baseline model calls (INC-1 synthesis)", clean(sy?.model_calls)], ["Suggested because", clean(`${inc?.title ?? "incident"}; skill ${skillName} passed the independent tests`)]],
  }));
  if (inc) edges.push(E({ id: "edge:incident1-skill", from: "incident1", to: "skill", kind: "proposed", relation: reference ? "Reference skill proposed for this incident class" : "Skill synthesized from this incident", steps: [st("propose", "proposed")], evidenceIds: ["skill"] }));
  edges.push(E({ id: "edge:skill-verifier", from: "skill", to: "verifier", kind: "proposed", relation: "Skill is tested by the independent suite", steps: verifyPassed ? [st("test", "tested")] : verifyFailed ? [st("test", "failed")] : [st("test", "unknown")], evidenceIds: ["hidden", "regression"], independentlyVerified: verifyPassed ? true : verifyFailed ? false : null }));
  if (verifyPassed) edges.push(E({ id: "edge:verifier-gate", from: "verifier", to: "gate", kind: "proposed", relation: "Tests passed; promotion needs a person", label: true, humanApprovalRequired: true, steps: pendingSeen ? [st("approval", "awaiting_approval"), ...(approvalDone ? [st("reuse", human ? "approved" : "approved_simulated")] : [])] : approvalDone ? [st("approval", human ? "approved" : "approved_simulated")] : [], evidenceIds: ["approval"] }));
  if (reuseDone) {
    const rv = `model_calls: ${modelCalls ?? "Not measured"}`;
    edges.push(E({ id: "edge:incident2-router", from: "incident2", to: "router", kind: "skill_reuse", relation: "Recurring incident enters the exact-match router", steps: [st("reuse", "active")], evidenceIds: ["reuse"] }));
    edges.push(E({ id: "edge:router-skill", from: "router", to: "skill", kind: "skill_reuse", relation: "Exact match + equal fingerprint selects the approved skill", steps: [st("reuse", "active")], evidenceIds: ["reuse"], humanApprovalRequired: true }));
    edges.push(E({ id: "edge:skill-workflow", from: "skill", to: "workflow", kind: "skill_reuse", relation: `Reuse path, no model investigation (${rv})`, label: true, steps: [st("reuse", "active", simulated ? "Reuse (skill approval SIMULATED)" : "Reuse")], evidenceIds: ["reuse", "approval"], humanApprovalRequired: true, modelCalls, latencyMs: num(ru?.latency_ms), improvementPct: null, reason: "Proposal only; nothing is applied. Per-action approval still applies." }));
  }
  if (refused) {
    edges.push(E({ id: "edge:incident3-router", from: "incident3", to: "router", kind: "blocked", relation: "Lookalike sent to the same route", steps: [st("refuse", "refused", "Blocked")], evidenceIds: ["refusal"] }));
    edges.push(E({ id: "edge:router-refusal", from: "router", to: "refusal", kind: "blocked", relation: "Stops at the fingerprint check", label: true, steps: [st("refuse", "refused")], evidenceIds: ["refusal"], reason: clean(rf?.reason, 600) }));
  }

  const t = (n: string) => aud(n)?.t ?? null;
  const caption: Record<BeatId, [string, string]> = {
    bootstrap: ["Your workspace, mapped locally. Roots grow from the host to the evidence the recording read.", "incident_loaded"],
    explore: [`Ember reads ${items.length} evidence item${items.length === 1 ? "" : "s"} for ${clean(inc?.id ?? "the incident", 12)} (read-only).`, "incident_loaded"],
    propose: [reference ? "Ember proposes a repeatable shortcut. The skill is a hand-written reference, NOT model output." : `Ember proposes a skill written by ${clean(run.model?.id)}.`, "recorded_reference"],
    test: [`Hidden suite ${suiteText(hp, hidden.length)}, regression ${suiteText(rp, regr.length)}. Tests, not a formal proof.`, "verified"],
    approval: [pendingSeen ? "Autoplay stops here. A person must run the approve command on the host." : "Approval state as recorded.", pendingSeen ? "pending_approval" : "approved"],
    reuse: [`${clean(ru?.incident_id ?? "INC-2", 12)} matches exactly. model_calls: ${modelCalls ?? "Not measured"}, ${ru?.latency_ms == null ? "latency Not measured" : `${ru.latency_ms} ms (recorded)`}.${simulated ? " The skill approval in this recording is SIMULATED." : ""}`, "reuse_inc2"],
    refuse: [`${clean(rf?.incident_id ?? "INC-3", 12)} is refused: the fingerprint differs.`, "reuse_inc3"],
  };
  const lock: Record<BeatId, string | null> = {
    bootstrap: null, explore: inc ? null : "No incident in the artifact", propose: sy ? null : "No skill in the artifact",
    test: v ? null : "No verification in the artifact", approval: verifyPassed ? null : "Locked: verification did not pass",
    reuse: !verifyPassed ? "Locked: verification did not pass" : !approvalDone ? "Locked: no approval in the artifact" : ru?.state === "done" ? null : "Locked: reuse did not run",
    refuse: !verifyPassed ? "Locked: verification did not pass" : !approvalDone ? "Locked: no approval in the artifact" : rf?.state === "refused" ? null : "Locked: no refusal recorded",
  };
  const beats: BeatInfo[] = BEATS.map((id) => ({ id, title: TITLES[id], caption: lock[id] ?? caption[id][0], source: `${caption[id][1]}${t(caption[id][1]) ? ` @ ${t(caption[id][1])}` : ""}`, unlocked: lock[id] === null, gate: id === "approval" && pendingSeen && verifyPassed, lockedReason: lock[id] }));

  return {
    mode: live ? "live" : "recorded", modeLabel: live ? "LIVE LOCAL" : "RECORDED SIMULATION",
    banner: live ? "Live local run from the operator API (read-only)." : `Recorded simulation. ${reference ? "Reference skill hand-written, not model output." : ""} ${simulated ? "Approval simulated by an agent, not a person." : human ? "Approved by a person on the host." : "Approval pending."}`.replace(/\s+/g, " ").trim(),
    workspaceId: inc?.id ?? null, lastUpdated: run.generated_at, nodes, edges, evidence, beats,
    emberByBeat: { bootstrap: "idle", explore: "investigating", propose: "building", test: verifyFailed ? "error" : "verifying", approval: pendingSeen && verifyPassed ? "waiting" : "idle", reuse: "idle", refuse: "idle" },
    truth: { referenceSkill: reference, approvalSimulated: simulated, approvalPending: pendingSeen, modelCalls, reuseDone, refused },
  };
}

function dedupe<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}
