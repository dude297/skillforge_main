import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MascotState } from "../world/sprites";
import { BASELINE_STEPS, COMPARE } from "./fixtures";
import { StatusGlyph } from "./GraphNode";
import { resolveAt, stateText } from "./projection";
import { clean, type BeatId, type MoonshotEdge, type MoonshotGraph, type MoonshotNode, type NodeState } from "./types";

const TONE: Partial<Record<NodeState, string>> = { proposed: "gold", approved_simulated: "gold", tested: "mint", approved: "mint", verified: "mint", awaiting_approval: "amber", refused: "coral", failed: "coral", active: "azure", configured: "azure" };
const Row = ({ k, children }: { k: string; children: ReactNode }) => <div className="row"><dt>{k}</dt><dd>{children}</dd></div>;
const provText = (p: { kind: string } & Record<string, unknown>) => p.kind === "live" ? `LIVE LOCAL (${clean(p.source, 40)})` : p.kind === "recorded" ? `RECORDED SIMULATION (${clean(p.artifact, 60)})` : `ILLUSTRATION (${clean(p.label, 60)})`;
const Badge = ({ state, label }: { state: NodeState; label: string }) => (
  <span className="ms-badge" data-t={TONE[state] ?? "mute"}><svg width={16} height={16} viewBox="-10 -10 20 20" aria-hidden><StatusGlyph state={state} r={6} /></svg>{label}</span>
);

interface Props { graph: MoonshotGraph; beat: BeatId; selected: string; onClose: () => void; onSelect: (id: string) => void; ember: MascotState }

export function ConnectionInspector({ graph, beat, selected, onClose, onSelect, ember }: Props) {
  const edge = graph.edges.find((e) => e.id === selected);
  const node = graph.nodes.find((n) => n.id === selected);
  const body = selected === "ember" ? <EmberPanel graph={graph} beat={beat} ember={ember} />
    : edge ? <EdgePanel key={edge.id} graph={graph} beat={beat} edge={edge} onSelect={onSelect} />
    : node ? <NodePanel graph={graph} beat={beat} node={node} onSelect={onSelect} /> : <p>Nothing selected.</p>;
  return (
    <aside className="ms-insp" aria-label="Inspector" data-testid="ms-inspector" data-kind={selected === "ember" ? "ember" : edge ? "edge" : "node"}>
      <div className="ms-insp-head"><span className="ms-meta">{graph.modeLabel}</span><button type="button" className="ms-btn ms-close" onClick={onClose} aria-label="Close inspector"><X size={16} aria-hidden /> Close</button></div>
      {body}
    </aside>
  );
}

function Evidence({ graph, ids }: { graph: MoonshotGraph; ids: string[] }) {
  const items = ids.map((i) => graph.evidence[i]).filter(Boolean);
  if (!items.length) return <p className="ms-why">No evidence items attached.</p>;
  return <ul>{items.map((e) => <li key={e.id}><b>{e.type}</b> · {clean(e.source, 80)}{e.at ? ` · ${clean(e.at, 32)}` : ""}<br /><span className="ms-why">{clean(e.description, 300)}</span></li>)}</ul>;
}
const Links = () => (
  <p>Open evidence: <a href="#/demo">Guided demo (recorded run)</a> · <a href="#/console/investigations">Console investigations</a> · <a href="#/console/skills">Console skills</a></p>
);

function NodePanel({ graph, beat, node, onSelect }: { graph: MoonshotGraph; beat: BeatId; node: MoonshotNode; onSelect: (id: string) => void }) {
  const r = resolveAt(node, beat);
  const near = graph.edges.filter((e) => (e.from === node.id || e.to === node.id) && resolveAt(e, beat));
  return (
    <div>
      <h2>{node.label}</h2>
      <p className="ms-meta">{node.sublabel ?? node.kind} · {node.kind.replace("_", " ")}</p>
      {r ? <Badge state={r.state} label={stateText(r)} /> : null}
      <p>{node.summary}</p>
      <h3>Source</h3><p>{provText(node.provenance as never)}</p>
      <h3>Details</h3><dl>{node.facts.map(([k, v], i) => <Row key={i} k={k}>{clean(v, 300)}</Row>)}</dl>
      <h3>Permissions</h3><ul>{node.permissions.length ? node.permissions.map((p, i) => <li key={i}>{p}</li>) : <li>None implied</li>}</ul>
      <h3>Evidence</h3><Evidence graph={graph} ids={node.evidenceIds} />
      {near.length ? <><h3>Connections</h3><ul>{near.map((e) => <li key={e.id}><button type="button" className="ms-btn" onClick={() => onSelect(e.id)}>{graph.nodes.find((n) => n.id === e.from)?.label} to {graph.nodes.find((n) => n.id === e.to)?.label}</button></li>)}</ul></> : null}
      <Links />
    </div>
  );
}

