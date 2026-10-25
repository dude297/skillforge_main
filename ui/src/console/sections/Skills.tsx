import { useState } from "react";
import { motion } from "motion/react";
import { Fingerprint, History } from "lucide-react";
import { CopyCommand } from "../../components/CopyCommand";
import type { SkillEntry, SkillVersion } from "../../data/registry";
import type { Source } from "../../data/types";
import { SourceBadge } from "../../components/SourceBadge";
import { useSkillCode } from "../live/LiveInvestigations";
import { disableCommand, promoteCommand, rollbackCommand } from "../../data/live";
import { rise, useT } from "../../lib/motion";

const STATUS: Record<SkillVersion["status"], { text: string; cls: string }> = {
  approved: { text: "Approved", cls: "text-text" },
  tested: { text: "Tested, waiting for a person", cls: "text-warn" },
  failed_tests: { text: "Failed its own tests", cls: "text-fail" },
  rejected: { text: "Rejected", cls: "text-text-3" },
  disabled: { text: "Disabled", cls: "text-text-3" },
  rolled_back: { text: "Rolled back", cls: "text-text-3" },
  not_retained: { text: "Optimisation not retained", cls: "text-text-3" },
};

/** Registry with versions. Rollback and promotion are host commands; the browser cannot change a skill. */
export function Skills({ entries, source }: { entries: SkillEntry[]; source: Source }) {
  const [sel, setSel] = useState<string | null>(null);
  const tr = useT("panel");
  const skill = entries.find((s) => s.name === sel) ?? entries[0];
  const active = skill?.versions.find((v) => v.active);
  const shown = active ?? skill?.versions[skill.versions.length - 1];
  const code = useSkillCode(source === "live" ? skill?.name : undefined, shown?.version);
  if (!skill)
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-8">
        <h1 className="text-lead font-semibold">No skills yet</h1>
        <p className="text-text-2">A skill appears here after the agent turns a verified fix into one. It can't be used until a person promotes it.</p>
      </div>
    );
  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <nav aria-label="Skills" className="border-b border-line p-4 lg:border-r lg:border-b-0">
        <div className="mb-3 flex items-center justify-between gap-2 px-2"><h1 className="text-lead font-semibold">Skills</h1><SourceBadge source={source} /></div>
        <ul className="space-y-1">
          {entries.map((s) => {
            const act = s.versions.find((v) => v.active);
            return (
              <li key={s.name}>
                <button type="button" aria-current={s.name === sel ? "true" : undefined} onClick={() => setSel(s.name)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition-colors duration-150 ${s.name === sel ? "bg-surface-2" : "hover:bg-surface"}`}>
                  <span className="block font-medium">{s.name}</span>
                  <span className={`block text-meta ${act ? "text-text-2" : "text-text-3"}`}>{act ? `Active: v${act.version}` : "No active version"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <motion.section key={skill.name} {...rise} transition={tr} aria-labelledby="skill-detail-h" className="min-w-0 space-y-6 p-6">
        <header className="space-y-2">
          <h2 id="skill-detail-h" className="text-h3 font-semibold tracking-tight">{skill.name}</h2>
          <p className="max-w-prose text-text-2">{skill.description}</p>
          <p className="text-meta text-text-3">May change only: <span className="font-mono text-text-2">{skill.touches.join(", ")}</span></p>
        </header>
        <ol aria-label="Versions" className="relative space-y-3">
          {skill.versions.map((v) => (
            <li key={v.version} className={`panel relative p-4 ${v.active ? "border-line-strong bg-surface-2" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">v{v.version}{v.parent ? <span className="font-normal text-text-3"> optimised from v{v.parent}</span> : null}</p>
                <p className={`text-meta font-medium ${(STATUS[v.status] ?? STATUS.rejected).cls}`}>{v.active ? "Active" : (STATUS[v.status] ?? { text: v.status }).text}{v.decidedBy ? `, by ${v.decidedBy}` : ""}</p>
              </div>
              <p className="mt-1 text-text-2">{v.note}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-meta sm:grid-cols-4">
                <div><dt className="text-text-3">Hidden tests</dt><dd className={v.hiddenOk ? "text-verified" : "text-text-2"}>{v.hiddenOk == null ? "Not run" : v.hiddenOk ? "Passed" : "Failed"}</dd></div>
                <div><dt className="text-text-3">Runs</dt><dd>{v.runs.ok} ok, {v.runs.refused} refused</dd></div>
                <div><dt className="text-text-3">Verified</dt><dd>{v.runs.verifiedPass} passed, {v.runs.verifiedFail} failed</dd></div>
                <div><dt className="text-text-3">Locked version</dt><dd className="flex min-w-0 items-center gap-1 font-mono text-text-2 [overflow-wrap:anywhere]"><Fingerprint aria-hidden size={12} />{v.sha256}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
        {source === "live" && shown ? (
          <section aria-labelledby="code-h" className="space-y-2">
            <h3 id="code-h" className="font-semibold">The code that runs, v{shown.version}</h3>
            <p className="text-meta text-text-3">Exactly the files the hidden tests and the integrity hash cover. Read-only.</p>
            <pre tabIndex={0} role="region" aria-label={`${skill.name} v${shown.version} source`} className="max-h-80 overflow-auto rounded-[var(--radius-panel)] border border-line bg-canvas p-3 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap text-text-2">{code.text ?? "loading…"}</pre>
          </section>
        ) : null}
        <HostCommands name={skill.name} active={active?.version ?? null} pending={skill.versions.find((v) => v.status === "tested")?.version ?? null} />
      </motion.section>
    </div>
  );
}

function HostCommands({ name, active, pending }: { name: string; active: number | null; pending: number | null }) {
  const cmds = [
    pending ? { label: `Promote v${pending} (runs the hidden tests first)`, cmd: promoteCommand(name, pending) } : null,
    active ? { label: "Roll back to the previous approved version", cmd: rollbackCommand(name) } : null,
    active ? { label: "Disable (the agent investigates instead)", cmd: disableCommand(name) } : null,
  ].filter((c): c is { label: string; cmd: string } => c !== null);
  if (!cmds.length) return null;
  return (
    <section aria-labelledby="host-h" className="space-y-2">
      <h3 id="host-h" className="flex items-center gap-2 font-semibold"><History aria-hidden size={16} className="text-text-3" />Change this skill on the host</h3>
      <p className="text-meta text-text-3">Promotion, rollback and disabling are deliberate host actions. The console only shows the command.</p>
      <ul className="space-y-2">
        {cmds.map((c) => (
          <li key={c.cmd}><CopyCommand label={c.label} cmd={c.cmd} /></li>
        ))}
      </ul>
    </section>
  );
}
