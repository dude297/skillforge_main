import { motion } from "motion/react";
import { Check, Fingerprint, Hand, X } from "lucide-react";
import type { SkillArtifact } from "../data/types";
import { promoteCommand } from "../data/live";
import { CopyCommand } from "../components/CopyCommand";
import { useT } from "../lib/motion";

type Gate = SkillArtifact["hidden"];
export type Stage = { key: string; label: string; state: "done" | "current" | "waiting" | "failed" | "pending"; detail: React.ReactNode };

const STATUS: Record<SkillArtifact["status"], { text: string; cls: string }> = {
  drafting: { text: "Drafting", cls: "text-signal" },
  testing: { text: "Running its own tests", cls: "text-signal" },
  awaiting_promotion: { text: "Waiting for a person to promote it", cls: "text-warn" },
  approved: { text: "Approved and active", cls: "text-verified" },
  approved_inactive: { text: "Approved, not the active version", cls: "text-text-2" },
  failed: { text: "Failed its own tests", cls: "text-fail" },
  not_in_use: { text: "Not in use", cls: "text-text-3" },
};

/** A gate's outcome in words. A verdict without counts says so; a gate that has not run is "not run yet", and a gate
 * the backend simply did not report on is "not measured". Never a zero. */
function gateText(v: Gate, later: boolean): { ok: boolean | null; text: string } {
  if (v == null) return { ok: null, text: later ? "Not measured" : "Not run yet" };
  if (typeof v === "boolean") return { ok: v, text: v ? "Passed, case count not measured" : "Failed, case count not measured" };
  return { ok: v.passed === v.total, text: `${v.passed} of ${v.total} passed` };
}

/** drafting -> own tests -> hidden validation -> awaiting promotion -> approved, derived only from the artifact. */
export function stagesOf(s: SkillArtifact): Stage[] {
  const own = gateText(s.selfTests, s.status !== "drafting" && s.status !== "testing");
  const hid = gateText(s.hidden, s.status === "awaiting_promotion" || s.status === "approved" || s.status === "approved_inactive");
  const drafted = s.status !== "drafting";
  const ownDone = own.ok === true, hidDone = hid.ok === true;
  const promoted = s.status === "approved" || s.status === "approved_inactive";
  return [
    { key: "draft", label: "Drafting", state: drafted ? "done" : "current", detail: drafted ? `Code written${s.codeFile ? `: ${s.codeFile}` : ""}` : "Writing the code and its tests" },
    { key: "own", label: "Own tests", state: own.ok === false || s.status === "failed" ? "failed" : ownDone ? "done" : s.status === "testing" ? "current" : "pending", detail: s.status === "failed" && own.ok == null ? "Failed its own tests, case count not measured" : own.text },
    { key: "hidden", label: "Hidden validation", state: hid.ok === false ? "failed" : hidDone ? "done" : ownDone && !promoted ? "current" : "pending",
      detail: <>{hid.text}<span className="text-text-3">. Run on the host; the agent never sees these tests.</span></> },
    { key: "promote", label: promoted ? "Promoted" : "Awaiting promotion", state: promoted ? "done" : s.status === "awaiting_promotion" ? "waiting" : "pending",
      detail: promoted ? "Promoted by a person on the host" : s.status === "awaiting_promotion" ? "A person has to promote it. The skill cannot run until then." : "Only after both test sets pass" },
    { key: "approved", label: "Approved", state: promoted ? "done" : "pending",
      detail: s.status === "approved" ? "Active: it may now run without the model" : s.status === "approved_inactive" ? "Approved, but a different version is active" : "Not approved: it cannot run" },
  ];
}

const NODE: Record<Stage["state"], string> = {
  done: "border-line-strong bg-surface text-text-2",
  current: "border-signal bg-signal/10 text-signal",
  waiting: "border-warn bg-warn/15 text-warn",
  failed: "border-fail bg-fail/10 text-fail",
  pending: "border-dashed border-line-strong text-text-3",
};
const WORD: Record<Stage["state"], string> = { done: "done", current: "in progress", waiting: "needs a person", failed: "failed", pending: "not reached" };

