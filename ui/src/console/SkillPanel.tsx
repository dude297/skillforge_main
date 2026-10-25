import { motion } from "motion/react";
import { Fingerprint } from "lucide-react";
import type { SkillArtifact } from "../data/types";
import { promoteCommand } from "../data/live";
import { CopyCommand } from "../components/CopyCommand";
import { useT } from "../lib/motion";

const STATUS: Record<SkillArtifact["status"], { text: string; cls: string }> = {
  drafting: { text: "Drafting", cls: "text-signal" },
  testing: { text: "Running its own tests", cls: "text-signal" },
  awaiting_promotion: { text: "Waiting for a person to promote it", cls: "text-warn" },
  approved: { text: "Approved and active", cls: "text-verified" },
  approved_inactive: { text: "Approved, not the active version", cls: "text-text-2" },
  failed: { text: "Failed its own tests", cls: "text-fail" },
  not_in_use: { text: "Not in use", cls: "text-text-3" },
};

function Gate({ label, value }: { label: string; value: SkillArtifact["hidden"] }) {
  const ok = typeof value === "boolean" ? value : value && value.passed === value.total;
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-meta text-text-3">{label}</p>
      <p className={`tnum font-semibold ${value != null ? (ok ? "text-verified" : "text-fail") : "text-text-3"}`}>
        {value == null ? "Not run yet" : typeof value === "boolean" ? (value ? "Passed" : "Failed") : `${value.passed} of ${value.total} passed`}
      </p>
    </div>
  );
}

export function SkillPanel({ skill, onPromote }: { skill: SkillArtifact; onPromote?: () => void }) {
  const tr = useT("major");
  const approved = skill.status === "approved";
  return (
    <section aria-labelledby="skill-h" className="space-y-4">
      <header>
        <p className={`text-meta font-medium ${STATUS[skill.status].cls}`}>{STATUS[skill.status].text}</p>
        <h2 id="skill-h" className="text-lead font-semibold">
          {skill.name} <span className="font-normal text-text-3">v{skill.version}</span>
        </h2>
      </header>

      {/* the artifact: its border turns green only once the hidden suite has passed AND a person approved it */}
      <motion.div
        animate={{ borderColor: approved ? "var(--color-verified)" : "var(--color-line)" }}
        transition={tr}
        className="overflow-hidden rounded-[var(--radius-panel)] border bg-canvas"
      >
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-meta">
          <span className="font-mono text-text-2">{skill.codeFile ?? "scripts/helper.py"}</span>
          <span className="flex items-center gap-1.5 font-mono text-text-3">
            <Fingerprint aria-hidden size={13} />
            {skill.sha256 ? `locked version ${skill.sha256}` : "not locked yet"}
          </span>
        </div>
        <pre tabIndex={0} role="region" aria-label="Skill source code" className="max-h-64 overflow-y-auto p-3 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap text-text-2">{skill.code}</pre>
      </motion.div>

      <div className="grid grid-cols-2 gap-2">
        <Gate label="Its own tests" value={skill.selfTests} />
        <Gate label="Hidden tests (agent never sees them)" value={skill.hidden} />
      </div>

      {skill.status === "awaiting_promotion" && onPromote ? (
        <div className="space-y-2">
          <button type="button" data-autofocus className="btn btn-primary" onClick={onPromote}>Promote skill</button>
          <p className="text-meta text-text-3">
            Preview only. On a real system: <code className="font-mono text-text-2">{promoteCommand(skill.name, skill.version)}</code>
          </p>
        </div>
      ) : skill.status === "awaiting_promotion" ? (
        <CopyCommand label="Promote on the host (runs the hidden tests first):" cmd={promoteCommand(skill.name, skill.version)} />
      ) : null}
    </section>
  );
}
