// Guided demo (#/demo): six scenes over ONE OnCall run (skillforge.oncall_run/1), driven through the same World scene
// the office uses. Autoplay never walks past the approval desk unless approval.state is "approved"
// (a scripted approval in a recording is labelled as not a person's decision). The 90-second
// pitch (illustrations) stays at #/demo/pitch. Keyboard: left/right step, space plays or pauses.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Compass, Pause, Play, SkipForward, X } from "lucide-react";
import { useOnCall } from "../data/useOnCall";
import { approved, diagnosisText, humanApproved, fmt, modelWrote, runMode, NM, type OnCallRun } from "../data/oncall";
import { ModeBanner, modeSentence } from "../components/ModeBanner";
import { RunInspector } from "../components/RunInspector";
import { CopyCommand } from "../components/CopyCommand";
import { Scene } from "../world/Scene";
import { DEPTS, fromOnCall, sceneState, type Dept, type VizEvent } from "../world/events";
import { STATES } from "../world/sprites";
import { BootstrapLite } from "../world/BootstrapLite";
import { THEMES } from "../world/theme";
import { useT } from "../lib/motion";
import "../world/world.css";

const SCENES = [
  { title: "Company onboarding", body: "SkillForge starts by reading the company's workspace, read-only: which tools exist, what the agent may do, and what only a person may decide. This is the real onboarding view; nothing on it connects, grants or writes." },
  { title: "Enter the living company", body: "This is the company SkillForge just read. Ember is the agent. Incidents arrive at intake, Ember works in the local AI room, a person decides at the review desk, the independent check tests every change, and approved skills live in the library. Click a room to see what happened there." },
  { title: "An incident arrives", body: "The on-call evidence lands at intake: logs, metrics, config and the last deploy, each with the file it came from. Ember takes it to the local AI room." },
  { title: "The fix becomes a tested skill", body: "A diagnosis skill is written, then checked by regression tests on INC-1 and by hidden tests it never saw. It can't run until a person approves it on the host." },
  { title: "The next one takes the short path", body: "A compatible incident goes straight from intake to the library: the approved skill runs as fixed code and the AI room is skipped. An incompatible one is refused, not guessed." },
  { title: "Technical proof", body: "Every claim on the previous screens, as recorded: provenance, verifier results, skill version and hash, who approved and when, model requests, latency, telemetry and the audit trail." },
] as const;
const PROOF_FOR: Record<Dept, string> = { intake: "incident", server: "synthesis", gate: "verification", review: "approval", library: "reuse" };
const TICK_MS = 1500, DWELL_MS = 2600;

