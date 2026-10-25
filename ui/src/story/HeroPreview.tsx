import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Check, Fingerprint, Hand, ShieldCheck } from "lucide-react";
import { DUR, EASE } from "../lib/motion";

// Page-load choreography (the single orchestrated moment of the page): the trace runs, a person approves,
// the skill compiles and turns green. Static end state under reduced motion.
const TRACE = [
  { call: "read_records", note: "5 records" },
  { call: "investigate A-102", note: "total 18.00, lines sum to 17.40" },
  { call: "propose_action", note: "total → 17.40" },
];
const STEP = 0.28; // s between beats
const T0 = 0.55; // after the headline settles

export function HeroPreview({ instant = false }: { instant?: boolean }) {
  const reduce = useReducedMotion() || instant; // instant: render the finished state (presenter)
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 700], [0, -48]); // subtle parallax against the headline
  const beat = (i: number) => (reduce ? { duration: 0 } : { duration: DUR.panel, delay: T0 + i * STEP, ease: EASE.standard });
  const enter = reduce ? false : { opacity: 0, y: 8 };

  return (
    <motion.div style={reduce ? undefined : { y }} aria-hidden className="relative w-full max-w-[34rem] lg:justify-self-end">
      <div className="hairline-grid absolute -inset-10 rounded-[2rem] opacity-60 [mask-image:radial-gradient(closest-side,black,transparent)]" />
      <div className="relative overflow-hidden rounded-[var(--radius-stage)] border border-line-strong bg-surface shadow-[0_40px_120px_-40px_rgba(130,216,255,0.18)]">
        <div className="flex items-center gap-4 border-b border-line px-4 py-2.5 text-meta">
          <span className="flex items-center gap-2 text-text-2"><span className="size-1.5 rounded-full bg-text-2" />Local model</span>
          <span className="text-text-3">Totals check, batch A</span>
        </div>
        <ol className="space-y-1 p-3">
          {TRACE.map((r, i) => (
            <motion.li key={r.call} initial={enter} animate={{ opacity: 1, y: 0 }} transition={beat(i)} className="grid grid-cols-[1.75rem_1fr] items-start gap-3 rounded-lg px-2 py-2">
              <span className="mt-0.5 grid size-6 place-items-center rounded-full border border-signal/70 bg-canvas"><Check size={12} className="text-signal" /></span>
              <span>
                <span className="block font-mono text-[0.8125rem] text-text">{r.call}</span>
                <span className="block text-meta text-text-3">{r.note}</span>
              </span>
            </motion.li>
          ))}
          <motion.li initial={enter} animate={{ opacity: 1, y: 0 }} transition={beat(3)} className="grid grid-cols-[1.75rem_1fr] items-center gap-3 rounded-lg bg-surface-2 px-2 py-2.5">
            <span className="grid size-6 place-items-center rounded-full border border-warn bg-canvas"><Hand size={12} className="text-warn" /></span>
            <span className="flex items-center justify-between gap-3 text-meta">
              <span className="text-text">Approved by Dana</span>
              <span className="text-text-3">verified 4 of 4</span>
            </span>
          </motion.li>
        </ol>
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduce ? { duration: 0 } : { duration: DUR.major, delay: T0 + 4.4 * STEP, ease: EASE.emphasis }}
          className="relative m-3 mt-0 rounded-[var(--radius-panel)] border border-line bg-canvas p-4"
        >
          <motion.span
            className="absolute inset-0 rounded-[var(--radius-panel)] border border-verified"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduce ? { duration: 0 } : { duration: DUR.panel, delay: T0 + 6.2 * STEP }}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">line-total-reconcile <span className="font-normal text-text-3">v1</span></p>
            <span className="flex items-center gap-1 text-meta text-verified"><ShieldCheck size={13} />Skill ready</span>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[0.75rem] text-text-3"><Fingerprint size={12} />locked version 41506b7c7fdec463…</p>
          <p className="mt-3 text-meta text-text-2">Next batch: handled without the model, 2 fixes proposed for approval.</p>
        </motion.div>
      </div>
      <p className="mt-3 text-right text-meta text-text-3">Illustration of the console. Not a recorded run.</p>
    </motion.div>
  );
}
