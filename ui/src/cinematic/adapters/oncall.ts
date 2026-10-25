// The recorded OnCall run as cinematic beats. Built ONLY from fromOnCall(run) (world/events.ts): this file only
// groups and filters its events, it never adds one. Missing parts of the run give a beat without events.
//
//   storm      the incident and the investigation
//   gate       the skill being written and tested, up to and including the wait for a person
//   forge      the person's decision and the skill being stored
//   shortpath  reuse (INC-2) and the refusal (INC-3); only when the skill really was stored
//
// The shipped fixture is a RECORDED SIMULATION: the skill is a hand-written reference (not model output) and its
// approval is kind "simulated" (not a person). approvalKind() exposes that so the overlay can say so.
import type { Beat, VizEvent } from "../contract";
import { fromOnCall } from "../../world/events";
import { modelWrote, type OnCallRun } from "../../data/oncall";
import type { VisualCtx } from "./visual";

export type ApprovalKind = "simulated" | "host_cli" | "unrecorded" | "none";

/** who decided: "host_cli" = typed on the host CLI (counts as a person), "simulated" = an agent in a throwaway registry,
 * "unrecorded" = approved without a recorded kind (never treated as a person), "none" = no approval in the run */
export function approvalKind(run: OnCallRun): ApprovalKind {
  const a = run.approval;
  if (!a) return "none";
  return a.kind === "host_cli" ? "host_cli" : a.kind === "simulated" ? "simulated" : "unrecorded";
}

/** the hash exactly as the run has it (a recorded reference, hand-written ahead of time), or null. Never derived. */
export function oncallHash(run: OnCallRun): { value: string | null; kind: "recorded_reference" | "live" } {
  return { value: run.synthesis?.skill_hash ?? null, kind: modelWrote(run) ? "live" : "recorded_reference" };
}

/** Beat -> events. Order inside and across beats is the fold's order, so concatenating beats in BEAT_ORDER is valid. */
export function oncallBeats(run: OnCallRun): Record<Beat, VizEvent[]> {
  const { incident, synthesis, reuse } = fromOnCall(run);
  const verified = run.verification?.passed === true;
  // A skill whose verification did not pass is never drafted, approved or stored, whatever the approval block says.
  const synth = verified ? synthesis : synthesis.filter((e) => !["o-draft", "o-wait", "o-ok", "o-store", "o-rej"].includes(e.id));
  const stored = synth.some((e) => e.effects?.includes("skill_stored"));
  const cut = synth.findIndex((e) => e.id === "o-wait");
  const gate = cut < 0 ? synth : synth.slice(0, cut + 1);
  const forge = cut < 0 ? [] : synth.slice(cut + 1);
  return {
    awaken: [],
    storm: incident,
    gate,
    forge,
    shortpath: stored ? reuse : [], // reuse and refusal both need a stored skill; without one nothing is shown
    enter: [],
  };
}

/** The visual context for a recorded run: provenance recorded, the run's own hash, and whether a model ran at all. */
export function oncallCtx(run: OnCallRun): Pick<VisualCtx, "provenance" | "hash" | "modelRan"> {
  const live = modelWrote(run);
  return { provenance: live ? "live" : "recorded", hash: oncallHash(run), modelRan: live };
}

/** Everything the cinematic needs from one run, in one object. */
export function oncallScript(run: OnCallRun) {
  return { provenance: oncallCtx(run).provenance, beats: oncallBeats(run), hash: oncallHash(run), approvalKind: approvalKind(run), modelWrote: modelWrote(run) };
}
