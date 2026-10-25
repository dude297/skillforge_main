// UI data contract. Shapes mirror what the SkillForge backend already produces (app/ops.py status(),
// skillforge.list_skills(), bench result.json). The proposed read-only HTTP surface is in ui/CONTRACT.md.

/** Where the numbers on screen come from. Always rendered; never inferred. */
export type Source = "live" | "recorded" | "synthetic";

export type Health = { ok: boolean | null; detail: string };

export interface SystemStatus {
  inference: Health & { model: string | null; learning_allowed?: boolean };
  sandbox: Health;
  host_service: Health;
  db: { quick_check: string };
  next_actions: string[];
}

export type StepState = "queued" | "running" | "done" | "failed" | "waiting" | "skipped";
export type StepKind = "tool" | "human" | "verify" | "skill";

export interface Step {
  id: string;
  kind: StepKind;
  title: string;
  /** exact machine text (tool name + args): rendered in mono */
  call?: string;
  result?: string;
  state: StepState;
  ms?: number | null;
}

export interface ProposedFix {
  actionId: number;
  /** live only: what the action changes, hashed; makes the copied approve command refuse anything else */
  fingerprint?: string;
  record: string;
  field: string;
  from: string;
  to: string;
  reason: string;
  evidence: { source: string; trusted: boolean; summary: string }[];
}

export interface SkillArtifact {
  name: string;
  version: number;
  status: "drafting" | "testing" | "awaiting_promotion" | "approved" | "approved_inactive" | "failed" | "not_in_use";
  sha256: string | null;
  /** counts when the backend reports them, a verdict when it reports only that, null = not run */
  selfTests: { passed: number; total: number } | boolean | null;
  hidden: { passed: number; total: number } | boolean | null;
  code: string;
  /** file the code came from (the live view shows the real helper; the preview shows sample code) */
  codeFile?: string;
}

/** One row of bench summary (app/bench.py summarize). null = not measured (never 0). */
export interface BenchRow {
  case: string;
  mode: "A" | "B" | "C";
  n: number;
  correct: string;
  decision: string;
  median_s: number | null;
  model_calls: number | null;
  tool_calls: number | null;
}

export interface Compare {
  source: Source;
  label: string;
  /** what the seconds row measures; default "Automated time" (bench: human approval time excluded) */
  secondsLabel?: string;
  rows: { mode: string; title: string; model_calls: number | null; seconds: number | null; tool_calls: number | null }[];
}
