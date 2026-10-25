// Master-detail proof of one OnCall run: left the steps/records, right everything recorded about the selected one.
// Shared by the guided demo (scene 6) and the console's Incident view. Null is "not measured", never 0.
import { useState } from "react";
import { CircleCheck, CircleDashed, CircleX, Hourglass } from "lucide-react";
import { proofSteps, type OnCallRun, type ProofStep } from "../data/oncall";

const GLYPH: Record<ProofStep["status"], { Icon: typeof CircleCheck; cls: string; word: string }> = {
  ok: { Icon: CircleCheck, cls: "text-verified", word: "on record" },
  sim: { Icon: CircleDashed, cls: "text-warn", word: "approved by an agent or test, not a person" },
  fail: { Icon: CircleX, cls: "text-fail", word: "failed or refused" },
  wait: { Icon: Hourglass, cls: "text-warn", word: "waiting for a person" },
  none: { Icon: CircleDashed, cls: "text-text-3", word: "not available" },
};

export function RunInspector({ run, initial = "incident" }: { run: OnCallRun; initial?: string }) {
  const steps = proofSteps(run);
  const [sel, setSel] = useState(initial);
  const cur = steps.find((s) => s.id === sel) ?? steps[0];
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface md:grid-cols-[16rem_minmax(0,1fr)]" data-testid="run-inspector">
      <nav aria-label="Run records" className="min-w-0 border-b border-line md:border-r md:border-b-0">
        <ul className="relative flex gap-1 overflow-x-auto p-2 md:flex-col">{/* relative: keeps the absolutely positioned sr-only labels inside the scroller */}
          {steps.map((s) => {
            const g = GLYPH[s.status];
            return (
              <li key={s.id} className="shrink-0">
                <button type="button" onClick={() => setSel(s.id)} aria-current={s.id === cur.id ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left whitespace-nowrap ${s.id === cur.id ? "bg-surface-2 text-text" : "text-text-2 hover:bg-canvas hover:text-text"}`}>
                  <g.Icon aria-hidden size={15} className={`shrink-0 ${g.cls}`} />{s.label}<span className="sr-only">: {g.word}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <section aria-labelledby="ri-h" className="min-w-0 space-y-4 p-5">
        <h2 id="ri-h" className="text-h3 font-semibold tracking-tight">{cur.label}</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(10rem,auto)_minmax(0,1fr)]">
          {cur.rows.map(([k, v], i) => (
            <div key={`${k}-${i}`} className="contents">
              <dt className="text-text-3 [overflow-wrap:anywhere]">{k}</dt>
              <dd className={`[overflow-wrap:anywhere] ${v === "not measured" || v === "not available" ? "text-text-3 italic" : v === "passed" ? "text-verified" : v === "failed" ? "text-fail" : "text-text"} ${/sha256|command|Endpoint/i.test(k) ? "font-mono text-[0.8125rem]" : ""}`}>{v || "none"}</dd>
            </div>
          ))}
        </dl>
        {cur.id === "synthesis" && run.synthesis?.code ? (
          <div>
            <p className="mb-2 text-meta text-text-3">Skill code ({run.synthesis.provenance === "model" && run.mode === "LIVE_REAL_MODEL" ? "model output" : "recorded reference, not model output"})</p>
            <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[0.8125rem] leading-relaxed text-text-2">{run.synthesis.code}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
