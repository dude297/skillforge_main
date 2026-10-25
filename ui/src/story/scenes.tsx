// Five stage scenes. Each takes p: MotionValue 0..1 (its act's scroll progress). Static callers pass 1.
// Only transform/opacity (and one SVG pathLength) are animated.
import { motion, useTransform, type MotionValue } from "motion/react";
import { ShieldCheck } from "lucide-react";
import type { ProductConfig } from "../config/product";

const ROWS = [
  { id: "A-101", total: "12.10", ok: true },
  { id: "A-102", total: "18.00", ok: false },
  { id: "A-103", total: "9.75", ok: true },
  { id: "A-104", total: "30.20", ok: true },
  { id: "A-105", total: "4.05", ok: true },
];

export function SceneProblem({ p, product }: { p: MotionValue<number>; product: ProductConfig }) {
  const lift = useTransform(p, [0.15, 0.6], [0, -6]);
  const glow = useTransform(p, [0.15, 0.6], [0, 1]);
  return (
    <div className="w-full max-w-md space-y-1.5" aria-label={`Five ${product.terms.records}, one with a wrong total`}>
      {ROWS.map((r) => (
        <motion.div
          key={r.id}
          style={r.ok ? undefined : { y: lift }}
          className="relative flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3"
        >
          {!r.ok && <motion.span aria-hidden style={{ opacity: glow }} className="absolute inset-0 rounded-lg border border-warn" />}
          <span className="font-mono text-meta text-text-2">{r.id}</span>
          <span className={`tnum font-medium ${r.ok ? "text-text-2" : "text-warn"}`}>{r.total}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ---- Act 2: discovery. Evidence enters, the investigation fans out, the finding comes into focus. ----------
const REC = ["A-101", "A-102", "A-103", "A-104", "A-105"];
const RX = 430, RY = (i: number) => 60 + i * 62, AX = 110, AY = 184;

function Edge({ i, p }: { i: number; p: MotionValue<number> }) {
  const at = 0.12 + i * 0.09;
  const draw = useTransform(p, [at, at + 0.1], [0, 1]);
  const hit = REC[i] === "A-102";
  return <motion.path d={`M${AX + 34} ${AY} C ${AX + 160} ${AY}, ${RX - 150} ${RY(i)}, ${RX - 44} ${RY(i)}`} fill="none"
    stroke={hit ? "var(--color-warn)" : "var(--color-signal)"} strokeOpacity={hit ? 0.9 : 0.45} strokeWidth="1.25" style={{ pathLength: draw }} />;
}

function RecordNode({ i, p }: { i: number; p: MotionValue<number> }) {
  const at = 0.12 + i * 0.09;
  const o = useTransform(p, [at + 0.06, at + 0.1], [0.35, 1]);
  const hit = REC[i] === "A-102";
  const warn = useTransform(p, [0.62, 0.68], [0, 1]);
  return (
    <motion.g style={{ opacity: o }}>
      <rect x={RX - 44} y={RY(i) - 16} width="88" height="32" rx="8" fill="var(--color-surface)" stroke="var(--color-line-strong)" />
      {hit && <motion.rect style={{ opacity: warn }} x={RX - 44} y={RY(i) - 16} width="88" height="32" rx="8" fill="none" stroke="var(--color-warn)" strokeWidth="1.5" />}
      <text x={RX} y={RY(i) + 4} textAnchor="middle" className="fill-text-2 font-mono text-[12px]">{REC[i]}</text>
    </motion.g>
  );
}

export function SceneInvestigate({ p }: { p: MotionValue<number> }) {
  const finding = useTransform(p, [0.68, 0.76], [0, 1]);
  const findingX = useTransform(p, [0.68, 0.76], [-8, 0]);
  const ev1 = useTransform(p, [0.0, 0.12], [0, 1]);
  const ev1y = useTransform(p, [0.0, 0.12], [14, 0]);
  const ev2 = useTransform(p, [0.08, 0.2], [0, 1]);
  const ev2y = useTransform(p, [0.08, 0.2], [14, 0]);
  return (
    <div className="w-full max-w-xl">
      {/* phones: the same facts as a list (the scaled graph's labels would be ~7 px) */}
      <ol className="space-y-1.5 sm:hidden" aria-label="Records the agent investigated">
        {REC.map((r) => (
          <li key={r} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${r === "A-102" ? "border-warn/70" : "border-line"} bg-surface`}>
            <span className="font-mono text-meta text-text-2">{r}</span>
            <span className={`text-meta ${r === "A-102" ? "text-warn" : "text-text-3"}`}>{r === "A-102" ? "total 18.00, lines say 17.40" : "matches"}</span>
          </li>
        ))}
      </ol>
      <div className="relative hidden sm:block">
        <svg viewBox="0 0 520 370" className="w-full" role="img" aria-label="The agent investigates five records; A-102 does not match its line items">
          {REC.map((_, i) => <Edge key={i} i={i} p={p} />)}
          <circle cx={AX} cy={AY} r="34" fill="var(--color-canvas)" stroke="var(--color-signal)" strokeWidth="1.5" />
          <text x={AX} y={AY - 2} textAnchor="middle" className="fill-text text-[12px] font-semibold">Local</text>
          <text x={AX} y={AY + 13} textAnchor="middle" className="fill-text text-[12px] font-semibold">agent</text>
          {REC.map((_, i) => <RecordNode key={i} i={i} p={p} />)}
        </svg>
        <motion.div style={{ opacity: finding, x: findingX }} className="absolute top-[30%] right-[24%] rounded-md border border-warn/60 bg-canvas px-2.5 py-1.5 text-meta text-warn">
          total 18.00, lines say 17.40
        </motion.div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <motion.div style={{ opacity: ev1, y: ev1y }} className="rounded-lg border border-line bg-surface p-3">
          <p className="flex items-center gap-1.5 text-meta text-text"><ShieldCheck size={13} className="text-text-2" />Trusted evidence</p>
          <p className="mt-1 font-mono text-[0.75rem] text-text-2">line_export: 600, 540, 600 at scale 100</p>
        </motion.div>
        <motion.div style={{ opacity: ev2, y: ev2y }} className="rounded-lg border border-line bg-surface p-3">
          <p className="text-meta text-text-3">Untrusted, ignored</p>
          <p className="mt-1 font-mono text-[0.75rem] text-text-3 line-through">operator_note: "looked high"</p>
        </motion.div>
      </div>
    </div>
  );
}

export { SceneCompile } from "./SceneCompile";

// ---- Act 4: the branching first solve collapses into one straight, verified path. --------------------------
const BRANCH = [[40, 70], [120, 30], [120, 110], [200, 20], [200, 70], [200, 130], [280, 50], [280, 110], [360, 70]] as const;
const BRANCH_EDGES = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [2, 5], [4, 6], [5, 7], [6, 8], [7, 8], [3, 6]] as const;
const PATH = ["Match", "Run skill", "Approve", "Verify"];

export function SceneReuse({ p }: { p: MotionValue<number> }) {
  const dim = useTransform(p, [0.25, 0.6], [1, 0.3]);
  const draw = useTransform(p, [0.35, 0.8], [0, 1]);
  const pathO = useTransform(p, [0.3, 0.45], [0, 1]);
  return (
    <div className="w-full max-w-xl space-y-6">
      <div>
        <p className="mb-2 flex justify-between text-meta"><span className="text-text-2">First time: the model reasons it out</span><span className="text-text-3">model calls (time not measured here)</span></p>
        <motion.svg style={{ opacity: dim }} viewBox="0 0 400 150" className="w-full" aria-hidden>
          {BRANCH_EDGES.map(([a, b]) => <line key={`${a}-${b}`} x1={BRANCH[a][0]} y1={BRANCH[a][1]} x2={BRANCH[b][0]} y2={BRANCH[b][1]} stroke="var(--color-signal)" strokeOpacity="0.4" />)}
          {BRANCH.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="7" fill="var(--color-canvas)" stroke="var(--color-signal)" strokeOpacity="0.8" />)}
        </motion.svg>
      </div>
      <motion.div style={{ opacity: pathO }}>
        <p className="mb-2 flex justify-between text-meta"><span className="text-text-2">Next time: the learned skill</span><span className="text-verified">no model calls</span></p>
        <svg viewBox="0 0 400 60" className="w-full" aria-hidden>
          <line x1="40" y1="30" x2="360" y2="30" stroke="var(--color-line-strong)" />
          <motion.line x1="40" y1="30" x2="360" y2="30" stroke="var(--color-verified)" strokeWidth="1.5" style={{ pathLength: draw }} />
          {PATH.map((label, i) => (
            <g key={label}>
              <circle cx={40 + i * (320 / 3)} cy="30" r="8" fill="var(--color-canvas)" stroke="var(--color-verified)" />
              <text x={40 + i * (320 / 3)} y="56" textAnchor="middle" className="fill-text-2 text-[11px]">{label}</text>
            </g>
          ))}
        </svg>
      </motion.div>
      <p className="text-meta text-text-3">Illustration. Measured numbers appear only in the console, and only from runs that actually happened.</p>
    </div>
  );
}

export function SceneProduct({ p }: { p: MotionValue<number> }) {
  const scale = useTransform(p, [0, 0.7], [0.9, 1]);
  return (
    <motion.div style={{ scale }} className="w-full max-w-lg overflow-hidden rounded-[var(--radius-stage)] border border-line-strong bg-surface" aria-hidden>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-meta">
        <span className="size-1.5 rounded-full bg-text-2" /><span className="text-text-3">Model</span><span className="text-text-2">local</span>
      </div>
      <div className="grid grid-cols-[1fr_9rem]">
        <div className="space-y-2 p-4">
          {["read_records", "investigate", "propose_action"].map((s) => <div key={s} className="rounded-md bg-surface-2 px-3 py-2 font-mono text-meta text-text-2">{s}</div>)}
          <div className="rounded-md border border-warn/50 px-3 py-2 text-meta text-warn">Waiting for you</div>
        </div>
        <div className="border-l border-line p-3 text-meta text-text-2">Approve this change?<div className="mt-3 grid h-7 place-items-center rounded bg-text text-[0.75rem] font-medium text-canvas">Approve</div></div>
      </div>
    </motion.div>
  );
}
