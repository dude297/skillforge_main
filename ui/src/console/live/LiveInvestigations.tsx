import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, CircleCheck, CircleX, Cpu, Hourglass, ShieldCheck, Workflow } from "lucide-react";
import type { ProductConfig } from "../../config/product";
import type { Step } from "../../data/types";
import { toStep } from "../../data/events";
import { live, approveCommand, rejectCommand, type LiveAction, type LiveSkill, type LiveTask, type LiveTaskDetail } from "../../data/live";
import { provenance } from "../../data/provenance";
import { useLiveTask, type LiveData } from "../../data/useLive";
import { Timeline } from "../Timeline";
import { ApprovalPanel } from "../ApprovalPanel";
import { SkillPanel } from "../SkillPanel";
import { MetricCompare } from "../MetricCompare";
import { Banner } from "../../components/Banner";
import { CopyCommand } from "../../components/CopyCommand";
import { rise, useT } from "../../lib/motion";

const fmtVal = (v: unknown) => (v == null ? "none" : typeof v === "number" ? String(Number(v.toFixed(6))) : typeof v === "string" ? v : JSON.stringify(v));

/** One honest sentence for where a task stands, derived only from backend state. */
export function taskState(t: LiveTask, pending: LiveAction[], actions: LiveAction[], skills: LiveSkill[]): { text: string; tone: string } {
  if (t.status === "aborted") return { text: "Aborted", tone: "text-text-3" };
  if (pending.length) return { text: "Waiting for you", tone: "text-warn" };
  if (actions.some((a) => a.state === "NEEDS_REVIEW") || (t.verifications_failed ?? 0) > 0) return { text: "Needs review", tone: "text-fail" };
  if (t.status !== "open" && (t.actions_executed ?? 0) === 0 && (t.invariant_violations ?? 0) > 0)  // e.g. the agent refused
    return { text: "Nothing changed, needs a person", tone: "text-warn" };
  if (t.status !== "open" && (t.actions_executed ?? 0) > 0 && (t.verifications_passed ?? 0) === t.actions_executed
      && (t.verifications_failed ?? 0) === 0 && (t.invariant_violations ?? 0) > 0)
    return { text: "Partly done, needs a person", tone: "text-warn" };
  if (t.status !== "open" && !actions.length && ((t.invariant_violations ?? 0) > 0
      || (t.actions_executed ?? 0) > (t.verifications_passed ?? 0) + (t.verifications_failed ?? 0)))
    return { text: "Applied, not fully verified", tone: "text-warn" };
  if (actions.some((a) => a.state === "VERIFYING"))  // normal for a moment while the agent runs; a problem only once it stopped
    return t.status === "open" ? { text: "Verifying", tone: "text-signal" } : { text: "Applied, not yet verified", tone: "text-warn" };
  if (t.status === "open") return { text: "Agent is working", tone: "text-signal" };
  if (skills.some((s) => s.source_task === t.id && s.status === "tested")) return { text: "Verified; a skill waits for promotion", tone: "text-warn" };
  if (t.success) return { text: t.skills_used.length ? "Verified, handled by a skill" : "Verified", tone: "text-verified" };
  return { text: (t.actions_executed ?? 0) === 0 ? "Closed, nothing changed" : "Closed", tone: "text-text-2" };
}

export function useSkillCode(name: string | undefined, version: number | undefined) {
  const [code, setCode] = useState<{ key: string; text: string | null; file: string | null }>({ key: "", text: null, file: null });
  const key = name ? `${name}@${version}` : "";
  useEffect(() => {
    if (!name || version == null) return;
    let alive = true;
    live.skill(name, version).then((r) => {
      if (!alive) return;
      const file = r.ok && r.data.files["scripts/helper.py"] != null ? "scripts/helper.py" : null;
      setCode({ key: `${name}@${version}`, text: r.ok ? (file ? r.data.files[file] : r.data.files_note ?? "no files") : `could not load: ${r.detail}`, file });
    });
    return () => { alive = false; };
  }, [name, version]);
  return code.key === key ? code : { key, text: null, file: null };
}

function LiveSkillCard({ skill }: { skill: LiveSkill }) {
  const code = useSkillCode(skill.name, skill.version);
  return (
    <SkillPanel skill={{
      name: skill.name, version: skill.version,
      status: skill.status === "approved" ? (skill.active ? "approved" : "approved_inactive") : skill.status === "tested" ? "awaiting_promotion"
        : skill.status === "failed_tests" ? "failed" : "not_in_use",
      sha256: skill.sha256, code: code.text ?? "loading…", codeFile: code.file ?? undefined,
      selfTests: skill.validation.own_tests_ok, hidden: skill.hidden_ok,
    }} />
  );
}

