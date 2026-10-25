// THE FORGE: the shared contract of the cinematic layer. Every worker builds against these types and positions.
//
// Truth rule: the cinematic never keeps its own idea of progress. What it draws comes from a SceneState folded by
// world/events.ts `sceneState()` over VizEvents (illustration events for the intro, the recorded OnCall run for the
// guided demo, live audit events in Live). Time only chooses HOW FAR into a known event list we are and animates the
// transition between two known states. A gate turns green only when the fold says `gate === "pass"`.
import type { MascotState } from "../world/sprites";
import type { SceneState, VizEvent } from "../world/events";

export type Beat = "awaken" | "storm" | "gate" | "forge" | "shortpath" | "enter";
export const BEAT_ORDER: Beat[] = ["awaken", "storm", "gate", "forge", "shortpath", "enter"];

/** Where the pictures come from. Always shown on screen; never inferred. */
export type CineProvenance = "illustration" | "recorded" | "live";

/** One renderable moment, derived from a SceneState (adapters/visual.ts `toVisual`). Pure data, no time inside. */
export interface CineVisual {
  provenance: CineProvenance;
  beat: Beat;
  /** 0..1 inside the beat: for transitions between two known states only */
  progress: number;
  /** the GB10: 0 = dark, 1 = fully powered. working = the local model is investigating or writing */
  machine: { power: number; working: boolean };
  ember: MascotState;
  /** incident evidence (logs, metrics, config, deploys) entering and being investigated */
  intake: { tickets: number; flowing: boolean; converge: number };
  /** human review desk: amber ONLY while a person is needed (fold.waiting) */
  review: "idle" | "waiting" | "decided";
  /** independent verification gate: straight from fold.gate */
  verify: "idle" | "checking" | "passed" | "failed";
  library: { drafted: number; stored: number };
  /** the skill artifact; null until the fold has a drafted or stored skill */
  artifact: null | {
    phase: "condensing" | "awaiting_person" | "stored";
    /** a real sha256 only when the data has one (recorded reference / live). Illustration: null, never invented */
    hash: string | null;
    hashKind: "illustration" | "recorded_reference" | "live";
  };
  /** a work item travelling a path: the full path through the AI room, the short path (skill, no model), or a refusal */
  route: null | { kind: "full" | "short" | "refused"; progress: number };
  /** the current event's own words, for captions / screen readers */
  caption: { title: string; detail: string } | null;
}

export interface Quality {
  tier: "high" | "low";
  /** bloom / vignette etc. Off on low tier, reduced motion and phones */
  postfx: boolean;
  dpr: [number, number];
}

/** World layout in scene units (y up). The camera, the set and the actors all use these. */
export const LAYOUT = {
  intake: [-10, 0, 0],
  machine: [0, 0, 0],
  review: [5, 0, 0],
  verify: [9, 0, 0],
  library: [4.5, 0, -6],
  /** where an incompatible incident is stopped before it reaches the library */
  refusalStop: [1.5, 0, -6],
  /** control points for the short path: intake -> library without passing the machine */
  shortPathVia: [[-6, 0, -6], [0, 0, -7.5]],
} as const satisfies Record<string, readonly [number, number, number] | readonly (readonly [number, number, number])[]>;

/** Semantic colours: identical meanings to the console (tokens.css). Do not use verified green for anything unverified. */
export const CINE_COLORS = {
  void: "#05080D",
  steel: "#1B2430",
  signal: "#82D8FF", // the agent is acting
  verified: "#65E9B7", // an independent check passed
  warn: "#F1AD64", // a person is needed
  fail: "#FF8A94", // failure / refusal
  ember: "#FFB45E", // Ember's flame (character colour, not a status)
} as const;

/** Props the set pieces (Worker A) accept. */
export interface SetProps { visual: CineVisual; quality: Quality }
/** Props the actors (Worker C) accept. */
export interface ActorProps { visual: CineVisual; quality: Quality; reducedMotion: boolean }

export type { MascotState, SceneState, VizEvent };
