import { useEffect, useRef } from "react";
import { Play, RotateCcw, Sparkles, Database, Hand, Workflow, CircleCheck, CircleX, CircleDashed, Ban } from "lucide-react";
import type { ProductConfig } from "../../config/product";
import type { Faults, Phase } from "../../data/synthetic";
import type { Step } from "../../data/types";
import type { SyntheticRun } from "../ConsoleShell";
import { Timeline } from "../Timeline";
import { Inspector } from "../Inspector";
import { Banner } from "../../components/Banner";

/** The scripted decisions are named for what they are. data/synthetic.ts says "Approved by you"; here, a decision made on a
 * synthetic proposal always reads as a simulation, never as a person's approval. */
const SIM = { Approved: ["approval", "approves this on the host"], Rejected: ["rejection", "rejects this on the host"], Promoted: ["promotion", "promotes the skill on the host"] } as const;
const asSimulation = (steps: Step[]): Step[] => steps.map((s) => {
  const m = /^(Approved|Rejected|Promoted) by you$/.exec(s.title);
  if (!m) return s;
  const [noun, does] = SIM[m[1] as keyof typeof SIM];
  return { ...s, title: `Simulated ${noun}, by you`, result: `Simulated: on a real system a person ${does}.` };
});

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready", investigating: "Agent is investigating", awaiting_approval: "Waiting for you", executing: "Applying the approved change",
  reconnecting: "Reconnecting", verified: "Verified", verify_failed: "Needs review", rejected: "Rejected", escalated: "Escalated",
  learning: "Turning the fix into a skill", awaiting_promotion: "Waiting for you", promoted: "Skill active", reusing: "Skill is handling new data",
  reuse_approval: "Waiting for you", reuse_done: "Verified",
};

