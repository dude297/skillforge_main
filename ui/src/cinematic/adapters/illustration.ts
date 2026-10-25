// The intro's ILLUSTRATION events, grouped by beat. Source "story": nothing here was measured or recorded.
// Order follows the real system (DESIGN.md section 7, world/events.ts): a change is proposed, a person approves it,
// it is applied once, independent code verifies it; only then a skill is written and tested, and a person promotes it.
// A later, similar problem takes the short path (no model), but its proposal still needs approval and verification
// (a distinct action id); an incompatible problem is refused and handed to a person, never celebrated.
// Copy rules: plain words, no numbers, no timings, no counts, no names: an illustration claims nothing measured.
import type { Beat, VizEvent } from "../contract";

export const ILLUSTRATION_BEATS: Record<Beat, VizEvent[]> = {
  awaken: [],
  storm: [
    { id: "i-in", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: "A problem nobody wrote a rule for",
      detail: "Logs, metrics, a config change and a deploy arrive together.", evidence: [] },
    { id: "i-inv", dept: "server", mascot: "investigating", title: "Investigating on the local model",
      detail: "The agent reads the evidence on this machine. Nothing goes to a cloud model.", evidence: [] },
    { id: "i-prop", dept: "server", mascot: "building", action: 1, title: "Proposing one bounded fix",
      detail: "One small change, with its reason attached. Nothing has been changed yet.", evidence: [] },
  ],
  gate: [
    { id: "i-wait", dept: "review", mascot: "waiting", action: 1, effects: ["approval_wait"], title: "A person decides",
      detail: "The proposal waits at the review desk. The agent can't approve its own work.", evidence: [] },
    { id: "i-ok", dept: "review", mascot: "idle", action: 1, effects: ["approval_done"], title: "A person approves",
      detail: "The approval is bound to exactly this change.", evidence: [] },
    { id: "i-app", dept: "gate", mascot: "verifying", action: 1, effects: ["applied"], title: "Applied once, then checked",
      detail: "The change is applied a single time. Independent code now re-reads the result.", evidence: [] },
    { id: "i-ver", dept: "gate", mascot: "verified", action: 1, effects: ["verified", "ticket_out"], success: true, title: "Verified by independent code",
      detail: "Only now does the gate turn green.", evidence: [] },
  ],
  forge: [
    { id: "i-write", dept: "server", mascot: "building", title: "Writing a skill from the fix",
      detail: "The agent turns the approved fix into a small program and its own tests.", evidence: [] },
    { id: "i-draft", dept: "library", mascot: "waiting", effects: ["skill_drafted"], title: "Skill drafted and tested",
      detail: "It waits for a person. Nothing enters the library on its own.", evidence: [] },
    { id: "i-store", dept: "library", mascot: "verified", effects: ["skill_stored"], title: "Promoted by a person",
      detail: "Stored in the library, pinned to its version. This illustration shows no real hash.", evidence: [] },
  ],
  shortpath: [
    { id: "sp-in", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: "A similar problem arrives",
      detail: "It has the same shape as the one the skill was made from.", evidence: [] },
    { id: "sp-run", dept: "library", mascot: "building", action: 2, effects: ["ticket_out"], success: true, title: "The short path",
      detail: "The skill proposes the change. The model is not asked.", evidence: [] },
    { id: "sp-wait", dept: "review", mascot: "waiting", action: 2, effects: ["approval_wait"], title: "A person still decides",
      detail: "The skill's proposal needs the same approval.", evidence: [] },
    { id: "sp-ok", dept: "review", mascot: "idle", action: 2, effects: ["approval_done"], title: "A person approves",
      detail: "Bound to this change, like the first one.", evidence: [] },
    { id: "sp-app", dept: "gate", mascot: "verifying", action: 2, effects: ["applied"], title: "Applied once, then checked",
      detail: "The same independent check runs again.", evidence: [] },
    { id: "sp-ver", dept: "gate", mascot: "verified", action: 2, effects: ["verified"], title: "Verified again",
      detail: "Every change is checked, whoever proposed it.", evidence: [] },
    { id: "rf-in", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: "A different problem arrives",
      detail: "It looks similar, but its evidence does not match the skill.", evidence: [] },
    { id: "rf-out", dept: "library", mascot: "error", effects: ["ticket_out"], success: false, title: "Refused: handed to a person",
      detail: "The skill does not guess. Nothing was changed.", evidence: [] },
  ],
  enter: [],
};

/** every illustration event in story order (what the fold sees at the end of the film) */
export const ILLUSTRATION_ALL: VizEvent[] = (["awaken", "storm", "gate", "forge", "shortpath", "enter"] as const).flatMap((b) => ILLUSTRATION_BEATS[b]);
