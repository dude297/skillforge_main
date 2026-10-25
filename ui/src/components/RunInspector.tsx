// Master-detail proof of one OnCall run: left the run's records as a trace, right everything recorded about the selected one.
// Shared by the guided demo (scene 6) and the console's Incident view. Null is "not measured", never 0.
import { useState } from "react";
import { CircleCheck, CircleDashed, CircleX, Hand, Hourglass } from "lucide-react";
import { proofSteps, type OnCallRun, type ProofStep } from "../data/oncall";
import { CopyCommand } from "./CopyCommand";

const GLYPH: Record<ProofStep["status"], { Icon: typeof CircleCheck; cls: string; word: string; short: string | null }> = {
  ok: { Icon: CircleCheck, cls: "text-verified", word: "on record", short: null },
  sim: { Icon: CircleDashed, cls: "text-warn", word: "approved by an agent or test, not a person", short: "Simulated, not a person" },
  fail: { Icon: CircleX, cls: "text-fail", word: "failed or refused", short: "Failed or refused" },
  wait: { Icon: Hourglass, cls: "text-warn", word: "waiting for a person", short: "Needs a person" },
  none: { Icon: CircleDashed, cls: "text-text-3", word: "not available", short: "Not available" },
};
const CHIP: Record<ProofStep["status"], string> = {
  ok: "border-line-strong text-text-2", sim: "border-warn/55 bg-warn/10 text-warn", fail: "border-fail/55 bg-fail/10 text-fail",
  wait: "border-warn/55 bg-warn/10 text-warn", none: "border-line-strong text-text-3",
};

export function RunInspector({ run, initial = "incident" }: { run: OnCallRun; initial?: string }) {
  const steps = proofSteps(run);
  const [sel, setSel] = useState(initial);
  const cur = steps.find((s) => s.id === sel) ?? steps[0];
  const curGlyph = GLYPH[cur.status];
  const command = cur.id === "approval" ? run.approval?.command ?? null : null;
  const personNeeded = cur.id === "approval" && (cur.status === "wait" || cur.status === "sim");
  const rows = command ? cur.rows.filter(([k]) => k !== "Host command") : cur.rows;
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface md:grid-cols-[17rem_minmax(0,1fr)]" data-testid="run-inspector">
      <nav aria-label="Run records" className="min-w-0 border-b border-line md:border-r md:border-b-0">
        {/* phones: wrapping chips (nothing scrolls sideways); wider: a vertical trace, one hairline through the records */}
        <ul className="relative flex flex-wrap gap-2 p-3 md:block md:p-2">
          {steps.map((s, i) => {
            const g = GLYPH[s.status];
            const last = i === steps.length - 1;
            const on = s.id === cur.id;
            return (
              <li key={s.id} className="relative md:grid md:grid-cols-[1.5rem_minmax(0,1fr)] md:gap-1">
                {!last && <span aria-hidden className="absolute top-8 bottom-[-0.125rem] left-5 hidden w-px bg-line md:block" />}
                <button type="button" onClick={() => setSel(s.id)} aria-current={on ? "true" : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left max-md:border-line md:col-span-2 md:grid md:min-h-0 md:grid-cols-subgrid md:items-start md:gap-x-2 md:border-transparent md:px-2 md:py-2 ${on ? "bg-surface-2 text-text max-md:border-line-strong md:border-transparent" : "text-text-2 hover:bg-canvas hover:text-text"}`}>
                  <span className="relative z-10 grid shrink-0 place-items-center md:size-6 md:rounded-full md:bg-surface"><g.Icon aria-hidden size={16} className={g.cls} /></span>
                  <span className="min-w-0">
                    <span className="block [overflow-wrap:anywhere]">{s.label}</span>
                    {g.short ? <span className={`hidden text-meta md:block ${g.cls}`}>{g.short}</span> : null}
                    <span className="sr-only">: {g.word}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <section aria-labelledby="ri-h" className="min-w-0 space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ri-h" className="text-h3 font-semibold tracking-tight">{cur.label}</h2>
          <p className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border px-2 py-0.5 text-meta font-medium ${CHIP[cur.status]}`}>
            {personNeeded ? <Hand aria-hidden size={13} /> : <curGlyph.Icon aria-hidden size={13} />}
            {cur.status === "ok" ? "On record" : cur.status === "wait" ? "Waiting for a person" : cur.status === "sim" ? "Simulated approval: typed by an agent or test, not a person" : cur.status === "fail" ? "Failed or refused" : "Not available"}
          </p>
        </div>
        <div className={personNeeded ? "space-y-4 rounded-lg border border-warn/45 bg-warn/[0.05] p-4" : "space-y-4"}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_minmax(0,1fr)] sm:gap-y-2">
            {rows.map(([k, v], i) => (
              <div key={`${k}-${i}`} className="contents">
                <dt className="text-text-3 [overflow-wrap:anywhere] max-sm:-mb-2">{k}</dt>
                <dd className={`[overflow-wrap:anywhere] ${v === "not measured" || v === "not available" ? "text-text-3 italic" : v === "passed" ? "text-verified" : v === "failed" ? "text-fail" : "text-text"} ${/sha256|command|Endpoint/i.test(k) ? "font-mono text-[0.8125rem]" : ""}`}>{v || "none"}</dd>
              </div>
            ))}
          </dl>
          {command ? <CopyCommand label="A person runs this on the host. This browser can't approve anything." cmd={command} /> : null}
        </div>
        {cur.id === "synthesis" && run.synthesis?.code ? (
          <div>
            <p className="mb-2 text-meta text-text-3">Skill code ({run.synthesis.provenance === "model" && run.mode === "LIVE_REAL_MODEL" ? "model output" : "recorded reference, not model output"})</p>
            <pre tabIndex={0} aria-label="Skill code" className="max-h-80 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[0.8125rem] leading-relaxed text-text-2">{run.synthesis.code}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