function EmberPanel({ graph, beat, ember }: { graph: MoonshotGraph; beat: BeatId; ember: MascotState }) {
  const info = graph.beats.find((b) => b.id === beat);
  const live = graph.mode === "live";
  return (
    <div>
      <h2>What I am doing</h2>
      <p><Badge state="active" label={`Ember: ${ember}`} /></p>
      <p><b>No active task.</b> {live ? "This is a read-only view of a local run." : "Nothing is running. This is a replay of a recording, not a live task."}</p>
      <dl>
        <Row k="Replay beat">{info?.title} ({beat})</Row>
        <Row k="Beat means">{clean(info?.caption, 300)}</Row>
        <Row k="Source">{graph.modeLabel}</Row>
        <Row k="Authority">None. Ember cannot approve, promote or execute anything; a person approves on the host CLI.</Row>
      </dl>
      <Links />
    </div>
  );
}

const TABS = ["Overview", "Before", "Proposed", "Evidence", "Permissions"] as const;
type Tab = (typeof TABS)[number];

function EdgePanel({ graph, beat, edge, onSelect }: { graph: MoonshotGraph; beat: BeatId; edge: MoonshotEdge; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const tabs = edge.primary ? TABS : TABS.filter((t) => t === "Overview" || t === "Evidence" || t === "Permissions");
  const r = resolveAt(edge, beat);
  const from = graph.nodes.find((n) => n.id === edge.from), to = graph.nodes.find((n) => n.id === edge.to);
  const t = graph.truth;
  const onTab = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const nx = tabs[(i + d + tabs.length) % tabs.length];
    setTab(nx);
    document.getElementById(`ms-tab-${nx}`)?.focus();
  };
  return (
    <div>
      <h2>{from?.label} to {to?.label}</h2>
      <p className="ms-meta">{edge.relation}</p>
      {r ? <Badge state={r.state} label={stateText(r)} /> : null}
      <div className="ms-tabs" role="tablist" aria-label="Connection inspector">
        {tabs.map((x, i) => <button key={x} id={`ms-tab-${x}`} type="button" role="tab" className="ms-tab" aria-selected={tab === x} aria-controls="ms-tabpanel" tabIndex={tab === x ? 0 : -1} onClick={() => setTab(x)} onKeyDown={(e) => onTab(e, i)}>{x}</button>)}
      </div>
      <div id="ms-tabpanel" role="tabpanel" aria-labelledby={`ms-tab-${tab}`}>
        {tab === "Overview" ? (
          <div>
            {edge.kind === "blocked" && edge.reason ? <p className="ms-note" data-t="coral" data-testid="ms-refusal-reason"><b>Refused. Reason from the artifact:</b> {edge.reason}</p> : null}
            {edge.primary ? <p className="ms-note" data-t="gold"><b>Suggested only.</b> This is a hypothesis built from the recorded run. It cannot change anything, and it is not active until a person approves the skill on the host.</p> : null}
            {edge.kind === "skill_reuse" ? <p className="ms-note" data-t="gold" data-testid="ms-reuse-note"><b>Reuse path.</b> model_calls: <b data-testid="ms-model-calls">{edge.modelCalls ?? "Not measured"}</b>{edge.latencyMs != null ? ` · ${edge.latencyMs} ms (recorded)` : ""}. {edge.reason ?? ""}{t.approvalSimulated ? " The skill approval behind this path is SIMULATED, not a person's." : ""}</p> : null}
            <dl>
              <Row k="Status">{r ? stateText(r) : "Not shown yet"}</Row>
              <Row k="Kind">{edge.kind.replace("_", " ")}</Row>
              <Row k="Source">{provText(edge.provenance as never)}</Row>
              {edge.facts.map(([k, v], i) => <Row key={i} k={k}>{clean(v, 300)}</Row>)}
              <Row k="Human next step">{edge.primary || edge.kind === "skill_reuse" ? (t.approvalSimulated ? "In a real run, a person reviews and approves the skill on the host CLI, then each action still needs its own approval. This view cannot do either." : t.approvalPending ? "A person must approve the skill on the host CLI." : "Review the evidence; per-action approval still applies.") : "None: read-only information."}</Row>
              <Row k="Improvement">{edge.improvementPct == null ? "Not measured" : `${edge.improvementPct}%`}</Row>
            </dl>
          </div>
        ) : null}
        {tab === "Before" ? (
          <div>
            <p className="ms-note" data-t="amber" data-testid="ms-baseline-label"><b>CONCEPTUAL baseline. Not measured.</b> This is how the path works without the skill, from the product spec. It is not a recorded trace.</p>
            <ol>{BASELINE_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
            <dl><Row k="Observed trace">None recorded. {edge.facts.find(([k]) => k.startsWith("Baseline model calls"))?.[1] === "Not measured" ? "The recording made no model call, so the old path was not run." : ""}</Row><Row k="Steps / latency / cost">Not measured</Row></dl>
          </div>
        ) : null}
        {tab === "Proposed" ? (
          <div>
            <h3>Compare paths</h3>
            <ul className="ms-cmp" aria-label="Before and proposed">
              <li className="ms-meta" style={{ border: 0, minHeight: 0 }}><b>Before (conceptual)</b></li><li className="ms-meta" style={{ border: 0, minHeight: 0 }}><b>Proposed</b></li>
              {COMPARE.flatMap((c) => [
                <li key={`${c.step}-b`} data-c={c.change} data-empty={c.before == null}>{c.before ?? "—"}</li>,
                <li key={`${c.step}-a`} data-c={c.change} data-empty={c.after == null}>{c.after ?? "Removed: no model call on an exact match"}<br /><span className="ms-badge" data-t={c.change === "removed" ? "coral" : c.change === "replaced" ? "gold" : "mute"}>{c.change.toUpperCase()}</span></li>,
              ])}
            </ul>
            <p className="ms-note" data-t="amber"><b>Approving the skill does not remove per-action approval.</b> Policy, host review and verification stay in the path.</p>
            <h3>Why this is safe</h3>
            <ul className="ms-why"><li>Exact structural match plus equal trusted fingerprint</li><li>Independent tests ({clean(graph.nodes.find((n) => n.id === "verifier")?.sublabel)} hidden; tests, not a formal proof)</li><li>Host approval of the skill</li><li>Re-read verifier after any action</li><li>Fail closed: a mismatch is refused (see INC-3)</li></ul>
            <dl>
              <Row k="Skill">{from && to ? clean(graph.nodes.find((n) => n.id === "skill")?.facts[0]?.[1]) : ""}</Row>
              <Row k="Estimated benefit">Not measured</Row>
              <Row k="Measured benefit">{edge.latencyMs != null ? `Only one number exists: ${edge.latencyMs} ms for INC-2 (recorded). No comparable baseline run, so no speedup is claimed.` : "Not measured"}</Row>
              <Row k="Failure modes">Fingerprint mismatch (refused); skill not approved (stays proposed); verifier unavailable (blocked).</Row>
              <Row k="Rollback / disable">Described only: done on the host registry. Not exposed in this UI.</Row>
            </dl>
          </div>
        ) : null}
        {tab === "Evidence" ? (
          <div>
            <Evidence graph={graph} ids={edge.evidenceIds} />
            {edge.primary ? <><h3>Tests</h3><ul>{(graph.nodes.find((n) => n.id === "verifier")?.facts ?? []).map(([k, v], i) => <li key={i}>{k}: {v}</li>)}</ul></> : null}
            <Links />
            <p className="ms-why">Source type: {provText(edge.provenance as never)}.</p>
            {edge.to ? <p><button type="button" className="ms-btn" onClick={() => onSelect(edge.to)}>Inspect {to?.label}</button></p> : null}
          </div>
        ) : null}
        {tab === "Permissions" ? (
          <dl>
            <Row k="Provenance">{edge.provenance.kind} (says where data came from; grants nothing)</Row>
            <Row k="Human approval required">{edge.humanApprovalRequired == null ? "Not established" : edge.humanApprovalRequired ? "Yes" : "No"}</Row>
            <Row k="Skill approval">{edge.primary || edge.kind === "skill_reuse" ? (t.approvalSimulated ? "SIMULATED by an agent in this recording; not a person's" : t.approvalPending ? "Pending a person on the host" : "Recorded") : "Not applicable"}</Row>
            <Row k="Independently verified">{edge.independentlyVerified == null ? "Not established" : edge.independentlyVerified ? "Tests passed (not the same as approved or executed)" : "No: tests failed"}</Row>
            <Row k="Model calls">{edge.modelCalls ?? "Not measured"}</Row>
            <Row k="Latency">{edge.latencyMs == null ? "Not measured" : `${edge.latencyMs} ms (recorded)`}</Row>
            <Row k="This view can">Read and display. It cannot approve, promote or execute.</Row>
            <Row k="Endpoints">{from?.permissions[0] ?? ""}{to?.permissions[0] ? ` / ${to.permissions[0]}` : ""}</Row>
          </dl>
        ) : null}
      </div>
    </div>
  );
}