export function GuidedDemo() {
  const load = useOnCall();
  const run = load.state === "ok" ? load.run : null;
  const origin = load.state === "ok" ? load.origin : null;
  const groups = useMemo(() => (run ? fromOnCall(run) : { incident: [], synthesis: [], reuse: [] }), [run]);
  const perScene = useMemo<VizEvent[][]>(() => [[], [], groups.incident, groups.synthesis, groups.reuse, []], [groups]);
  const [i, setI] = useState(0);
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [open, setOpen] = useState<Dept | null>(null);
  const [proof, setProof] = useState("incident");
  const tr = useT("panel");
  const n = perScene[i].length;
  const isApproved = approved(run);

  const go = useCallback((to: number) => {
    const j = Math.max(0, Math.min(SCENES.length - 1, to));
    setI(j); setK(perScene[j].length); setStopped(false); setOpen(null);
  }, [perScene]);
  const togglePlay = useCallback(() => {
    if (playing) return setPlaying(false);
    setStopped(false);
    if (k >= n && i < SCENES.length - 1 && !(i === 3 && !isApproved)) { setI(i + 1); setK(0); }
    setPlaying(true);
  }, [playing, k, n, i, isApproved]);

  // autoplay: reveal the scene's events one by one, dwell, then move on; stop at the approval desk unless approved
  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      if (k < n) return setK(k + 1);
      if (i === 3 && !isApproved) { setPlaying(false); setStopped(true); return; }
      if (i === SCENES.length - 1) return setPlaying(false);
      setI(i + 1); setK(0); setOpen(null);
    }, k < n ? TICK_MS : DWELL_MS);
    return () => window.clearTimeout(id);
  }, [playing, i, k, n, isApproved]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, button, a, [contenteditable], [role=button]")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); go(i + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); go(i - 1); }
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [go, i, togglePlay]);

  const shown = useMemo(() => [...perScene.slice(0, i).flat(), ...perScene[i].slice(0, k)], [perScene, i, k]);
  const state = useMemo(() => sceneState(shown), [shown]);
  const mode = runMode(run, i === 4 ? "reuse" : "run");
  const sentence = i < 2 && run
    ? `This scene shows the synthetic workspace${i === 0 ? " read from this host's operator API" : ""}; no model is involved here. The OnCall run that follows: ${modeSentence(mode, run, origin)}`
    : modeSentence(mode, run, origin, load.state === "missing" ? load.detail : undefined);
  const wide = i === 0 || i === 5;
  const scene = SCENES[i];

  return (
    <main id="main" tabIndex={-1} className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <ModeBanner mode={mode} sentence={sentence} />
      <div className={`mx-auto grid w-full max-w-[88rem] flex-1 grid-cols-[minmax(0,1fr)] gap-8 px-5 py-8 lg:px-10 ${wide ? "" : "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start"}`}>
        {wide ? null : (
          <div className="world world-daylight !min-h-0 lg:sticky lg:top-20">
            <div className="world-scene-frame relative h-[min(60dvh,34rem)] min-h-72 overflow-hidden">
              <Scene state={state} theme="daylight" focus={null} onOpen={setOpen} open={open}
                label={`OnCall run, scene ${i + 1} of ${SCENES.length}${state.current ? `: ${state.current.title}` : ""}`} />
              <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
                <span className="world-tag world-tag-recorded">{run ? "OnCall run" : "No run loaded"}</span>
                <span className="world-chip" data-testid="ember-state">Ember: {STATES[state.mascot].label.toLowerCase()}{state.current ? `, ${DEPTS[state.current.dept].name.toLowerCase()}` : ""}</span>
              </div>
              {open ? <RoomDetail dept={open} events={shown} onClose={() => setOpen(null)} onProof={() => { setProof(PROOF_FOR[open]); go(5); }} /> : null}
              <p className="world-chip absolute right-3 bottom-3">Blinking rack lights are decorative. Everything else follows the run.</p>
            </div>
            <p className="mt-3 min-h-12 text-meta text-text-2 [overflow-wrap:anywhere]" aria-live="polite">
              {state.current ? <><span className="font-semibold text-text">{state.current.title}.</span> {state.current.detail}</> : "Nothing has happened yet."}
            </p>
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tr}
            aria-labelledby="scene-h" className="min-w-0 space-y-5">
            <p className="tnum text-meta text-text-3">Scene {i + 1} of {SCENES.length}</p>
            <h1 id="scene-h" className="text-h2 leading-[1.08] font-semibold tracking-[-0.025em] text-balance">{scene.title}</h1>
            <p className="max-w-[40rem] text-lead leading-relaxed text-text-2">{scene.body}</p>
            {i === 0 ? (
              <div className="world world-daylight !min-h-0 max-h-[68dvh] overflow-auto rounded-[var(--radius-stage)] border border-line" style={{ background: THEMES.daylight.bg }} data-testid="onboarding">
                <BootstrapLite theme="daylight" desktop />
              </div>
            ) : null}
            {i >= 2 && !run ? <NoRun detail={load.state === "missing" ? load.detail : "loading…"} /> : null}
            {i === 2 && run ? <Incident run={run} /> : null}
            {i === 3 && run ? <Synthesis run={run} stopped={stopped} /> : null}
            {i === 4 && run ? <Reuse run={run} /> : null}
            {i === 5 && run ? <RunInspector key={proof} run={run} initial={proof} /> : null}
            {i === 5 ? (
              <div className="flex flex-wrap gap-3">
                <a href="#/world" className="btn btn-primary">Explore the office</a>
                <a href="#/console/investigations/incident" className="btn btn-quiet">Open in the console</a>
              </div>
            ) : null}
          </motion.section>
        </AnimatePresence>
      </div>

      <p className="sr-only" aria-live="polite">{`Scene ${i + 1} of ${SCENES.length}: ${scene.title}`}</p>
      <div className="sticky bottom-0 z-20 border-t border-line bg-canvas">
        <div className="mx-auto flex max-w-[88rem] flex-wrap items-center gap-3 px-5 py-3 lg:px-10">
          <button type="button" className="btn btn-quiet size-10 justify-center px-0" onClick={() => { setPlaying(false); go(i - 1); }} disabled={i === 0} aria-label="Back"><ChevronLeft aria-hidden size={18} /></button>
          <button type="button" className="btn btn-primary h-10 px-4" onClick={togglePlay} aria-pressed={playing}>
            {playing ? <Pause aria-hidden size={16} /> : <Play aria-hidden size={16} />}{playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="btn btn-quiet size-10 justify-center px-0" onClick={() => { setPlaying(false); go(i + 1); }} disabled={i === SCENES.length - 1} aria-label="Next"><ChevronRight aria-hidden size={18} /></button>
          <button type="button" className="btn btn-quiet h-10 px-3" onClick={() => { setPlaying(false); go(SCENES.length - 1); }}><SkipForward aria-hidden size={16} /><span className="sr-only sm:not-sr-only">Skip to proof</span></button>
          <ol className="order-last flex w-full gap-1.5 sm:order-none sm:w-auto sm:flex-1" aria-label="Scenes">
            {SCENES.map((s, j) => (
              <li key={s.title} className="flex-1">
                <button type="button" onClick={() => { setPlaying(false); go(j); }} aria-current={j === i ? "step" : undefined} aria-label={`Scene ${j + 1}: ${s.title}`} className="group grid h-6 w-full place-items-center">
                  <span className={`block h-1.5 w-full rounded-full transition-colors duration-150 ${j <= i ? "bg-text-2" : "bg-surface-2 group-hover:bg-line-strong"}`} />
                </button>
              </li>
            ))}
          </ol>
          <a href="#/world" className="btn btn-quiet h-10 px-3"><Compass aria-hidden size={16} /><span className="sr-only sm:not-sr-only">Explore</span></a>
          <a href="?product=ops#/demo/pitch" className="hidden text-meta text-text-3 underline-offset-4 hover:text-text hover:underline xl:inline">Second domain: freight accruals</a>
        </div>
      </div>
    </main>
  );
}

function NoRun({ detail }: { detail: string }) {
  return (
    <div role="alert" className="space-y-2 rounded-[var(--radius-panel)] border border-line-strong bg-surface p-4">
      <p className="font-semibold">No OnCall run to show</p>
      <p className="text-meta text-text-2 [overflow-wrap:anywhere]">{detail}</p>
      <p className="text-meta text-text-3">Nothing is filled in. Serve the UI from the host (python -m app ui) or ship demo/oncall-run.recorded.json with the build.</p>
    </div>
  );
}

const Panel = ({ title, children, tone = "border-line" }: { title: string; children: React.ReactNode; tone?: string }) => (
  <section className={`space-y-3 rounded-[var(--radius-panel)] border bg-surface p-4 ${tone}`}><h2 className="font-semibold">{title}</h2>{children}</section>
);

function Incident({ run }: { run: OnCallRun }) {
  const inc = run.incident;
  return (
    <Panel title={`${inc?.id ?? "Incident"}: ${inc?.title ?? "untitled"}`}>
      <p className="text-text-2">{inc?.summary ?? NM} <span className="text-text-3">Service: {fmt(inc?.service)}</span></p>
      <ul className="space-y-3" aria-label="Evidence">
        {(inc?.evidence ?? []).map((e, j) => (
          <li key={j} className="space-y-1 border-t border-line pt-3">
            <p><span className="mr-2 rounded-[var(--radius-chip)] border border-line-strong px-1.5 text-meta text-text-2">{e.kind}</span><span className="font-medium">{e.name ?? "unnamed"}</span></p>
            {e.excerpt ? <pre className="overflow-x-auto rounded border border-line bg-canvas px-2 py-1.5 font-mono text-[0.8125rem] whitespace-pre-wrap text-text-2">{e.excerpt}</pre> : null}
            <p className="font-mono text-[0.75rem] text-text-3 [overflow-wrap:anywhere]">{e.source_path ?? "source path not recorded"}</p>
          </li>
        ))}
        {inc?.evidence?.length ? null : <li className="text-text-3">No evidence recorded.</li>}
      </ul>
    </Panel>
  );
}

function Synthesis({ run, stopped }: { run: OnCallRun; stopped: boolean }) {
  const s = run.synthesis, v = run.verification, a = run.approval;
  const byModel = modelWrote(run);
  const tests = [...(v?.hidden ?? []).map((t) => ({ ...t, k: "hidden" })), ...(v?.regression ?? []).map((t) => ({ ...t, k: "regression" }))];
  const st = a?.state ?? null;
  const human = humanApproved(run);
  return (
    <div className="space-y-4">
      <Panel title="Who wrote the code" tone={byModel ? "border-signal/50" : "border-warn/50"}>
        <p className={byModel ? "text-signal" : "text-warn"} data-testid="code-author">
          {byModel ? `The local model ${run.model?.id ?? "(id not recorded)"} wrote this code.` : "Recorded reference: this code was hand-written ahead of time. It is not model output."}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta">
          <dt className="text-text-3">Model</dt><dd>{run.model?.id ? `${run.model.id}${run.model.available === false ? " (requested; unavailable, no request completed)" : ""}` : (run.model?.available === false ? "none" : NM)}{run.model?.note ? <span className="text-text-3">: {run.model.note}</span> : null}</dd>
          <dt className="text-text-3">Model requests</dt><dd>{fmt(s?.model_calls)}</dd>
          <dt className="text-text-3">Latency</dt><dd>{fmt(s?.latency_ms, " ms")}</dd>
          <dt className="text-text-3">Skill</dt><dd className="[overflow-wrap:anywhere]">{fmt(s?.skill_name)} v{fmt(s?.skill_version)}, <span className="font-mono">sha256 {fmt(s?.skill_hash)}</span></dd>
        </dl>
        {s?.code ? <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[0.8125rem] leading-relaxed text-text-2">{s.code}</pre> : <p className="text-text-3">No code recorded.</p>}
      </Panel>
      <Panel title={`Verification: ${v?.passed === true ? "passed" : v?.passed === false ? "failed" : NM}`} tone={v?.passed === true ? "border-verified/50" : v?.passed === false ? "border-fail/50" : "border-line"}>
        <ul className="space-y-1 text-meta">
          {tests.map((t) => (
            <li key={`${t.k}-${t.name}`} className="flex justify-between gap-3"><span className="[overflow-wrap:anywhere]"><span className="text-text-3">{t.k}</span> {t.name}</span>
              <span className={t.pass === true ? "text-verified" : t.pass === false ? "text-fail" : "text-text-3"}>{t.pass === true ? "passed" : t.pass === false ? "failed" : NM}</span></li>
          ))}
          {tests.length ? null : <li className="text-text-3">No test results recorded.</li>}
        </ul>
      </Panel>
      <Panel title="Approval desk" tone={human ? "border-verified/50" : st === "rejected" ? "border-fail/50" : "border-warn/60"}>
        <p data-testid="approval-state" className={`text-lead font-semibold ${human ? "text-verified" : st === "rejected" ? "text-fail" : "text-warn"}`}>
          {st === "approved" ? `Approved by ${a?.by ?? "a person (name not recorded)"}` : st === "rejected" ? `Rejected by ${a?.by ?? "a person"}` : st === "pending" ? "Waiting for a person" : `State: ${fmt(st)}`}
        </p>
        {a?.at ? <p className="text-meta text-text-3">at {a.at}</p> : null}
        {st === "approved" && !human ? <p className="text-meta text-warn" data-testid="not-human">Not a person&apos;s decision: an agent or test typed this approval (its approver name says so) to show the full sequence.</p> : null}
        {a?.command ? <CopyCommand label="A person runs this on the host. This browser can't approve anything." cmd={a.command} /> : <p className="text-text-3">Approval command not recorded.</p>}
        {stopped ? <p role="status" className="text-meta text-warn" data-testid="autoplay-stopped">Autoplay stopped here: the skill is not approved. Press Next to see what reuse looks like in this recording.</p> : null}
      </Panel>
    </div>
  );
}

function Reuse({ run }: { run: OnCallRun }) {
  const s = run.synthesis, u = run.reuse, f = run.refusal;
  const rows: [string, string, string][] = [
    ["Model requests", fmt(s?.model_calls), fmt(u?.model_calls)],
    ["Latency", fmt(s?.latency_ms, " ms"), fmt(u?.latency_ms, " ms")],
    ["Route", "intake, AI room, check, review", u?.state === "done" ? "intake, library" : NM],
  ];
  return (
    <div className="space-y-4">
      {u?.state === "done" ? (
        <Panel title={`Compatible incident ${u.incident_id ?? ""}: handled by the skill`} tone="border-verified/50">
          <table className="w-full text-left text-meta" aria-label="First run and reuse, side by side">
            <thead><tr className="text-text-3"><th scope="col" className="py-1 pr-3 font-normal">Measured</th><th scope="col" className="py-1 pr-3 font-normal">First run (writing the skill)</th><th scope="col" className="py-1 font-normal">Reuse ({fmt(u.path)})</th></tr></thead>
            <tbody>
              {rows.map(([k, a, b]) => (
                <tr key={k} className="border-t border-line"><th scope="row" className="py-1.5 pr-3 font-normal text-text-3">{k}</th>
                  <td className={`${k === "Route" ? "" : "tnum"} py-1.5 pr-3 ${a === NM ? "text-text-3 italic" : ""}`}>{a}</td><td className={`${k === "Route" ? "" : "tnum"} py-1.5 font-semibold ${b === NM ? "text-text-3 italic font-normal" : "text-verified"}`}>{b}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-meta text-text-2">Diagnosis: {diagnosisText(u.diagnosis)}. Not a speed benchmark: the first run wrote and tested a skill, the reuse only ran it.</p>
        </Panel>
      ) : (
        <Panel title="Reuse did not run">
          <p className="text-text-2">State: {fmt(u?.state)}{u?.reason ? `. ${u.reason}` : ""}. {approved(run) ? "" : "The skill was never approved, so it cannot run."}</p>
        </Panel>
      )}
      <Panel title={`Incompatible incident ${f?.incident_id ?? ""}: ${f?.state === "refused" ? "refused" : fmt(f?.state)}`} tone="border-fail/50">
        <p className="text-text-2" data-testid="refusal-reason">{f?.reason ?? "No reason recorded."}</p>
        <p className="text-meta text-text-3">The skill does not guess outside its contract. A person or the agent takes it instead.</p>
      </Panel>
    </div>
  );
}

function RoomDetail({ dept, events, onClose, onProof }: { dept: Dept; events: VizEvent[]; onClose: () => void; onProof: () => void }) {
  const here = events.filter((e) => e.dept === dept).slice(-4).reverse();
  return (
    <div role="dialog" aria-labelledby="room-h" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className="world-pop absolute top-12 right-3 z-10 w-[min(22rem,calc(100%-1.5rem))] space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 id="room-h" className="font-semibold">{DEPTS[dept].name}</h2>
        <button type="button" onClick={onClose} className="world-icon-btn" aria-label="Close" autoFocus><X aria-hidden size={16} /></button>
      </div>
      <p className="text-meta">{DEPTS[dept].role}</p>
      {here.length ? (
        <ul className="space-y-2 text-meta">{here.map((e) => <li key={e.id} className="world-pop-item"><p className="font-medium">{e.title}</p><p className="world-muted [overflow-wrap:anywhere]">{e.detail}</p></li>)}</ul>
      ) : <p className="text-meta world-muted">Nothing has happened here yet in this run.</p>}
      <button type="button" className="world-btn h-9 w-full justify-center text-meta" onClick={onProof}>Show the proof for this room</button>
    </div>
  );
}
