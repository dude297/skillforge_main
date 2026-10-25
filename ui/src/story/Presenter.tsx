// Judge presenter mode (#/demo): seven beats for the 90-second pitch. Keyboard: → / Space next, ← back, N notes.
// Every beat says what it is; illustrations are never presented as a live or recorded run.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, motionValue } from "motion/react";
import { ChevronLeft, ChevronRight, NotebookText } from "lucide-react";
import type { ProductConfig } from "../config/product";
import { SceneInvestigate, SceneProblem, SceneReuse } from "./scenes";
import { SceneCompile } from "./SceneCompile";
import { HeroPreview } from "./HeroPreview";
import { useT } from "../lib/motion";
import { SceneNav } from "../components/SceneNav";
import { provenance, RealApproval, RealCompare, RealSkill, useRealRun, type RealRun } from "./realBeats";

const END = motionValue(1);
const PITCH_S = 90;

type Beat = { title: string; short: string; body: string; visual: React.ReactNode; note: string; provenance: string };

const beats = (product: ProductConfig, real: RealRun | null): Beat[] => withReal([
  { title: product.story.problem, short: "Problem", body: product.story.problemDetail, visual: <SceneProblem p={END} product={product} />, provenance: "Illustration",
    note: "Open with the pain: discrepancies are fixed by hand, again and again, and the data is too sensitive for a cloud model." },
  { title: "Nothing leaves this machine.", short: "Local", body: "The model, the data and the verifier are designed to run on one Dell GB10, with no cloud model anywhere. In the full agent setup, the agent's sandbox can reach one host endpoint and nothing else.", visual: <LocalDiagram />, provenance: "Architecture (design)",
    note: "Why local: confidentiality plus control. Say plainly what has run on the GB10 today; the NemoClaw/OpenShell boundary applies to the agent path, not the OnCall script." },
  { title: "The agent investigates.", short: "Investigate", body: product.story.investigate, visual: <SceneInvestigate p={END} />, provenance: "Illustration",
    note: "Point at the trusted evidence and the ignored untrusted note. The agent proposes one bounded fix and stops." },
  { title: "A person approves. Code verifies.", short: "Approve", body: "Nobody wrote a rule for this, so a script can't do it. The agent handles what's new; a person approves, independent code checks the result, and the agent can't approve its own work.", visual: <ApprovalCard />, provenance: "Illustration",
    note: "This is why it isn't just automation: the agent handles the unfamiliar part; approval and verification stay deterministic." },
  { title: "Experience becomes a skill.", short: "Skill", body: product.story.compile, visual: <SceneCompile p={END} />, provenance: "Illustration",
    note: "The centrepiece. The model writes the program and its tests; hidden tests it never saw decide; a person promotes it. If asked about trust, open Console > Skills: versions, refusal and failure counts, rollback." },
  { title: "The next one needs no model call.", short: "Reuse", body: product.story.reuse, visual: <SceneReuse p={END} />, provenance: "Example values",
    note: "Say clearly that these are example values. Then open the console and show the measured benchmark if Gate 5 ran." },
  { title: "Now watch it run.", short: "Console", body: product.story.product, visual: <HeroPreview instant />, provenance: "Illustration",
    note: "Switch to the console. Live if the GB10 is up; otherwise the recorded run, labelled as recorded." },
], real);

/** When this machine has a real learn -> reuse pair, beats 4-6 show it instead of the illustrations, labelled. */
function withReal(list: Beat[], real: RealRun | null): Beat[] {
  if (!real) return list;
  const p = provenance(real);
  const mockNote = real.mock ? " These records come from the scripted mock agent: say so; the backend, approvals and verifier are real." : "";
  return list.map((b, k) =>
    k === 3 ? { ...b, visual: <RealApproval r={real} />, provenance: p, note: b.note + mockNote }
    : k === 4 ? { ...b, visual: <RealSkill r={real} />, provenance: p, note: b.note + mockNote }
    : k === 5 ? { ...b, visual: <RealCompare r={real} />, provenance: p, note: real.mock
        ? "These are this system's records from the mock agent: the model-call comparison is 'not measured' by design. Real numbers come from Gate 5 on the GB10." : b.note.replace("Say clearly that these are example values. ", "") }
    : b);
}

