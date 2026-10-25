// ILLUSTRATION ONLY: nothing here is read from, or connected to, a real system.
// Field names follow the read-only manifest of experiments/router/bootstrap.py (branch exp/router): environment,
// tool_inventory, required_permissions, missing_skill_opportunities. A future Bootstrap Lite can feed a real manifest
// into the same view; until then these are example values, and the page says so.
// The connection statuses are deliberately the TRUE state of SkillForge today, so the illustration can't overclaim.
import type { Dept } from "./events";

// This page performs NO checks, so it may never say "connected", "available" or "healthy". Real health lives in the
// console (System view, from `python -m app status`).
export type Status = "supported" | "configured" | "awaiting" | "unavailable";

export const STATUS: Record<Status, { text: string; meaning: string }> = {
  supported: { text: "Supported", meaning: "SkillForge can read it; nothing on this page checked it" },
  configured: { text: "Configured, unverified", meaning: "set up on the machine; no health check on this page" },
  awaiting: { text: "Awaiting authorization", meaning: "needs an admin's yes and a token first" },
  unavailable: { text: "Unavailable", meaning: "not built yet" },
};

export interface System {
  id: string;
  name: string;
  via: string;
  status: Status;
  /** stage position (scene viewBox units) */
  at: [number, number];
  /** where it lives once it becomes part of the office; unavailable systems don't enter it */
  dept: Dept | null;
  /** what read-only discovery reports for it */
  found: string;
}

export const SYSTEMS: System[] = [
  { id: "records", name: "Business records", via: "local database", status: "supported", at: [-200, 22], dept: "intake",
    found: "2 record types found" },
  { id: "chat", name: "Team chat", via: "Slack, through NemoClaw", status: "awaiting", at: [-200, 226], dept: "intake",
    found: "nothing read yet" },
  { id: "model", name: "Local model", via: "vLLM on this machine", status: "configured", at: [200, 22], dept: "server",
    found: "not started" },
  { id: "repo", name: "Code repository", via: "Git", status: "unavailable", at: [200, 226], dept: null,
    found: "not reachable" },
  { id: "erp", name: "ERP", via: "SAP or similar", status: "unavailable", at: [0, 268], dept: null,
    found: "not reachable" },
];

/** Example discovery output, shaped like the real manifest (subset). */
export const MANIFEST = {
  environment: { record_kinds: ["freight_po"], evidence_sources: ["carrier_export:trusted"] },
  tool_inventory: ["read_records", "investigate", "freight_invoice", "propose_action", "request_approval", "verify_action"],
  missing_skill_opportunities: ["Freight accrual check", "Duplicate charge check"],
};

/** The manifest's rows: what Ember may do, and who has to say yes. Each row lands in the office room that does it. */
export const RIGHTS: { text: string; rule: string; person: boolean; dept: Dept }[] = [
  { text: "Read POs and carrier invoices", rule: "allowed, read-only", person: false, dept: "intake" },
  { text: "Propose a fix to freight_accrued", rule: "a person approves", person: true, dept: "review" },
  { text: "Check every applied change", rule: "independent verifier", person: false, dept: "gate" },
  { text: "Keep a proven fix as a skill", rule: "a person approves", person: true, dept: "library" },
];

export const SCENES = [
  { id: "bs-appliance", short: "Appliance" },
  { id: "bs-connect", short: "Connect" },
  { id: "bs-discover", short: "Discover" },
  { id: "bs-permissions", short: "Permissions" },
  { id: "bs-office", short: "Your office" },
] as const;
