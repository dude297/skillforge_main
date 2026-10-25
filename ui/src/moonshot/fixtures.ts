// Explicitly labelled non-evidence: the ILLUSTRATION graph (example integrations that do NOT exist) and the CONCEPTUAL
// baseline path. Nothing here is ever merged into the recorded/live graph.
import { BEATS, type BeatId, type MoonshotGraph, type MoonshotNode, type Provenance } from "./types";

const ill: Provenance = { kind: "illustration", label: "Example only: not connected, not built" };
const future = (id: string, label: string, summary: string): MoonshotNode => ({
  id, kind: "source", label, sublabel: "future integration", summary, provenance: ill, evidenceIds: [],
  steps: [{ at: "bootstrap", state: "unavailable", label: "Example only" }],
  facts: [["Status", "Not implemented. SkillForge reads an allowlisted ops dataset only, not general Git, chat or ERP systems."]],
  permissions: ["None. This node grants and implies nothing"],
});

export function illustrationGraph(): MoonshotGraph {
  const nodes: MoonshotNode[] = [
    { id: "ember", kind: "ember", label: "Ember", sublabel: "SkillForge agent", summary: "The same Ember, shown with example integrations.", provenance: ill, evidenceIds: [], steps: [{ at: "bootstrap", state: "active", label: "Idle" }], facts: [], permissions: ["No approval authority"] },
    { id: "plinth", kind: "bootstrap", label: "Workspace host", sublabel: "example", summary: "Example plinth.", provenance: ill, evidenceIds: [], steps: [{ at: "bootstrap", state: "configured" }], facts: [], permissions: [] },
    future("ill:git", "Git repository", "Example of a possible future read-only repo adapter."),
    future("ill:chat", "Team chat", "Example of a possible future integration. No chat connector exists."),
    future("ill:erp", "ERP", "Example of a possible future integration. No ERP connector exists."),
  ];
  const edge = (id: string, from: string, to: string) => ({
    id, from, to, kind: "proposed" as const, relation: "Example connection (illustration)", provenance: ill, evidenceIds: [],
    steps: [{ at: "bootstrap" as BeatId, state: "unavailable" as const, label: "Example only" }], humanApprovalRequired: null, independentlyVerified: null,
    modelCalls: null, latencyMs: null, improvementPct: null, facts: [] as [string, string][],
  });
  return {
    mode: "illustration", modeLabel: "ILLUSTRATION", banner: "Illustration: example integrations that are NOT built or connected. Separate from the recorded run.",
    workspaceId: null, lastUpdated: null, nodes,
    edges: [edge("edge:plinth-ember", "plinth", "ember"), edge("edge:ill-git", "ember", "ill:git"), edge("edge:ill-chat", "ember", "ill:chat"), edge("edge:ill-erp", "ember", "ill:erp")],
    evidence: {},
    beats: BEATS.map((id, i) => ({ id, title: id, caption: i === 0 ? "Illustration only." : "Locked in illustration mode.", source: "none", unlocked: i === 0, gate: false, lockedReason: i === 0 ? null : "Illustration has no replay" })),
    emberByBeat: Object.fromEntries(BEATS.map((b) => [b, "idle"])) as MoonshotGraph["emberByBeat"],
    truth: { referenceSkill: false, approvalSimulated: false, approvalPending: false, modelCalls: null, reuseDone: false, refused: false },
  };
}

/** Conceptual path without the skill: not measured, not a recorded trace. */
export const BASELINE_STEPS = ["Incident detected", "Unfamiliar incident", "Model investigation", "Diagnosis and action proposal", "Human approves", "Execute once", "Independently verify"];
/** The proposed path; the matching flags say which baseline step it removes or retains. */
export const COMPARE: { step: string; before: string | null; after: string | null; change: "retained" | "removed" | "replaced" }[] = [
  { step: "Detect", before: "Incident detected", after: "Incident detected", change: "retained" },
  { step: "Recognise", before: "Unfamiliar incident", after: "Exact fingerprint match against an approved skill", change: "replaced" },
  { step: "Investigate", before: "Model investigation", after: null, change: "removed" },
  { step: "Propose", before: "Diagnosis and action proposal", after: "Approved versioned skill proposes a bounded action", change: "replaced" },
  { step: "Approve", before: "Human approves", after: "Action approval / policy (still required)", change: "retained" },
  { step: "Act", before: "Execute once", after: "Execute once", change: "retained" },
  { step: "Verify", before: "Independently verify", after: "Independently verify (re-read)", change: "retained" },
];
