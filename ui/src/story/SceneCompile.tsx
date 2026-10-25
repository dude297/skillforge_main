// Act 3 centrepiece: investigation → generated code → independent tests → human approval → verified skill.
// A progress rail on top; a workbench below whose artifact changes per stage. Driven by p (0..1); p=1 is the
// static end state used on mobile and under reduced motion.
import { motion, useTransform, type MotionValue } from "motion/react";
import { Check, Fingerprint, Hand, Search, ShieldCheck, FileCode2, FlaskConical } from "lucide-react";

const STAGES = [
  { label: "Investigation", Icon: Search },
  { label: "Generated code", Icon: FileCode2 },
  { label: "Independent tests", Icon: FlaskConical },
  { label: "Human approval", Icon: Hand },
  { label: "Verified skill", Icon: ShieldCheck },
] as const;
const N = STAGES.length;
const span = (i: number) => [i / N, (i + 1) / N] as const;

const CODE = [
  "def run(dataset):",
  "    for e in dataset[\"evidence\"]:",
  "        if not e[\"trusted\"]: continue",
  "        expected = sum(lines) / scale",
  "        if record.total != expected:",
  "            propose(total=expected)",
];

function RailStep({ i, p }: { i: number; p: MotionValue<number> }) {
  const [a] = span(i);
  const on = useTransform(p, [a, a + 0.04], [0, 1]);
  const { Icon, label } = STAGES[i];
  const verified = i === N - 1;
  return (
    <li className="relative flex flex-1 flex-col items-center gap-2 text-center">
      <span className="relative grid size-9 place-items-center rounded-full border border-line bg-canvas">
        <motion.span style={{ opacity: on }} className={`absolute inset-0 rounded-full border ${verified ? "border-verified" : i === 3 ? "border-warn" : "border-signal"}`} />
        <Icon size={15} className="text-text-2" />
      </span>
      <span className="hidden text-[0.75rem] leading-tight text-text-2 sm:block">{label}</span><span className="sr-only sm:hidden">{label}</span>
    </li>
  );
}

/** One stage's artifact. Stages 1-4 sit on their own surface; the verified skill (5) stands alone on the stage. */
function Layer({ i, p, children }: { i: number; p: MotionValue<number>; children: React.ReactNode }) {
  const [a, b] = span(i);
  const last = i === N - 1;
  const opacity = useTransform(p, last ? [a, a + 0.03] : [a, a + 0.03, b - 0.02, b], last ? [0, 1] : [0, 1, 1, 0]);
  const y = useTransform(p, [a, a + 0.05], [10, 0]);
  return (
    <motion.div style={{ opacity, y }} className={`absolute inset-0 ${last ? "grid place-items-center" : "rounded-[var(--radius-stage)] border border-line bg-surface p-5"}`}>
      {children}
    </motion.div>
  );
}

function CodeLine({ text, i, p }: { text: string; i: number; p: MotionValue<number> }) {
  const [a] = span(1);
  const o = useTransform(p, [a + (i / CODE.length) * 0.15, a + ((i + 1) / CODE.length) * 0.15], [0, 1]);
  return <motion.div style={{ opacity: o }} className="whitespace-pre">{text}</motion.div>;
}

function TestDot({ i, p, hidden }: { i: number; p: MotionValue<number>; hidden?: boolean }) {
  const [a] = span(2);
  const o = useTransform(p, [a + 0.02 + i * 0.012, a + 0.03 + i * 0.012], [0, 1]);
  return (
    <span className={`relative grid size-5 place-items-center rounded border ${hidden ? "border-line-strong" : "border-line"}`}>
      <motion.span style={{ opacity: o }} className="absolute inset-0 grid place-items-center rounded bg-verified/15"><Check size={11} className="text-verified" /></motion.span>
    </span>
  );
}

export function SceneCompile({ p }: { p: MotionValue<number> }) {
  const fill = useTransform(p, [0, 1], [0, 1]);
  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <div className="relative">
        <span aria-hidden className="absolute top-[1.125rem] right-[10%] left-[10%] h-px bg-line" />
        <motion.span aria-hidden style={{ scaleX: fill }} className="absolute top-[1.125rem] right-[10%] left-[10%] h-px origin-left bg-signal/70" />
        <ol className="relative flex">{STAGES.map((_, i) => <RailStep key={i} i={i} p={p} />)}</ol>
      </div>

      <div className="relative h-64">
        <Layer i={0} p={p}>
          <p className="mb-3 text-meta text-text-3">What the agent proved</p>
          <ul className="space-y-2 font-mono text-[0.8125rem] text-text-2">
            <li>A-102.total = <span className="text-warn">18.00</span></li>
            <li>line_export (trusted): 600 + 540 + 600 at scale 100 = <span className="text-text">17.40</span></li>
            <li>operator_note (untrusted): ignored</li>
            <li className="text-text">fix applied once, verified 4 of 4</li>
          </ul>
        </Layer>
        <Layer i={1} p={p}>
          <p className="mb-3 flex items-center justify-between text-meta text-text-3"><span className="font-mono">scripts/helper.py</span><span>written by the local model</span></p>
          <div className="font-mono text-[0.8125rem] leading-relaxed text-text-2">
            {CODE.map((line, i) => <CodeLine key={line} text={line} i={i} p={p} />)}
          </div>
        </Layer>
        <Layer i={2} p={p}>
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-meta text-text-3">Its own tests, in an isolated sandbox</p>
              <div className="flex gap-1.5">{[0, 1, 2].map((i) => <TestDot key={i} i={i} p={p} />)}</div>
            </div>
            <div>
              <p className="mb-2 text-meta text-text-3">Hidden tests on the host, never shown to the agent</p>
              <div className="flex flex-wrap gap-1.5">{Array.from({ length: 11 }, (_, i) => <TestDot key={i} i={i + 3} p={p} hidden />)}</div>
            </div>
            <p className="text-meta text-text-2">Docker runner: no network, read-only, 512 MB, 64 processes. Default runner: a child process with resource limits.</p>
          </div>
        </Layer>
        <Layer i={3} p={p}>
          <div className="flex h-full flex-col justify-center gap-3">
            <p className="text-lead font-semibold">Promote line-total-reconcile?</p>
            <p className="text-text-2">A person decides. The agent cannot promote its own skill.</p>
            <p className="flex items-center gap-2 text-warn"><Hand size={16} />Promoted by Dana</p>
          </div>
        </Layer>
        <Layer i={4} p={p}>
          <div className="w-full">
            <div className="rounded-[var(--radius-stage)] border border-verified/80 bg-canvas p-6 shadow-[0_30px_80px_-40px_rgba(101,233,183,0.25)]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">line-total-reconcile <span className="font-normal text-text-3">v1</span></p>
                <span className="flex items-center gap-1 text-meta text-verified"><ShieldCheck size={14} />Verified skill</span>
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[0.75rem] text-text-3"><Fingerprint size={12} />locked version (sha256) 41506b7c7fdec463…</p>
              <p className="mt-3 text-meta text-text-2">Runs without the model. Changes only <span className="font-mono">total</span>. Every fix it proposes still needs approval.</p>
            </div>
          </div>
        </Layer>
      </div>
    </div>
  );
}
