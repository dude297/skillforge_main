// Ember's Living System: projection types. A read-only view over recorded/live data. Nothing here grants a permission,
// and provenance is a separate field from permissions on purpose. Unknown values are null ("Not measured"), never 0.
export type Provenance =
  | { kind: "live"; source: string; observedAt: string | null }
  | { kind: "recorded"; artifact: string; capturedAt: string | null }
  | { kind: "illustration"; label: string };

export type NodeKind = "ember" | "bootstrap" | "source" | "service" | "incident" | "workflow" | "skill" | "verifier" | "human_gate" | "router" | "refusal";

export type NodeState =
  | "discovered" | "configured" | "active" | "unknown" | "proposed" | "testing" | "tested" | "failed"
  | "awaiting_approval" | "approved" | "approved_simulated" | "applied_unverified" | "verified" | "refused" | "stale" | "unavailable";

export type EdgeKind = "observed" | "proposed" | "skill_reuse" | "blocked";

/** The replay beats, in order. Each is skippable, steppable and replayable. */
export const BEATS = ["bootstrap", "explore", "propose", "test", "approval", "reuse", "refuse"] as const;
export type BeatId = (typeof BEATS)[number];
export const beatIndex = (b: BeatId) => BEATS.indexOf(b);

/** One row of an item's history: from this beat on (until the next row) it is in `state`. Before its first row it does not exist yet. */
export interface Step { at: BeatId; state: NodeState; label?: string }

export interface Evidence { id: string; type: string; source: string; description: string; at?: string | null }

export interface MoonshotNode {
  id: string;
  kind: NodeKind;
  label: string;
  sublabel?: string;
  summary: string;
  provenance: Provenance;
  evidenceIds: string[];
  steps: Step[];
  facts: [string, string][];          // inspector rows, already plain text
  permissions: string[];              // what this node is allowed to do (plain statements); never inferred from provenance
}

export interface MoonshotEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  relation: string;
  provenance: Provenance;
  evidenceIds: string[];
  steps: Step[];
  humanApprovalRequired: boolean | null;
  independentlyVerified: boolean | null;
  modelCalls: number | null;
  latencyMs: number | null;
  improvementPct: number | null;      // only with comparable runs
  reason?: string;
  primary?: boolean;
  label?: boolean;                    // always draw the text label (important edges)
  facts: [string, string][];
}

export interface BeatInfo { id: BeatId; title: string; caption: string; source: string; unlocked: boolean; gate: boolean; lockedReason: string | null }

export interface MoonshotGraph {
  mode: "live" | "recorded" | "illustration" | "unavailable";
  modeLabel: "LIVE LOCAL" | "RECORDED SIMULATION" | "ILLUSTRATION" | "UNAVAILABLE";
  banner: string;
  workspaceId: string | null;
  lastUpdated: string | null;
  nodes: MoonshotNode[];
  edges: MoonshotEdge[];
  evidence: Record<string, Evidence>;
  beats: BeatInfo[];
  emberByBeat: Record<BeatId, "idle" | "investigating" | "building" | "verifying" | "verified" | "waiting" | "error">;
  /** run-level truths the UI repeats everywhere they matter */
  truth: { referenceSkill: boolean; approvalSimulated: boolean; approvalPending: boolean; modelCalls: number | null; reuseDone: boolean; refused: boolean };
}

export interface Resolved<T> { item: T; state: NodeState; label: string | null; at: BeatId }

/** Status text for every state. Shape + text, never colour alone. */
export const STATE_TEXT: Record<NodeState, string> = {
  discovered: "Discovered", configured: "Configured", active: "Active", unknown: "Unknown", proposed: "Suggested only",
  testing: "Testing", tested: "Tests passed", failed: "Tests failed", awaiting_approval: "Awaiting host approval",
  approved: "Approved", approved_simulated: "Approved (SIMULATED)", applied_unverified: "Applied; checking",
  verified: "Verified", refused: "Refused", stale: "Stale", unavailable: "Unavailable",
};

export const MAX_TEXT = 220;
/** Untrusted text from artifacts: plain string, capped, control characters stripped. React renders it as text, never markup. */
export const clean = (v: unknown, max = MAX_TEXT): string => {
  if (v == null) return "Not measured";
  const s = (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v)).split("").map((ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10 && c !== 9) || c === 127 ? " " : ch; }).join("");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