export function Presenter({ product }: { product: ProductConfig }) {
  const real = useRealRun();
  const list = useMemo(() => beats(product, real), [product, real]);
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState(false);
  const tr = useT("major");
  const focusNext = useRef(false); // a beat you step to moves focus to its heading
  const to = useCallback((k: number) => { focusNext.current = true; setI(Math.min(list.length - 1, Math.max(0, k))); }, [list.length]);
  const go = useCallback((d: number) => { focusNext.current = true; setI((x) => Math.min(list.length - 1, Math.max(0, x + d))); }, [list.length]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // keys belong to the focused control (Space presses a button) and never hijack browser shortcuts
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // the bar's own buttons keep Space/Enter (they press themselves) but not the arrows and N, so a mouse click never strands the keyboard
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (t?.closest("button, a") && !(t.closest("[data-demo-controls]") && e.key !== " " && e.key !== "Enter")) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      if (e.key.toLowerCase() === "n") setNotes((v) => !v);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [go]);

  const beat = list[i];
  return (
    <main id="main" tabIndex={-1} className="flex min-h-[calc(100dvh-var(--header-h,3.5rem))] flex-col">
      <div className="mx-auto grid w-full max-w-[88rem] flex-1 items-center gap-12 px-5 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:px-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={tr}
            ref={(el: HTMLElement | null) => { if (el && focusNext.current) { focusNext.current = false; el.querySelector<HTMLElement>("#beat-h")?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); } }}
            aria-labelledby="beat-h" className="space-y-5">
            <p className="tnum text-meta text-text-3">{i + 1} of {list.length}</p>
            <h1 id="beat-h" tabIndex={-1} className="scroll-mt-[calc(var(--header-h,3.5rem)+1rem)] text-h2 leading-[1.05] lg:text-h1 font-semibold tracking-[-0.03em] text-balance">{beat.title}</h1>
            <p className="max-w-[36rem] text-lead leading-relaxed text-text-2">{beat.body}</p>
            {i === list.length - 1 ? <a href="#/console/investigations" className="btn btn-primary h-12 px-6">Open the console</a> : null}
          </motion.section>
        </AnimatePresence>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tr}
            className="hairline-grid relative grid min-h-[22rem] place-items-center rounded-[var(--radius-stage)] border border-line p-5 pt-12 sm:p-8 sm:pt-12">
            <span className="absolute top-3 right-3 rounded-[var(--radius-chip)] border border-line px-2 py-0.5 text-meta text-text-3">{beat.provenance}</span>
            {beat.visual}
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="sr-only" aria-live="polite">{`Beat ${i + 1} of ${list.length}: ${beat.title}`}</p>
      {notes ? <p role="note" className="mx-auto mb-2 w-full max-w-[88rem] px-5 text-text-2 lg:px-10"><span className="text-text-3">Notes: </span>{beat.note}</p> : null}
      <div data-demo-controls className="sticky bottom-0 z-20 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-[88rem] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:px-5 lg:px-10">
          <button type="button" className="btn btn-quiet size-11 justify-center px-0 md:size-10" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous beat"><ChevronLeft aria-hidden size={18} /></button>
          <button type="button" className="btn btn-primary size-11 justify-center px-0 md:size-10" onClick={() => go(1)} disabled={i === list.length - 1} aria-label="Next beat"><ChevronRight aria-hidden size={18} /></button>
          <SceneNav label="Beats" prefix="Beat" items={list} index={i} onSelect={to} className="order-last w-full md:order-none md:w-auto md:min-w-0 md:flex-1" />
          <p className="hidden text-meta text-text-3 xl:block">Arrows step, N shows notes</p>
          <Clock />
          <button type="button" className={`btn btn-quiet ml-auto h-11 px-3 md:ml-0 md:h-10 ${notes ? "border-text-3" : ""}`} onClick={() => setNotes((v) => !v)} aria-pressed={notes}>
            <NotebookText aria-hidden size={16} />Notes
          </button>
        </div>
      </div>
    </main>
  );
}

function LocalDiagram() {
  const box = "rounded-lg border border-line bg-surface px-3 py-2 text-meta";
  return (
    <div className="w-full max-w-md space-y-3" aria-label="Everything runs on one local machine">
      <p className="text-meta text-text-3">Dell Pro Max GB10</p>
      <div className="rounded-[var(--radius-panel)] border border-line-strong p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2 rounded-lg border border-signal/50 p-3">
            <p className="text-meta text-signal">OpenShell sandbox</p>
            <div className={box}>Agent (OpenClaw)</div>
            <div className={box}>records-ops client</div>
          </div>
          <div className="space-y-2 p-3">
            <p className="text-meta text-text-3">Host</p>
            <div className={box}>Local model (vLLM)</div>
            <div className={box}>Tool service + database</div>
            <div className={box}>Verifier + hidden tests</div>
          </div>
        </div>
        <p className="mt-3 text-meta text-text-2">One allowed route: POST /call to the host. No cloud fallback.</p>
      </div>
    </div>
  );
}

function ApprovalCard() {
  return (
    <div className="w-full max-w-md space-y-3">
      <div className="rounded-[var(--radius-panel)] border border-warn/60 bg-surface p-4">
        <p className="font-semibold">Approve this change?</p>
        <p className="mt-2 tnum text-text-2">A-102 total <span className="line-through">18.00</span> to <span className="font-semibold text-text">17.40</span></p>
        <p className="mt-3 text-meta text-warn">Approved by Dana on the host</p>
      </div>
      <div className="rounded-[var(--radius-panel)] border border-verified/60 bg-surface p-4">
        <p className="font-semibold text-verified">Verified: 4 of 4 checks</p>
        <p className="mt-1 text-meta text-text-2">Execution recorded, target value present, no remaining discrepancy, invariants hold.</p>
      </div>
    </div>
  );
}

/** 1 Hz elapsed clock in its own component, so the beat visuals don't re-render every second. */
function Clock() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.floor((now - start) / 1000);
  return (
    <span className={`tnum text-meta ${s > PITCH_S ? "text-warn" : "text-text-3"}`} aria-label="Elapsed time">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")} of 1:30
    </span>
  );
}
