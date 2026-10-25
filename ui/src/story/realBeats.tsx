// Presenter beats backed by THIS system's records (read-only operator API). Used only when the API answers and a
// learn -> reuse pair exists; otherwise the presenter keeps its labelled illustrations. Mock-agent runs say so.
import { useEffect, useState } from "react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { live, type LiveEvent, type LiveSkill, type LiveTask } from "../data/live";
import { MetricCompare } from "../console/MetricCompare";

export interface RealRun { agent: LiveTask; reuse: LiveTask; skill: LiveSkill; agentEvents: LiveEvent[]; promotedBy: string | null; mock: boolean }

export function useRealRun(): RealRun | null {
  const [run, setRun] = useState<RealRun | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!(await live.health()).ok) return;
      const [tasks, skills, events] = await Promise.all([live.tasks(), live.skills(), live.events(0)]);
      if (!tasks.ok || !skills.ok) return;
      const reuse = tasks.data.tasks.find((t) => t.status === "closed" && t.success && t.skills_used.length);
      const skill = reuse && skills.data.skills.find((s) => reuse.skills_used.includes(`${s.name}@v${s.version}`));
      const agent = skill && tasks.data.tasks.find((t) => t.id === skill.source_task);
      if (!reuse || !skill || !agent) return;
      const detail = await live.task(agent.id);
      if (!alive || !detail.ok) return;
      const promo = events.ok ? events.data.events.find((e) => e.event === "skill_approved" && e.payload.name === skill.name && Number(e.payload.version) === skill.version) : undefined;
      setRun({ agent, reuse, skill, agentEvents: detail.data.events, promotedBy: promo ? promo.actor.replace(/^human:/, "") : skill.decided_by,
        mock: agent.mode === "mock" || reuse.mode === "mock" });
    })();
    return () => { alive = false; };
  }, []);
  return run;
}

export const provenance = (r: RealRun) => (r.mock ? "This system, mock agent" : "Measured on this system");

const fmt = (v: unknown) => (typeof v === "number" ? String(Number(v.toFixed(6))) : String(v));

export function RealApproval({ r }: { r: RealRun }) {
  const approvals = r.agentEvents.filter((e) => e.event === "approval_approved");
  const changes = r.agentEvents.filter((e) => e.event === "execute_action");
  const verified = r.agentEvents.filter((e) => e.event === "verify_action");
  const passed = verified.filter((e) => e.payload.passed).length;
  const refused = r.agentEvents.some((e) => e.event === "execute_refused");
  return (
    <div className="w-full max-w-md space-y-3">
      <div className="rounded-[var(--radius-panel)] border border-warn/60 bg-surface p-4">
        <p className="font-semibold">{r.agent.label}</p>
        <ul className="mt-2 space-y-1 tnum text-text-2">
          {changes.slice(0, 3).map((e) => (
            <li key={e.id}>{Object.entries((e.payload.changed ?? {}) as Record<string, [unknown, unknown]>).map(([k, [b, a]]) =>
              <span key={k}>{k} <span className="line-through">{fmt(b)}</span> to <span className="font-semibold text-text">{fmt(a)}</span></span>)}</li>
          ))}
        </ul>
        {refused ? <p className="mt-2 text-meta text-text-3">Its attempt to apply a change before approval was refused.</p> : null}
        <p className="mt-3 text-meta text-warn">{approvals.length} change{approvals.length === 1 ? "" : "s"} approved on the host by {[...new Set(approvals.map((e) => e.actor.replace(/^human:/, "")))].join(", ") || "nobody"}</p>
      </div>
      <div className="rounded-[var(--radius-panel)] border border-verified/60 bg-surface p-4">
        <p className="flex items-center gap-2 font-semibold text-verified"><ShieldCheck aria-hidden size={16} />Verified: {passed} of {verified.length}</p>
        <p className="mt-1 text-meta text-text-2">Each applied change checked against the database by the verifier, not the agent.</p>
      </div>
    </div>
  );
}

export function RealSkill({ r }: { r: RealRun }) {
  const s = r.skill;
  const gate = (label: string, ok: boolean | null) => (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-meta text-text-3">{label}</p>
      <p className={`font-semibold ${ok == null ? "text-text-3" : ok ? "text-verified" : "text-fail"}`}>{ok == null ? "Not run" : ok ? "Passed" : "Failed"}</p>
    </div>
  );
  return (
    <div className="w-full max-w-md space-y-3">
      <div className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${s.status === "approved" ? "border-verified/60" : "border-line"}`}>
        <p className="text-meta text-text-3">Learned from task {r.agent.id}{r.mock ? " (mock-authored fixture skill)" : ""}</p>
        <p className="mt-1 text-lead font-semibold">{s.name} <span className="font-normal text-text-3">v{s.version}</span></p>
        <p className="mt-2 flex items-center gap-1.5 font-mono text-meta text-text-2"><Fingerprint aria-hidden size={13} />locked version {s.sha256}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {gate("Its own tests", s.validation.own_tests_ok)}
        {gate("Replay", s.validation.replay_ok)}
        {gate("Hidden tests", s.hidden_ok)}
      </div>
      <p className="text-meta text-warn">{s.status === "tested" ? "Waiting for a person to promote it"
        : s.status === "approved" ? `Promoted by ${r.promotedBy ?? "a person"} on the host${s.active ? "" : "; a newer version is active now"}`
        : `Promoted by ${r.promotedBy ?? "a person"}, now ${s.status.replaceAll("_", " ")}`}</p>
    </div>
  );
}

export function RealCompare({ r }: { r: RealRun }) {
  return (
    <div className="w-full max-w-lg">
      <MetricCompare compare={{
        source: "live", secondsLabel: "Task duration, including time waiting for a person",
        label: r.mock
          ? `Tasks #${r.agent.id} and #${r.reuse.id} on this system. Mock agent: no model was involved, so model calls were not measured and the durations measure plumbing and approval waits only.`
          : `Tasks #${r.agent.id} and #${r.reuse.id}, measured on this system.`,
        rows: [
          { mode: "A", title: "Agent", model_calls: r.agent.model_calls, seconds: r.agent.latency_s, tool_calls: r.agent.tool_calls },
          { mode: "C", title: "Learned skill", model_calls: r.reuse.model_calls, seconds: r.reuse.latency_s, tool_calls: r.reuse.tool_calls },
        ],
      }} />
      <p className="tnum mt-3 text-meta text-text-3">Tool calls: {r.agent.tool_calls ?? "not measured"} with the agent, {r.reuse.tool_calls ?? "not measured"} with the skill.</p>
    </div>
  );
}
