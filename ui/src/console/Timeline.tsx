import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleDashed, Hand, ShieldCheck, Sparkles, Wrench, X, Minus } from "lucide-react";
import type { Step } from "../data/types";
import { rise, useT } from "../lib/motion";

const KIND_ICON = { tool: Wrench, human: Hand, verify: ShieldCheck, skill: Sparkles } as const;

const STATE = {
  queued: { ring: "border-line", label: "Queued" },
  running: { ring: "border-signal", label: "Running" },
  done: { ring: "border-line-strong", label: "Done" },
  failed: { ring: "border-fail", label: "Failed" },
  waiting: { ring: "border-warn", label: "Needs a person" },
  skipped: { ring: "border-line", label: "Skipped" },
} as const;

function StateIcon({ step }: { step: Step }) {
  const reduce = useReducedMotion();
  if (step.state === "done") return <Check size={14} className={step.kind === "verify" ? "text-verified" : "text-text-2"} />;
  if (step.state === "failed") return <X size={14} className="text-fail" />;
  if (step.state === "skipped") return <Minus size={14} className="text-text-3" />;
  if (step.state === "waiting") return <Hand size={13} className="text-warn" />;
  if (step.state === "running")
    return (
      <motion.span
        className="block size-2 rounded-full bg-signal"
        animate={reduce ? undefined : { opacity: [1, 0.35, 1] }}
        transition={reduce ? undefined : { duration: 1, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  return <CircleDashed size={14} className="text-text-3" />;
}

export function Timeline({ steps, empty }: { steps: Step[]; empty: React.ReactNode }) {
  const tr = useT("panel");
  if (!steps.length) return <div className="grid h-full place-items-center p-10 text-center text-text-2">{empty}</div>;
  return (
    <ol aria-label="Agent steps" className="relative space-y-1 p-3">
      <AnimatePresence initial={false}>
        {steps.map((s, i) => {
          const KindIcon = KIND_ICON[s.kind];
          const last = i === steps.length - 1;
          return (
            <motion.li key={s.id} layout="position" {...rise} transition={tr} className="relative grid grid-cols-[2rem_1fr] gap-3">
              {/* the trace: one hairline connecting steps, signal-coloured while the agent is acting */}
              {!last && (
                <span aria-hidden className={`absolute top-8 bottom-[-0.25rem] left-[0.9375rem] w-px ${s.state === "running" ? "bg-signal/60" : "bg-line"}`} />
              )}
              <span className={`relative z-10 mt-1.5 grid size-8 place-items-center rounded-full border bg-canvas ${STATE[s.state].ring}`}>
                <StateIcon step={s} />
                <span className="sr-only">{STATE[s.state].label}</span>
              </span>
              <div className={`min-w-0 rounded-lg px-3 py-2 ${s.state === "running" ? "bg-surface-2" : ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex items-center gap-2 font-medium text-text">
                    {s.kind !== "tool" ? <KindIcon aria-hidden size={14} className="shrink-0 text-text-3" /> : null}
                    {s.title}
                  </p>
                  {s.ms != null && s.state === "done" ? <span className="tnum shrink-0 text-meta text-text-3">{s.ms} ms</span> : null}
                </div>
                {s.call ? <p className="mt-1 font-mono text-[0.8125rem] [overflow-wrap:anywhere] text-text-2">{s.call}</p> : null}
                {s.result && s.state !== "running" ? (
                  <p className={`mt-1 text-meta ${s.state === "failed" ? "text-fail" : s.kind === "verify" && s.state === "done" ? "text-verified" : "text-text-2"}`}>
                    {s.result}
                  </p>
                ) : null}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
