// SYNTHETIC preview data for the Skills and History sections. Shapes follow skillforge.list_skills() and the
// tasks table; values are illustrative. The console status bar always shows the Preview source while they are on screen.
import modelsJson from "../../../data/models.json";

export interface SkillVersion {
  version: number;
  status: "approved" | "tested" | "failed_tests" | "rejected" | "disabled" | "rolled_back" | "not_retained";
  active: boolean;
  decidedBy: string | null;
  hiddenOk: boolean | null;
  sha256: string;
  parent: number | null;
  note: string;
  runs: { ok: number; refused: number; error: number; verifiedPass: number; verifiedFail: number };
}

export interface SkillEntry { name: string; description: string; touches: string[]; versions: SkillVersion[] }

export const SKILLS: SkillEntry[] = [
  {
    name: "line-total-reconcile",
    description: "Recompute a record total from trusted line items and scale; propose a fix when they disagree.",
    touches: ["total"],
    versions: [
      { version: 1, status: "approved", active: false, decidedBy: "Dana", hiddenOk: true, sha256: "41506b7c7fdec463", parent: null,
        note: "Learned from Totals check, batch A", runs: { ok: 6, refused: 2, error: 0, verifiedPass: 9, verifiedFail: 1 } },
      { version: 2, status: "approved", active: true, decidedBy: "Dana", hiddenOk: true, sha256: "9c03e1aa52b7d0f4", parent: 1,
        note: "One bounded optimisation: index records once (profile recommended it; retained)", runs: { ok: 3, refused: 0, error: 0, verifiedPass: 5, verifiedFail: 0 } },
    ],
  },
  {
    name: "unit-price-rounding",
    description: "Round unit prices half-up to cents where the export used floating point.",
    touches: ["unit_price"],
    versions: [
      { version: 1, status: "failed_tests", active: false, decidedBy: null, hiddenOk: null, sha256: "e81b7f0c2d6a9935", parent: null,
        note: "Its own tests failed: rounded half-even", runs: { ok: 0, refused: 0, error: 0, verifiedPass: 0, verifiedFail: 0 } },
      { version: 2, status: "tested", active: false, decidedBy: null, hiddenOk: null, sha256: "5f2d93c1b0a8e774", parent: null,
        note: "Waiting for a person: hidden tests run on promotion", runs: { ok: 0, refused: 0, error: 0, verifiedPass: 0, verifiedFail: 0 } },
    ],
  },
];

export interface HistoryRun {
  id: number;
  title: string;
  path: "agent" | "skill" | "escalated";
  outcome: "verified" | "needs_review" | "rejected" | "escalated" | "open" | "aborted" | "no_change" | "unverified" | "partial";
  when: string;
  modelCalls: number | null;
  seconds: number | null;
  /** a deterministic skill ran it: no model and no agent (router fast path) */
  deterministic?: boolean;
  /** a scripted mock agent produced this run: its numbers measure plumbing, not a model */
  mock?: boolean;
}

export const HISTORY: HistoryRun[] = [
  { id: 14, title: "Totals check, batch B", path: "skill", outcome: "verified", when: "09:41", modelCalls: 0, seconds: 0.4 },
  { id: 13, title: "Totals check, batch A", path: "agent", outcome: "verified", when: "09:12", modelCalls: 14, seconds: 41.2 },
  { id: 12, title: "Lookalike export, shipping", path: "agent", outcome: "verified", when: "08:55", modelCalls: 11, seconds: 33.0 },
  { id: 11, title: "Totals check, late batch", path: "skill", outcome: "needs_review", when: "08:30", modelCalls: 0, seconds: 0.5 },
  { id: 10, title: "Unfamiliar export (model offline)", path: "escalated", outcome: "escalated", when: "08:02", modelCalls: null, seconds: null },
];

/** The REAL registry file from the backend repo (data/models.json), bundled at build time. */
export interface RegistryModel {
  id: string; role: string; nemoclaw_profile: string; max_model_len: number; tool_parser: string;
  storage_gb: number; constraints: string[]; validation: { status: string };
}
export const MODEL_REGISTRY = modelsJson as unknown as { required_for_learning: string[]; models: RegistryModel[] };