function ActionEvidence({ a }: { a: LiveAction }) {
  const last = a.verifications[a.verifications.length - 1];
  return (
    <li className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">Action #{a.id} on {a.record_id}</p>
        <p className={`text-meta font-medium ${a.state === "COMPLETED" ? "text-verified" : a.state === "NEEDS_REVIEW" ? "text-fail" : a.state === "WAITING_APPROVAL" ? "text-warn" : "text-text-2"}`}>
          {{ COMPLETED: "Verified", NEEDS_REVIEW: "Verification failed", WAITING_APPROVAL: "Waiting for approval", READY: "Approved, not applied yet",
            VERIFYING: "Applied, not verified", PENDING: "Proposed", CANCELLED: "Rejected", FAILED: "Failed" }[a.state]}
        </p>
      </div>
      <p className="tnum text-meta text-text-2">
        <span className="font-mono">{a.field}</span>: {a.execution
          ? Object.entries(a.execution.changed).map(([k, [b, af]]) => `${k} ${fmtVal(b)} → ${fmtVal(af)}`).join(", ")
          : `${fmtVal(a.current_value)} → ${fmtVal(a.value)} (proposed)`}
        {a.origin.startsWith("skill:") ? <span className="text-text-3">, proposed by {a.origin.split("#")[0].replace("skill:", "skill ")}</span> : null}
        {a.approval?.decided_by ? <span className="text-text-3">, {a.approval.status} by {a.approval.decided_by}</span> : null}
      </p>
      {last ? (
        <ul aria-label={`Verification checks for action ${a.id}`} className="space-y-1 text-meta">
          {last.checks.map((c) => (
            <li key={c.check} className="flex gap-2">
              {c.passed ? <ShieldCheck aria-hidden size={14} className="mt-0.5 shrink-0 text-verified" /> : <CircleX aria-hidden size={14} className="mt-0.5 shrink-0 text-fail" />}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-mono text-text-2">{c.check.replaceAll("_", " ")}</span>
                {"actual" in c ? <span className="text-text-3"> (found {fmtVal(c.actual)}, expected {fmtVal(c.expected)})</span> : null}
                <span className="sr-only">{c.passed ? ": passed" : ": failed"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ToolActivity({ calls }: { calls: LiveTaskDetail["tool_calls"] }) {
  if (!calls.length) return null;
  const by = new Map<string, { n: number; failed: number; ms: number }>();
  for (const c of calls) {
    const r = by.get(c.tool) ?? { n: 0, failed: 0, ms: 0 };
    by.set(c.tool, { n: r.n + 1, failed: r.failed + (c.ok ? 0 : 1), ms: r.ms + c.ms });
  }
  return (
    <details className="mx-5 mb-5 rounded-lg border border-line">
      <summary className="cursor-pointer px-4 py-2.5 text-meta text-text-2 hover:text-text">Every tool call the agent made ({calls.length}), timed by the host service</summary>
      <table className="w-full text-left text-meta">
        <thead className="text-text-3"><tr>{["Tool", "Calls", "Refused or failed", "Total time"].map((h) => <th key={h} scope="col" className="px-4 py-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody className="tnum">
          {[...by.entries()].map(([tool, r]) => (
            <tr key={tool} className="border-t border-line">
              <td className="px-4 py-1.5 font-mono text-text-2">{tool}</td><td className="px-4 py-1.5">{r.n}</td>
              <td className={`px-4 py-1.5 ${r.failed ? "text-warn" : "text-text-3"}`}>{r.failed}</td><td className="px-4 py-1.5 text-text-2">{Math.round(r.ms)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Note({ icon: Icon, tone, title, children }: { icon: typeof CircleCheck; tone: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className={`flex items-center gap-2 text-lead font-semibold ${tone}`}><Icon aria-hidden size={20} /> {title}</h2>
      <div className="space-y-2 text-text-2">{children}</div>
    </section>
  );
}

/** The inspector leads with what needs a person, then the evidence, then what was learned. */
function LiveInspector({ t, detail, pending, skills, tasks }: { t: LiveTask; detail: LiveTaskDetail | null; pending: LiveAction[]; skills: LiveSkill[]; tasks: LiveTask[] }) {
  const actions = detail?.actions ?? [];
  const learned = skills.filter((s) => s.source_task === t.id);
  const used = skills.find((s) => t.skills_used.includes(`${s.name}@v${s.version}`));
  const agentTask = used ? tasks.find((x) => x.id === used.source_task) : undefined;
  const review = actions.filter((a) => a.state === "NEEDS_REVIEW");
  const verifying = actions.filter((a) => a.state === "VERIFYING");
  const first = pending[0];
  // a real measurement only if a model drove the source task; the reuse may be the model or a deterministic skill
  const mock = agentTask?.mode !== "real" || !(t.mode === "real" || t.mode === "deterministic");
  return (
    <div className="space-y-8 p-5">
      {first ? (
        <div className="space-y-3">
          <ApprovalPanel source="live" by={t.mode === "deterministic" ? "skill" : "agent"} fix={{
            actionId: first.id, fingerprint: first.fingerprint, record: first.record_id, field: first.field ?? "?", from: fmtVal(first.current_value), to: fmtVal(first.value),
            reason: first.reason, evidence: first.evidence,
          }} />
          {pending.length > 1 ? (
            <>
              <p className="text-text-2">{pending.length} changes are waiting: {pending.map((a) => `#${a.id} ${a.record_id}`).join(", ")}.</p>
              <CopyCommand label="Approve all of them on the host:" cmd={approveCommand(pending.map((a) => a.id), undefined, pending.map((a) => a.fingerprint))} />
            </>
          ) : null}
          <CopyCommand label="Or reject:" cmd={rejectCommand(pending.map((a) => a.id), undefined, pending.map((a) => a.fingerprint))} />
          <p className="text-meta text-text-3">The console can't approve. It updates when the host records your decision.</p>
        </div>
      ) : review.length ? (
        <Note icon={CircleX} tone="text-fail" title="Needs review">
          <p>The change was applied, but the verifier found a different value afterwards. It is recorded and marked for a person; nothing is redone automatically.</p>
          <CopyCommand label="See the full trail on the host:" cmd="python3 -m app audit" />
        </Note>
      ) : verifying.length && t.status !== "open" ? (
        <Note icon={Hourglass} tone="text-warn" title="Applied, not yet verified">
          <p>If the agent stopped here (a crash or restart), verify without re-applying anything:</p>
          <CopyCommand cmd="python3 -m app recover" />
        </Note>
      ) : t.status === "open" ? (
        <Note icon={Workflow} tone="text-signal" title={t.mode === "deterministic" ? "An approved skill is running (no model, no agent)" : "The agent is working"}>
          <p>Each tool call it makes appears on the left as the host records it. Anything that changes data stops here for a person first.</p>
        </Note>
      ) : t.success ? (
        <Note icon={CircleCheck} tone="text-verified" title="Verified">
          <p>{t.actions_executed} change{t.actions_executed === 1 ? " was" : "s were"} applied once, after a person approved, and each was checked against the database by code the agent doesn't control.</p>
        </Note>
      ) : t.status !== "open" && (t.actions_executed ?? 0) > 0 && (t.verifications_passed ?? 0) === t.actions_executed
          && (t.invariant_violations ?? 0) > 0 ? (
        <Note icon={Hourglass} tone="text-warn" title="Partly done, needs a person">
          <p>{t.actions_executed} change{t.actions_executed === 1 ? " was" : "s were"} applied after approval and verified. {t.invariant_violations} record{t.invariant_violations === 1 ? " still breaks" : "s still break"} the business rule or can't be checked by it, and nothing was changed there: a person has to decide.</p>
          <CopyCommand label="See which records on the host:" cmd="python3 -m app audit" />
        </Note>
      ) : t.status !== "open" && (t.actions_executed ?? 0) === 0 && (t.invariant_violations ?? 0) > 0 ? (
        <Note icon={Hourglass} tone="text-warn" title="Nothing changed, needs a person">
          <p>No change was made. A record still breaks the business rule or can't be checked by it (for example an invoice in another currency), so a person has to decide.</p>
          <CopyCommand label="See what the agent reported on the host:" cmd="python3 -m app audit" />
        </Note>
      ) : t.status === "aborted" ? (
        <Note icon={Ban} tone="text-text" title="Aborted"><p>This task was closed without a result and doesn't count in any measurement.</p></Note>
      ) : null}

      {used && agentTask && t.success ? (
        <div className="panel p-5">
          <MetricCompare compare={{
            source: "live", secondsLabel: "Task duration, including time waiting for a person",
            label: mock
              ? `Recorded from this system's tasks #${agentTask.id} and #${t.id}. Mock agent: plumbing only, no model involved, so model calls were not measured and the durations are not model measurements.`
              : `Measured on this system: task #${agentTask.id} (agent with ${agentTask.model ?? "the local model"}) and task #${t.id} (skill ${used.name} v${used.version}).`,
            rows: [
              { mode: "A", title: "Agent", model_calls: agentTask.model_calls, seconds: agentTask.latency_s, tool_calls: agentTask.tool_calls },
              { mode: "C", title: "Learned skill", model_calls: t.model_calls, seconds: t.latency_s, tool_calls: t.tool_calls },
            ],
          }} />
          <p className="tnum mt-3 text-meta text-text-3">Tool calls: {agentTask.tool_calls ?? "not measured"} with the agent, {t.tool_calls ?? "not measured"} with the skill.</p>
        </div>
      ) : null}

      {actions.length ? (
        <section aria-labelledby="ev-h" className="space-y-3">
          <h2 id="ev-h" className="flex items-center gap-2 text-lead font-semibold"><ShieldCheck aria-hidden size={18} className="text-text-3" />What changed and how it was checked</h2>
          <ul className="space-y-3">{actions.map((a) => <ActionEvidence key={a.id} a={a} />)}</ul>
        </section>
      ) : detail && (t.actions_executed ?? 0) > 0 ? (
        <p className="text-meta text-text-3">
          {t.actions_executed} change(s) were applied and {t.verifications_passed ?? "an unknown number"} verified. Record-level detail was cleared when a later scenario was loaded; the audit trail on the left is the permanent record.
        </p>
      ) : null}

      {learned.map((s) => <LiveSkillCard key={`${s.name}${s.version}`} skill={s} />)}
    </div>
  );
}

/** Live: real tasks, real audit events, real approvals. Nothing on this screen is scripted by the UI. */
export function LiveInvestigations({ data, product }: { data: LiveData; product: ProductConfig }) {
  // ?task=<id> (e.g. from the world view) selects that task; the person's later clicks win
  const [picked, setPicked] = useState<number | null>(() => {
    const t = Number(new URLSearchParams(window.location.search).get("task"));
    return Number.isInteger(t) && t > 0 ? t : null;
  });
  const tr = useT("panel");
  const { tasks, approvals, skills, events } = data;
  const selected = tasks.find((t) => t.id === picked) ?? tasks.find((t) => t.status === "open") ?? tasks[0];
  const { detail, error } = useLiveTask(selected?.id ?? null, data.lastEventId);
  const pending = approvals.filter((a) => a.task_id === selected?.id);

  const steps: Step[] = detail?.events.map(toStep) ?? [];
  if (selected && detail) {
    for (const s of skills.filter((k) => k.source_task === selected.id)) {
      // promotion happens after the task closes: show the REAL promotion event from the global audit stream
      const ev = events.find((e) => e.event === "skill_approved" && e.payload.name === s.name && Number(e.payload.version) === s.version);
      if (ev) steps.push(toStep(ev));
      else if (s.status === "tested") steps.push({ id: `promote-${s.name}-${s.version}`, kind: "human", title: `Waiting for a person to promote ${s.name} v${s.version}`, state: "waiting" });
    }
    if (pending.length) steps.push({ id: "wait-approval", kind: "human", title: `Waiting for your approval of ${pending.map((a) => `#${a.id}`).join(", ")}`, state: "waiting" });
    else if (selected.status === "open") steps.push({ id: "open", kind: "tool", title: "Waiting for the agent's next call", state: "running" });
  }
  const st = selected ? taskState(selected, pending, detail?.actions ?? [], skills) : null;

  // While a task runs, keep its newest step in view (desktop: the timeline scrolls on its own). Only when the reader is
  // already at the bottom: scrolling back up to read something is never interrupted.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current && selected?.status === "open") el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [steps.length, selected?.status, reduce]);
  const banner = error && data.conn !== "lost" ? { tone: "warn" as const, text: `This task's detail could not be loaded: ${error}` } : null;
  const orphans = approvals.filter((a) => a.task_id == null); // e.g. proposals made outside any open task

  return (
    <div className="grid min-h-full grid-cols-1 xl:grid-cols-[15rem_minmax(0,1fr)_26rem]">
      <section aria-labelledby="run-h" className="order-1 flex min-w-0 flex-col border-b border-line xl:order-2 xl:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h1 id="run-h" tabIndex={-1} className="text-h3 font-semibold tracking-tight [overflow-wrap:anywhere]">{selected ? selected.label : `No ${product.terms.tasks.toLowerCase()} yet`}</h1>
            <p className={st?.tone ?? "text-text-2"} aria-live="polite">{st ? st.text : "Waiting for the first task on this system"}</p>
          </div>
          {selected ? (
            <p className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border px-2 py-0.5 text-meta font-medium ${selected.mode === "real" || selected.mode === "deterministic" ? "border-line-strong text-text-2" : "border-warn/45 text-warn"}`}
              title={provenance(selected.mode).title} data-testid="task-provenance">
              <Cpu aria-hidden size={13} />{provenance(selected.mode).label}{selected.mode === "real" && selected.model ? `: ${selected.model}` : ""}
            </p>
          ) : null}
        </div>
        <div className="space-y-3 px-5 pt-4">
          <Banner banner={banner} />
          {orphans.length ? (
            <section aria-labelledby="orphans-h" className="rounded-[var(--radius-panel)] border border-warn/45 p-4">
              <h2 id="orphans-h" className="font-semibold text-warn">{orphans.length} change{orphans.length === 1 ? "" : "s"} outside any task waiting for approval</h2>
              <ul className="mt-2 space-y-1 text-meta text-text-2">
                {orphans.map((a) => <li key={a.id} className="[overflow-wrap:anywhere]">#{a.id} {a.record_id}: {a.field} {fmtVal(a.current_value)} → {fmtVal(a.value)} ({a.reason})</li>)}
              </ul>
              <div className="mt-3"><CopyCommand label="Approve on the host after reviewing:" cmd={approveCommand(orphans.map((a) => a.id), undefined, orphans.map((a) => a.fingerprint))} /></div>
            </section>
          ) : null}
        </div>
        <div ref={scroller} tabIndex={0} role="region" aria-label="Task timeline"
          onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
          className="flex-1 xl:max-h-[calc(100dvh-13rem)] xl:overflow-y-auto">
          {detail?.events_truncated ? <p className="px-5 pt-3 text-meta text-warn">Showing the first 500 events of this task; the full trail is in <code className="font-mono">python3 -m app audit</code>.</p> : null}
          <Timeline steps={steps} empty={selected ? <p>{detail ? "No audit events were recorded for this task." : "Loading this task's events…"}</p> : (
            <>
              <p className="text-lead text-text">Nothing has run yet.</p>
              <p className="mt-1">Start a task on the host and every step appears here as it is recorded:</p>
              <code className="mt-2 block font-mono text-meta text-text-2">python3 scripts/rehearse.py --approve manual</code>
            </>
          )} />
        </div>
        {detail ? <ToolActivity calls={detail.tool_calls} /> : null}
      </section>

      <aside aria-label={`All ${product.terms.tasks.toLowerCase()}`} className="order-3 border-t border-line p-5 xl:order-1 xl:border-t-0 xl:border-r">
        <h2 className="font-semibold">All {product.terms.tasks.toLowerCase()}</h2>
        <ul className="mt-3 space-y-1">
          {tasks.map((t) => {
            const s = taskState(t, approvals.filter((a) => a.task_id === t.id), t.id === selected?.id ? detail?.actions ?? [] : [], skills);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => setPicked(t.id)} aria-current={t.id === selected?.id ? "true" : undefined}
                  className={`w-full rounded-lg px-3 py-2 text-left transition-colors duration-150 ${t.id === selected?.id ? "bg-surface-2" : "hover:bg-surface"}`}>
                  <span className={`block [overflow-wrap:anywhere] ${t.id === selected?.id ? "font-medium" : "text-text-2"}`}>{t.label}</span>
                  <span className="block text-meta text-text-3">Task {t.id}, {provenance(t.mode).short}</span>
                  <span className={`block text-meta ${s.tone}`}>{s.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!tasks.length ? <p className="mt-3 text-meta text-text-3">None recorded in this database.</p> : null}
      </aside>

      <aside aria-label="Inspector" className="order-2 min-w-0 xl:order-3 xl:border-l xl:border-line">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={selected?.id ?? "none"} {...rise} transition={tr}>
            {selected ? <LiveInspector t={selected} detail={detail} pending={pending} skills={skills} tasks={tasks} />
              : <p className="p-5 text-text-2">When the agent proposes a change, it appears here with its evidence and the host command to approve it.</p>}
          </motion.div>
        </AnimatePresence>
      </aside>
    </div>
  );
}
