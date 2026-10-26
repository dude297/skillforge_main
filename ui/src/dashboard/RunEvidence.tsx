import { useState } from "react";
import { ArrowUpRight, Check, Clock3, Fingerprint, ShieldCheck, Zap } from "lucide-react";
import { RunInspector } from "../components/RunInspector";
import { fmt, humanApproved, type OnCallRun } from "../data/oncall";
import record from "./gb10-record.display.json";

// Archived GB10 run; the display copy omits the local endpoint in model/audit text. Original evidence stays linked.
const run = record as OnCallRun;
export default function RunEvidence() {
  const [section, setSection] = useState("incident");
  const hidden = run.verification?.hidden ?? [];
  return <div className="ed-evidence">
    <section className="ed-panel ed-evidence-summary">
      <div className="ed-panel-heading"><h2>From incident to reusable skill</h2><span className="ed-tag">Recorded GB10 run · Oct 25, 2026</span></div>
      <div className="ed-evidence-intro"><span className="ed-evidence-check"><Check size={23} /></span><div><h3>{run.incident?.title ?? "OnCall investigation"}</h3><p>A real local-model run, independent checks, host approval, and deterministic reuse. Explore the source record below.</p></div></div>
      <div className="ed-evidence-metrics">
        <button onClick={() => setSection("verification")}><ShieldCheck size={18} /><strong>{hidden.filter((t) => t.pass === true).length}<span> / {hidden.length}</span></strong><span>Hidden checks passed</span><small>Independent validation</small></button>
        <button onClick={() => setSection("reuse")}><Zap size={18} /><strong>{fmt(run.reuse?.model_calls)}</strong><span>Model calls on reuse</span><small>INC-2 recorded trial</small></button>
        <button onClick={() => setSection("reuse")}><Clock3 size={18} /><strong>{fmt(run.reuse?.latency_ms)}<span> ms</span></strong><span>Reuse decision + run</span><small>One trial · subprocess runner</small></button>
        <button onClick={() => setSection("refusal")}><Fingerprint size={18} /><strong className="ed-evidence-word">Refused</strong><span>Incompatible lookalike</span><small>INC-3 fingerprint mismatch</small></button>
      </div>
      <div className="ed-evidence-context"><span><ShieldCheck size={14} />{humanApproved(run) ? "Approval recorded at the host CLI" : "No human approval recorded"}</span><span>The approver name is not identity-verified. Reuse proposed a change; it did not apply it.</span></div>
    </section>
    <div className="ed-evidence-heading"><h2>Inspect the work</h2><a href="https://github.com/dude297/skillforge_main/blob/main/docs/evidence/gb10/reuse-oncall-run.json" target="_blank" rel="noreferrer">Source record<ArrowUpRight size={13} /></a></div>
    <RunInspector key={section} run={run} initial={section} />
    <p className="ed-evidence-footnote">This is historical evidence, not a connection to the current host. Generation is not consistently reliable; rejected candidates and measurement limits are documented in the repository.</p>
  </div>;
}
