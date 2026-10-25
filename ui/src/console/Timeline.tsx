import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Hand, Minus, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import type { Step, StepKind, StepState } from "../data/types";
import { rise, useT } from "../lib/motion";

const KIND_ICON: Record<StepKind, typeof Wrench> = { tool: Wrench, human: Hand, verify: ShieldCheck, skill: Sparkles };

/** One vocabulary for step states. `word` is shown as text for every state that is not routine, so colour never
 * carries the meaning alone. Node = the circle on the trace, row = the tint behind a step that needs attention. */
const STATE: Record<StepState, { word: string; node: string; row: string; label: string }> = {
  queued: { word: "Queued", node: "border-dashed border-line-strong", row: "", label: "text-text-3" },
  running: { word: "Running", node: "border-signal bg-signal/10", row: "bg-surface-2", label: "text-signal" },
  done: { word: "Done", node: "border-line-strong bg-surface", row: "", label: "text-text-3" },
  failed: { word: "Failed", node: "border-fail bg-fail/10", row: "bg-fail/[0.06]", label: "text-fail" },
  waiting: { word: "Needs a person", node: "border-warn bg-warn/15", row: "bg-warn/[0.08] ring-1 ring-warn/40", label: "text-warn" },
  skipped: { word: "Skipped", node: "border-dashed border-line-strong", row: "", label: "text-text-3" },
};

/** "investigate {"record_id": "A-101"}" -> tool name and its arguments, both machine text. */
export function splitCall(call: string): { tool: string; args: string } {
  const m = /^(\S+)\s*(.*)$/s.exec(call.trim());
  return m ? { tool: m[1], args: m[2] } : { tool: call, args: "" };
}

function Node({ step }: { step: Step }) {
  const reduce = useReducedMotion();
  const s = STATE[step.state];
  let glyph: React.ReactNode;
  if (step.state === "done") glyph = <Check aria-hidden size={14} className={step.kind === "verify" ? "text-verified" : "text-text-2"} />;
  else if (step.state === "failed") glyph = <X aria-hidden size={14} className="text-fail" />;
  else if (step.state === "skipped") glyph = <Minus aria-hidden size={14} className="text-text-3" />;
  else if (step.state === "waiting") glyph = <Hand aria-hidden size={14} className="text-warn" />;
  else if (step.state === "running")
    glyph = <motion.span aria-hidden className="block size-2 rounded-full bg-signal" animate={reduce ? undefined : { opacity: [1, 0.35, 1] }} transition={reduce ? undefined : { duration: 1, repeat: Infinity, ease: "easeInOut" }} />;
  else glyph = null;
  return (
    <span className={`relative z-10 mt-2 grid size-7 place-items-center rounded-full border ${s.node}`}>
      {glyph}
      <span className="sr-only">{s.word}</span>
    </span>
  );
}

/** The run, drawn as a trace: one hairline through every step, a node per state, what needs a person tinted amber. */
export function Timeline({ steps, empty }: { steps: Step[]; empty: React.ReactNode }) {
  const tr = useT("panel");
  if (!steps.length) return <div className="p-5 text-text-2 sm:p-6">{empty}</div>;
  return (
    <ol aria-label="Agent steps" className="relative p-3 sm:p-4">
      <AnimatePresence initial={false}>
        {steps.map((s, i) => {
          const KindIcon = KIND_ICON[s.kind];
          const last = i === steps.length - 1;
          const st = STATE[s.state];
          const call = s.call ? splitCall(s.call) : null;
          const showWord = s.state === "running" || s.state === "waiting" || s.state === "failed" || s.state === "skipped";
          return (
            <motion.li key={s.id} layout="position" {...rise} transition={tr} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
              {!last && <span aria-hidden className={`absolute top-9 bottom-0 left-[0.8125rem] w-px ${s.state === "done" ? "bg-line-strong" : "bg-line"}`} />}
              <Node step={s} />
              <div className={`my-0.5 min-w-0 rounded-lg px-3 py-2 ${st.row}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className={`flex min-w-0 items-center gap-2 font-medium ${s.state === "skipped" || s.state === "queued" ? "text-text-2" : "text-text"}`}>
                    {s.kind !== "tool" ? <KindIcon aria-hidden size={14} className="shrink-0 text-text-3" /> : null}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{s.title}</span>
                  </p>
                  {showWord ? <span className={`shrink-0 text-meta font-medium ${st.label}`} aria-hidden>{st.word}</span>
                    : s.ms != null && s.state === "done" ? <span className="tnum shrink-0 text-meta text-text-3">{s.ms} ms</span> : null}
                </div>
                {call ? (
                  <p className="mt-1 font-mono text-[0.8125rem] leading-snug [overflow-wrap:anywhere]">
                    <span className="text-text-2">{call.tool}</span>{call.args ? <span className="text-text-3"> {call.args}</span> : null}
                  </p>
                ) : null}
                {s.result && s.state !== "running" ? (
                  <p className={`mt-1 text-meta [overflow-wrap:anywhere] ${s.state === "failed" ? "text-fail" : s.kind === "verify" && s.state === "done" ? "text-verified" : "text-text-2"}`}>
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
