import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";
import { parseBenchResult, type Recorded } from "../../data/recorded";
import { live } from "../../data/live";
import type { Source } from "../../data/types";
import { MetricCompare } from "../MetricCompare";
import { SourceBadge } from "../../components/SourceBadge";

/** Recorded benchmark: a real result.json, shown exactly as measured. In Live mode, the newest one on the host. */
export function Benchmarks({ recorded, onLoad, source }: { recorded: Recorded | null; onLoad: (r: Recorded | null) => void; source: Source }) {
  const [err, setErr] = useState<string | null>(null);
  const [hostFile, setHostFile] = useState<string | null>(null);
  useEffect(() => {
    if (source !== "live") return;
    let alive = true;
    live.benchLatest().then((r) => {
      if (!alive) return;
      if (r.ok) {
        try { onLoad(parseBenchResult(r.data.file, JSON.stringify(r.data.result))); setHostFile(r.data.file); setErr(null); }
        catch (x) { onLoad(null); setErr(x instanceof Error ? x.message : String(x)); }
      } else { onLoad(null); setHostFile(null); setErr(r.detail); }
    });
    return () => { alive = false; };
  }, [source, onLoad]);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 font-semibold tracking-tight">Benchmarks</h1>
        {recorded ? <SourceBadge source="recorded" /> : null}
      </div>
      <p className="max-w-prose text-text-2">
        {source === "live" ? <>The newest <code className="font-mono text-text">result.json</code> on this host{hostFile ? <>: <code className="font-mono text-text">{hostFile}</code></> : null}. </> : null}
        Results are written by <code className="font-mono text-text">python3 -m app bench --out &lt;dir&gt;</code>. Numbers are shown exactly as measured; anything not measured says so.
      </p>
      <label className="btn btn-quiet cursor-pointer focus-within:outline-2 focus-within:outline-signal">
        <FileUp aria-hidden size={16} /> Load result.json
        <input type="file" accept="application/json,.json" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { onLoad(parseBenchResult(f.name, await f.text())); setErr(null); setHostFile(null); }
          catch (x) { onLoad(null); setErr(x instanceof Error ? x.message : String(x)); } // never leave the previous file on screen under an error
        }} />
      </label>
      {err ? <p role="alert" className="text-fail">{source === "live" && !hostFile ? "No benchmark from the host" : "That file can't be used"}: {err}</p> : null}
      {!recorded && !err ? <p className="text-text-3">No measured run loaded. Nothing is shown until one is.</p> : null}
      {recorded && !recorded.realModel ? (
        <p role="note" className="rounded-lg border border-warn/45 px-4 py-3 text-warn">This file is a MOCK run: it measures plumbing only. No model was involved.</p>
      ) : null}
      {recorded?.compare ? <div className="panel p-5"><MetricCompare compare={recorded.compare} /></div> : null}
      {recorded ? (
        <div className="panel overflow-x-auto" tabIndex={0} role="region" aria-label="Benchmark rows">
          <table className="w-full text-left text-meta">
            <caption className="px-3 pt-3 text-left text-text-2">{recorded.fileName}: {recorded.agent}, {recorded.trials} trial(s) per case; break-even (model calls): {recorded.breakevenC ?? "not available"}</caption>
            <thead className="text-text-3"><tr>{["Case", "Mode", "Trials", "Correct", "Decision", "Median s", "Model calls", "Tool calls"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="[&_td:nth-child(n+3)]:tnum">
              {recorded.rows.map((r) => (
                <tr key={r.case + r.mode} className="border-t border-line">
                  <td className="px-3 py-2">{r.case}</td><td className="px-3 py-2">{r.mode === "A" ? "A, agent only" : r.mode === "B" ? "B, agent may use skill" : "C, skill first"}</td><td className="px-3 py-2">{r.n}</td>
                  <td className="px-3 py-2">{r.correct}</td><td className="px-3 py-2">{r.decision}</td>
                  <td className="px-3 py-2">{r.median_s ?? "not measured"}</td><td className="px-3 py-2">{r.model_calls ?? "not measured"}</td>
                  <td className="px-3 py-2">{r.tool_calls ?? "not measured"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
