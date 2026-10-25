// Live API rows -> the shapes the existing console sections render. Pure mapping: no values are invented; anything
// the backend didn't measure stays null and renders as "not measured".
import type { LiveSkill, LiveTask } from "./live";
import type { HistoryRun, SkillEntry } from "./registry";

export function skillEntries(skills: LiveSkill[]): SkillEntry[] {
  const by = new Map<string, LiveSkill[]>();
  for (const s of skills) by.set(s.name, [...(by.get(s.name) ?? []), s]);
  return [...by.entries()].map(([name, vs]) => {
    const latest = vs[vs.length - 1];
    return {
      name, description: latest.description, touches: latest.touches,
      versions: vs.map((v) => ({
        version: v.version, status: v.status as SkillEntry["versions"][number]["status"], active: v.active, decidedBy: v.decided_by,
        hiddenOk: v.hidden_ok, sha256: v.sha256, parent: v.parent_version,
        note: [
          v.source_task != null ? `Learned from task ${v.source_task}` : null,
          v.validation.lint_errors ? `${v.validation.lint_errors} lint error(s)` : null,
          v.validation.own_tests_ok == null ? null : v.validation.own_tests_ok ? "its own tests passed" : "its own tests failed",
          v.validation.replay_ok == null ? null : v.validation.replay_ok ? "replay matched the verified fixes" : "replay did not match",
        ].filter(Boolean).join("; "),
        runs: { ok: v.runs.ok, refused: v.runs.refused, error: v.runs.error, verifiedPass: v.runs.verified_pass, verifiedFail: v.runs.verified_fail },
      })),
    };
  });
}

export function historyRuns(tasks: LiveTask[]): HistoryRun[] {
  return tasks.map((t) => ({
    id: t.id, title: t.label,
    // a routed (deterministic) task is a skill run from its first event; skills_used only fills in as it runs
    path: t.skills_used.length || t.mode === "deterministic" ? "skill" : "agent",
    outcome: t.status === "open" ? "open" : t.status === "aborted" ? "aborted" : t.success ? "verified"
      : (t.verifications_failed ?? 0) > 0 ? "needs_review"
      : (t.actions_executed ?? 0) > 0 && (t.verifications_passed ?? 0) === t.actions_executed && (t.invariant_violations ?? 0) > 0
        ? "partial"  // every applied change verified, but some records still need a person
      : (t.actions_executed ?? 0) > 0 ? "unverified"
      : (t.invariant_violations ?? 0) > 0 ? "escalated" : "no_change",  // nothing applied, rule still unmet: a person decides
    when: new Date(t.started_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    modelCalls: t.model_calls, seconds: t.latency_s, mock: t.mode === "mock", deterministic: t.mode === "deterministic",
  }));
}
