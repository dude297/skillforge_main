// One moment of the film. A frame is the answer to: given how far into the timeline we are, which known events have
// happened? Everything drawn comes from that list: events -> sceneState() (the product's own fold) -> toVisual().
import { BEAT_ORDER, type CineVisual } from "../contract";
import { sceneState, type SceneState, type VizEvent } from "../../world/events";
import { ILLUSTRATION_BEATS } from "../adapters/illustration";
import { toVisual } from "../adapters/visual";
import { BEAT_MS, BEAT_START, PACING, locate, type Locus } from "./sequence";

export interface Frame extends Locus {
  t: number;
  /** all events told so far, across beats */
  count: number;
  /** how many of those belong to the current beat (0 = the beat has told nothing yet) */
  here: number;
  /** timeline ms at which the newest event of the current beat began (-1 when `here` is 0) */
  eventT0: number;
  /** changes exactly when the set of told events changes; progress and time are not part of it */
  key: string;
}

const EPS = 1e-9;

export function frameAt(t: number): Frame {
  const loc = locate(t);
  let before = 0;
  for (let k = 0; k < loc.index; k++) before += ILLUSTRATION_BEATS[BEAT_ORDER[k]].length;
  const n = ILLUSTRATION_BEATS[loc.beat].length;
  // event i is told once progress reaches its threshold: PACING when the beat has one (and it fits), else an even spread
  const pace = PACING[loc.beat];
  const at = (i: number) => (pace && pace.length === n ? pace[i] : i / n + EPS);
  let here = 0;
  while (here < n && loc.progress >= at(here)) here++;
  return {
    ...loc,
    t,
    count: before + here,
    here,
    eventT0: here > 0 ? BEAT_START[loc.beat] + at(here - 1) * BEAT_MS[loc.beat] : -1,
    key: `${loc.beat}:${before + here}`,
  };
}

const folds = new Map<string, SceneState>();

/** The scene fold for a frame. Memoised by event set: it runs a handful of times per film, not per frame. */
export function stateFor(f: Frame): SceneState {
  let s = folds.get(f.key);
  if (!s) {
    const events: VizEvent[] = [];
    for (let k = 0; k < f.index; k++) events.push(...ILLUSTRATION_BEATS[BEAT_ORDER[k]]);
    events.push(...ILLUSTRATION_BEATS[f.beat].slice(0, f.here));
    s = sceneState(events);
    folds.set(f.key, s);
  }
  return s;
}

export function visualFor(f: Frame): CineVisual {
  return toVisual(stateFor(f), { beat: f.beat, progress: f.progress, provenance: "illustration" });
}

/** Drop memoised folds (the dev harness swaps in sample events). */
export function resetFolds(): void { folds.clear(); }