function Lifecycle({ stages, approved }: { stages: Stage[]; approved: boolean }) {
  return (
    <ol aria-label="Skill lifecycle" className="space-y-0">
      {stages.map((st, i) => {
        const last = i === stages.length - 1;
        const verified = last && st.state === "done" && approved;
        return (
          <li key={st.key} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-3 last:pb-0">
            {!last && <span aria-hidden className="absolute top-6 bottom-0 left-[0.6875rem] w-px bg-line" />}
            <span className={`relative z-10 grid size-6 place-items-center rounded-full border ${verified ? "border-verified bg-verified/10 text-verified" : NODE[st.state]}`}>
              {st.state === "done" ? <Check aria-hidden size={13} /> : st.state === "failed" ? <X aria-hidden size={13} /> : st.state === "waiting" ? <Hand aria-hidden size={12} /> : st.state === "current" ? <span aria-hidden className="size-1.5 rounded-full bg-signal" /> : null}
            </span>
            <div className="min-w-0">
              <p className={`font-medium ${st.state === "pending" ? "text-text-3" : "text-text"}`}>{st.label}<span className="sr-only">: {WORD[st.state]}</span></p>
              <p className={`text-meta [overflow-wrap:anywhere] ${st.state === "failed" ? "text-fail" : st.state === "waiting" ? "text-warn" : st.state === "pending" ? "text-text-3" : "text-text-2"}`}>{st.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function SkillPanel({ skill, onPromote }: { skill: SkillArtifact; onPromote?: () => void }) {
  const tr = useT("major");
  const approved = skill.status === "approved";
  const waiting = skill.status === "awaiting_promotion";
  const stages = stagesOf(skill);
  return (
    <section aria-labelledby="skill-h" className="space-y-5">
      <header>
        <p className={`text-meta font-medium ${STATUS[skill.status].cls}`}>{STATUS[skill.status].text}</p>
        <h2 id="skill-h" className="text-lead font-semibold [overflow-wrap:anywhere]">
          {skill.name} <span className="font-normal text-text-3">v{skill.version}</span>
        </h2>
      </header>

      <Lifecycle stages={stages} approved={approved} />

      {/* the artifact: its border turns green only once the hidden suite has passed AND a person approved it */}
      <motion.div
        animate={{ borderColor: approved ? "var(--color-verified)" : waiting ? "color-mix(in oklab, var(--color-warn) 55%, transparent)" : "var(--color-line)" }}
        transition={tr}
        className="overflow-hidden rounded-[var(--radius-panel)] border bg-canvas"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-meta">
          <span className="font-mono text-text-2">{skill.codeFile ?? "scripts/helper.py"}</span>
          {skill.sha256 ? (
            <motion.span key={skill.sha256} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={tr}
              className="flex min-w-0 items-center gap-1.5 font-mono text-text-2 [overflow-wrap:anywhere]">
              <Fingerprint aria-hidden size={13} className={approved ? "text-verified" : "text-text-3"} />sha256 {skill.sha256}
            </motion.span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-text-3"><Fingerprint aria-hidden size={13} />sha256 not locked yet</span>
          )}
        </div>
        <pre tabIndex={0} role="region" aria-label="Skill source code" className="max-h-56 overflow-y-auto p-3 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap text-text-2">{skill.code}</pre>
      </motion.div>

      {waiting ? (
        <div className="space-y-3">
          {onPromote ? (
            <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-3">
              <p className="text-meta text-text-2"><span className="font-medium text-text">Synthetic preview.</span> This button advances the scripted run. It promotes nothing real.</p>
              <button type="button" data-autofocus className="btn btn-primary min-h-11" onClick={onPromote}>Simulate promotion</button>
            </div>
          ) : null}
          <CopyCommand label={onPromote ? "On a real system, promote on the host (runs the hidden tests first):" : "Promote on the host (runs the hidden tests first):"} cmd={promoteCommand(skill.name, skill.version)} />
        </div>
      ) : null}
    </section>
  );
}

const CHIP_TONE: Record<Stage["state"], string> = {
  done: "border-line-strong text-text-2", current: "border-signal/60 text-signal", waiting: "border-warn/60 bg-warn/10 text-warn",
  failed: "border-fail/60 bg-fail/10 text-fail", pending: "border-dashed border-line-strong text-text-3",
};

/** The same lifecycle as one wrapping row of labelled marks, for lists of versions. State is a word, not only a colour. */
export function StageChips({ stages }: { stages: Stage[] }) {
  return (
    <ol aria-label="Skill lifecycle" className="flex flex-wrap gap-1.5">
      {stages.map((st) => (
        <li key={st.key} className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border px-2 py-0.5 text-meta ${CHIP_TONE[st.state]}`}>
          {st.state === "done" ? <Check aria-hidden size={12} /> : st.state === "failed" ? <X aria-hidden size={12} /> : st.state === "waiting" ? <Hand aria-hidden size={12} /> : <span aria-hidden className={`size-1.5 rounded-full ${st.state === "current" ? "bg-signal" : "bg-text-3"}`} />}
          {st.label}<span className="sr-only">: {WORD[st.state]}</span>
        </li>
      ))}
    </ol>
  );
}
