import { useEffect, useRef, useState } from "react";
import { FileUp, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { HistoryRun } from "../../data/registry";
import type { Source } from "../../data/types";
import { REPLAY_STEPS } from "../../data/synthetic";
import { Timeline } from "../Timeline";
import { SourceBadge } from "../../components/SourceBadge";
import { parseAudit } from "../../data/auditReplay";
import type { Step } from "../../data/types";

const OUTCOME: Record<HistoryRun["outcome"], { text: string; cls: string }> = {
  verified: { text: "Verified", cls: "text-verified" },
  needs_review: { text: "Needs review", cls: "text-fail" },
  rejected: { text: "Rejected", cls: "text-text-3" },
  escalated: { text: "Escalated", cls: "text-warn" },
  open: { text: "In progress", cls: "text-signal" },
  aborted: { text: "Aborted", cls: "text-text-3" },
  no_change: { text: "Closed, nothing changed", cls: "text-text-2" },
  partial: { text: "Partly done, needs a person", cls: "text-warn" },
  unverified: { text: "Applied, not fully verified", cls: "text-warn" },
};
const PATH = { agent: "Agent with model", skill: "Learned skill", escalated: "Escalated, no model" } as const;
const TICK_MS = 700;

/** Past runs plus a step-by-step replay with playback controls. */
/** runs: the table rows. loadRun: in Live mode, fetch a run's real audit events for the replay. */
export function History({ runs, source, loadRun, initial }: { runs: HistoryRun[]; source: Source; loadRun?: (id: number) => Promise<{ steps: Step[]; title: string } | string>;
  /** a recorded run handed over by another view (the world page): shown first, still labelled Recorded */
  initial?: { steps: Step[]; title: string } | null }) {
  // default: the synthetic canonical run (preview) or nothing (live); replaced by a REAL run when one is loaded
  const [replay, setReplay] = useState<{ steps: Step[]; title: string; source: Source }>(
    initial ? { ...initial, source } : source === "synthetic" ? { steps: REPLAY_STEPS, title: "Totals check, batch A", source: "synthetic" } : { steps: [], title: "choose a run", source });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const wanted = useRef<number | null>(null);
  const STEPS = replay.steps;
  const [pos, setPos] = useState(replay.steps.length);
  const [playing, setPlaying] = useState(false);

  // derived, not stored: playback simply stops being "running" at the end (no setState in an effect or updater)
  const running = playing && pos < STEPS.length;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setPos((p) => Math.min(p + 1, STEPS.length)), TICK_MS);
    return () => window.clearInterval(id);
  }, [running, STEPS.length]);

  const toggle = () => {
    if (!running && pos >= STEPS.length) setPos(0);
    setPlaying(!running);
  };

  return (
    <div className="grid min-h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section aria-labelledby="hist-h" className="min-w-0 border-b border-line p-6 xl:border-r xl:border-b-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h1 id="hist-h" className="text-h3 font-semibold tracking-tight">Execution history</h1><SourceBadge source={source} /></div>
        {!runs.length ? <p className="text-text-3">No runs recorded yet.</p> : null}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Past runs table">
          <table className="w-full text-left">
            <caption className="sr-only">Past runs, newest first</caption>
            <thead className="text-meta text-text-3">
              <tr>{["Run", "Handled by", "Outcome", "Model calls", "Time"].map((h) => <th key={h} scope="col" className="px-2 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-2 py-2.5 [overflow-wrap:anywhere]">
                    {loadRun ? (
                      <button type="button" className="block text-left font-medium text-text hover:text-signal hover:underline" onClick={async () => {
                        wanted.current = r.id;
                        const res = await loadRun(r.id);
                        if (wanted.current !== r.id) return; // a later click wins
                        if (typeof res === "string") return setLoadErr(`run #${r.id} could not be loaded: ${res}`);
                        setReplay({ ...res, source }); setPos(0); setPlaying(true); setLoadErr(null);
                      }}>{r.title}<span className="sr-only">: replay this run</span></button>
                    ) : <span className="block font-medium">{r.title}</span>}
                    <span className="tnum text-meta text-text-3">#{r.id} at {r.when}{r.deterministic ? ", deterministic, no model" : r.mock ? ", mock agent" : ""}</span>
                  </td>
                  <td className="px-2 py-2.5 text-text-2">{r.mock && r.path === "agent" ? "Mock agent, no model" : PATH[r.path]}</td>
                  <td className={`px-2 py-2.5 ${OUTCOME[r.outcome].cls}`}>{OUTCOME[r.outcome].text}</td>
                  <td className="tnum px-2 py-2.5 text-text-2">{r.modelCalls ?? "not measured"}</td>
                  <td className="tnum px-2 py-2.5 text-text-2">{r.seconds == null ? "not measured" : `${r.seconds} s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="replay-h" className="flex min-w-0 flex-col">
        <div className="space-y-3 border-b border-line p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="replay-h" className="font-semibold">Replay: {replay.title}</h2>
            <SourceBadge source={replay.source} />
          </div>
          <label className="btn btn-quiet h-8 cursor-pointer px-2.5 text-meta focus-within:outline-2 focus-within:outline-signal">
            <FileUp aria-hidden size={14} /> Load an audit export
            <input type="file" accept="application/json,.json" className="sr-only" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const steps = parseAudit(await f.text());
                setReplay({ steps, title: f.name, source: "recorded" }); setPos(0); setPlaying(false); setLoadErr(null);
              } catch (x) { setLoadErr(x instanceof Error ? x.message : String(x)); }
            }} />
          </label>
          {loadErr ? <p role="alert" className="text-meta text-fail">{loadErr.startsWith("run #") ? loadErr : `That file can't be replayed: ${loadErr}`}</p> : null}
          {replay.source !== "synthetic" && replay.steps.length ? <p className="text-meta text-text-3">Real audit events{replay.source === "recorded" ? <> from <code className="font-mono">python3 -m app audit</code></> : " from this system"}; timing between steps is not reproduced.</p> : null}
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-quiet size-9 justify-center px-0" onClick={() => { setPlaying(false); setPos((p) => Math.max(0, p - 1)); }} aria-label="Previous step"><SkipBack aria-hidden size={16} /></button>
            <button type="button" className="btn btn-primary h-9 px-3" onClick={toggle}>
              {running ? <Pause aria-hidden size={16} /> : <Play aria-hidden size={16} />}{running ? "Pause" : pos >= STEPS.length ? "Replay" : "Play"}
            </button>
            <button type="button" className="btn btn-quiet size-9 justify-center px-0" onClick={() => { setPlaying(false); setPos((p) => Math.min(STEPS.length, p + 1)); }} aria-label="Next step"><SkipForward aria-hidden size={16} /></button>
            <label className="ml-2 flex flex-1 items-center gap-3 text-meta text-text-3">
              <span className="sr-only">Replay position</span>
              <input type="range" min={0} max={STEPS.length} value={pos} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }}
                className="w-full accent-[var(--color-signal)]" aria-valuetext={`step ${pos} of ${STEPS.length}`} />
              <span className="tnum shrink-0">{pos} of {STEPS.length}</span>
            </label>
          </div>
        </div>
        <Timeline steps={STEPS.slice(0, pos)} empty={<p>Press play to replay this run step by step.</p>} />
      </section>
    </div>
  );
}
