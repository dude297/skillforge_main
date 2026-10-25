import { useEffect, useRef } from "react";
import { Play, RotateCcw, Sparkles, Database } from "lucide-react";
import type { ProductConfig } from "../../config/product";
import type { Faults, Phase } from "../../data/synthetic";
import type { SyntheticRun } from "../ConsoleShell";
import { Timeline } from "../Timeline";
import { Inspector } from "../Inspector";
import { Banner } from "../../components/Banner";

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready", investigating: "Agent is investigating", awaiting_approval: "Waiting for you", executing: "Applying the approved change",
  reconnecting: "Reconnecting", verified: "Verified", verify_failed: "Needs review", rejected: "Rejected", escalated: "Escalated",
  learning: "Turning the fix into a skill", awaiting_promotion: "Waiting for you", promoted: "Skill active", reusing: "Skill is handling new data",
  reuse_approval: "Waiting for you", reuse_done: "Verified",
};

const FAULTS: { key: keyof Faults; label: string; hint: string }[] = [
  { key: "modelOffline", label: "Model offline", hint: "The local inference server is not answering" },
  { key: "connectionDrop", label: "Connection drops", hint: "The host service restarts while the change is applied" },
  { key: "verifyFails", label: "Verification fails", hint: "Another writer changes the record after the fix" },
];

/** The one complete workflow: investigate, approve, verify, learn, promote, reuse. */
export function Investigations({ run, product }: { run: SyntheticRun; product: ProductConfig }) {
  const { phase } = run.state;
  const reusePhase = ["reusing", "reuse_approval", "reuse_done"].includes(phase);
  const { first, second } = product.scenario;
  const title = reusePhase ? second : first;
  const tasks = reusePhase
    ? [{ title: second, state: PHASE_LABEL[phase], current: true }, { title: first, state: "Verified, skill learned", current: false }]
    : [{ title: first, state: PHASE_LABEL[phase], current: true }];
  const busy = ["investigating", "executing", "reconnecting", "learning", "reusing"].includes(phase);
  const skillActive = run.state.skill?.status === "approved";

  // Focus follows the workflow: after an action unmounts its button, move focus to whatever needs the person
  // next ([data-autofocus]), but only if focus was lost (on <body>) or still inside this view.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // the inspector swaps panels with an exit-then-enter animation, so the next control can appear a few hundred
    // ms after the phase changes: look for it each frame for up to ~1 s
    let frame = 0, id = 0;
    const tryFocus = () => {
      const active = document.activeElement;
      if (active && active !== document.body && !root.current?.contains(active)) return; // user is elsewhere
      const next = root.current?.querySelector<HTMLElement>("[data-autofocus]");
      if (next) return next.focus();
      if (++frame < 60) id = requestAnimationFrame(tryFocus);
      else if (!active || active === document.body) document.getElementById("run-h")?.focus();
    };
    id = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const primary = (() => {
    if (busy) return null;
    if (phase === "verified") return { label: "Turn this fix into a skill", icon: Sparkles, on: run.learn };
    if (phase === "promoted" || (phase === "escalated" && skillActive)) return { label: "Run on new data", icon: Database, on: run.reuse };
    if (phase === "idle") return { label: `Start ${product.terms.task.toLowerCase()}`, icon: Play, on: run.start };
    if (["reuse_done", "rejected", "verify_failed", "escalated"].includes(phase)) return { label: "Start over", icon: RotateCcw, on: run.start };
    return null;
  })();

  return (
    <div ref={root} className="grid min-h-full grid-cols-1 xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">

      <section aria-labelledby="run-h" className="order-1 flex min-w-0 flex-col border-b border-line xl:order-2 xl:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h1 id="run-h" tabIndex={-1} className="text-h3 font-semibold tracking-tight">{title}</h1>
            <p className="text-text-2" aria-live="polite">{PHASE_LABEL[phase]}</p>
          </div>
          {primary ? (
            <button type="button" data-autofocus className="btn btn-primary" onClick={primary.on}>
              <primary.icon aria-hidden size={16} /> {primary.label}
            </button>
          ) : null}
        </div>
        <div className="px-5 pt-4"><Banner banner={run.state.banner} /></div>
        <div className="flex-1">
          <Timeline
            steps={run.state.steps}
            empty={<><p className="text-lead text-text">No run yet.</p><p className="mt-1">Start one to watch each step the agent takes and what still needs you.</p></>}
          />
        </div>
      </section>

      <aside aria-label="Runs and rehearsal" className="order-3 space-y-6 xl:order-1 border-t border-line p-5 xl:border-t-0 xl:border-r">
        <div>
          <h2 className="font-semibold">All {product.terms.tasks.toLowerCase()}</h2>
          <ul className="mt-3 space-y-1">
            {tasks.map((t) => (
              <li key={t.title} aria-current={t.current ? "true" : undefined} className={`rounded-lg px-3 py-2 ${t.current ? "bg-surface-2" : ""}`}>
                <p className={t.current ? "font-medium" : "text-text-2"}>{t.title}</p>
                <p className="text-meta text-text-3">{t.state}</p>
              </li>
            ))}
          </ul>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">Simulate a failure</legend>
          <p className="text-meta text-text-3">Applies to the next run.</p>
          {FAULTS.map((f) => (
            <label key={f.key} className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-surface">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--color-warn)]" checked={run.state.faults[f.key]} onChange={() => run.toggleFault(f.key)} />
              <span>
                <span className="block text-text">{f.label}</span>
                <span className="block text-meta text-text-3">{f.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </aside>
      <aside aria-label="Inspector" className="order-2 min-w-0 xl:order-3 xl:border-l xl:border-line">
        <Inspector run={run.state} product={product} onDecide={run.decide} onPromote={run.promote} onApproveReuse={run.approveReuse} />
      </aside>
    </div>
  );
}