const PHASE_TONE: Record<Phase, { cls: string; Icon: typeof Hand }> = {
  idle: { cls: "text-text-2", Icon: CircleDashed },
  investigating: { cls: "text-signal", Icon: Workflow }, executing: { cls: "text-signal", Icon: Workflow }, learning: { cls: "text-signal", Icon: Workflow }, reusing: { cls: "text-signal", Icon: Workflow },
  reconnecting: { cls: "text-warn", Icon: Workflow },
  awaiting_approval: { cls: "text-warn", Icon: Hand }, awaiting_promotion: { cls: "text-warn", Icon: Hand }, reuse_approval: { cls: "text-warn", Icon: Hand }, escalated: { cls: "text-warn", Icon: Hand },
  verified: { cls: "text-verified", Icon: CircleCheck }, promoted: { cls: "text-verified", Icon: CircleCheck }, reuse_done: { cls: "text-verified", Icon: CircleCheck },
  verify_failed: { cls: "text-fail", Icon: CircleX }, rejected: { cls: "text-text-2", Icon: Ban },
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
  const idle = phase === "idle";
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
    if (phase === "verified") return { label: "Simulate learning a skill", icon: Sparkles, on: run.learn };
    if (phase === "promoted" || (phase === "escalated" && skillActive)) return { label: "Run on new data", icon: Database, on: run.reuse };
    if (phase === "idle") return { label: `Start ${product.terms.task.toLowerCase()}`, icon: Play, on: run.start };
    if (["reuse_done", "rejected", "verify_failed", "escalated"].includes(phase)) return { label: "Start over", icon: RotateCcw, on: run.start };
    return null;
  })();

  const tone = PHASE_TONE[phase];
  return (
    <div ref={root} className="grid min-h-full grid-cols-1 xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">

      <section aria-labelledby="run-h" className="order-1 flex min-w-0 flex-col border-b border-line xl:order-2 xl:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h1 id="run-h" tabIndex={-1} className="text-h3 font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h1>
            <p className={`mt-1 flex items-center gap-2 font-medium ${tone.cls}`} aria-live="polite">
              <tone.Icon aria-hidden size={16} className="shrink-0" />{PHASE_LABEL[phase]}
            </p>
          </div>
          {primary && !idle ? (
            <button type="button" data-autofocus className="btn btn-primary min-h-11 sm:min-h-10" onClick={primary.on}>
              <primary.icon aria-hidden size={16} /> {primary.label}
            </button>
          ) : null}
        </div>
        <div role="group" aria-labelledby="faults-h" className="border-b border-line px-4 py-3 sm:px-5">
          <p id="faults-h" className="mb-2 text-meta font-medium text-text-3">Simulate a failure on the next run</p>
          <div className="flex flex-wrap gap-2">
            {FAULTS.map((f) => {
              const on = run.state.faults[f.key];
              return (
                <label key={f.key} title={f.hint}
                  className={`inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal sm:min-h-9 ${on ? "border-warn/55 bg-warn/10 text-text" : "border-line text-text-2 hover:border-line-strong hover:text-text"}`}>
                  <input type="checkbox" aria-describedby={`fault-${f.key}`} className="size-4 accent-[var(--color-warn)]" checked={on} onChange={() => run.toggleFault(f.key)} />
                  {f.label}
                  <span id={`fault-${f.key}`} className="sr-only">{f.hint}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="px-4 empty:hidden sm:px-5 [&:not(:empty)]:pt-4"><Banner banner={run.state.banner} /></div>
        <div className="flex-1">
          <Timeline
            steps={asSimulation(run.state.steps)}
            empty={<RunInvitation product={product} onStart={primary?.on} label={primary?.label} />}
          />
        </div>
      </section>

      <aside aria-label="Runs" className="order-3 border-t border-line p-4 sm:p-5 xl:order-1 xl:border-t-0 xl:border-r">
        <h2 className="font-semibold">All {product.terms.tasks.toLowerCase()}</h2>
        <ul className="mt-3 space-y-1">
          {tasks.map((t) => (
            <li key={t.title} aria-current={t.current ? "true" : undefined} className={`rounded-lg px-3 py-2 ${t.current ? "bg-surface-2" : ""}`}>
              <p className={t.current ? "font-medium" : "text-text-2"}>{t.title}</p>
              <p className="text-meta text-text-3">{t.state}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-meta text-text-3">Synthetic preview: one scripted workflow, not real runs.</p>
      </aside>
      <aside aria-label="Inspector" className="order-2 min-w-0 xl:order-3 xl:border-l xl:border-line">
        <Inspector run={run.state} product={product} onDecide={run.decide} onPromote={run.promote} onApproveReuse={run.approveReuse} />
      </aside>
    </div>
  );
}

/** Before a run: say what will happen, in order, and who decides what. Queued steps look queued; the one that needs a person is amber. */
function RunInvitation({ product, onStart, label }: { product: ProductConfig; onStart?: () => void; label?: string }) {
  const plan = [
    { title: `The agent reads the ${product.terms.records}`, text: "Read-only. It looks at each one and at the evidence behind it.", tone: "" },
    { title: `It proposes one ${product.terms.fix}`, text: "One bounded change, with the evidence it relied on. It cannot apply it.", tone: "" },
    { title: "You decide", text: "Nothing changes until a person approves. The agent cannot approve its own work.", tone: "warn" },
    { title: "It is applied once and checked", text: "Independent code re-reads the database. Failure is shown, not hidden.", tone: "verify" },
  ];
  return (
    <div className="max-w-2xl space-y-5 py-2">
      <div className="space-y-1">
        <h2 className="text-lead font-semibold text-text">Start a run to watch the agent work</h2>
        <p>Every step appears on this trace as it happens. This is what will happen:</p>
      </div>
      <ol className="space-y-0" aria-label="What will happen">
        {plan.map((p, i) => (
          <li key={p.title} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
            {i < plan.length - 1 && <span aria-hidden className="absolute top-8 bottom-0 left-[0.8125rem] w-px border-l border-dashed border-line-strong" />}
            <span aria-hidden className={`relative z-10 mt-0.5 grid size-7 place-items-center rounded-full border border-dashed text-meta tnum ${p.tone === "warn" ? "border-warn text-warn" : p.tone === "verify" ? "border-verified/70 text-text-2" : "border-line-strong text-text-3"}`}>{i + 1}</span>
            <div className="min-w-0">
              <p className={`font-medium ${p.tone === "warn" ? "text-warn" : "text-text"}`}>{p.title}</p>
              <p className="text-meta text-text-2">{p.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {onStart ? (
        <div className="space-y-2">
          <button type="button" data-autofocus className="btn btn-primary min-h-11" onClick={onStart}><Play aria-hidden size={16} /> {label}</button>
          <p className="text-meta text-text-3">Synthetic preview: a scripted run, no model. To see how it copes when something breaks, switch on a failure above first.</p>
        </div>
      ) : null}
    </div>
  );
}
