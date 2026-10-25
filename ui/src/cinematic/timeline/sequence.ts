// Beat durations and the pure arithmetic around them. Time chooses HOW FAR into a known list of events the film is;
// it never decides what is true (see frame.ts: events -> sceneState() -> toVisual()).
import { BEAT_ORDER, type Beat } from "../contract";

export const BEAT_MS: Record<Beat, number> = { awaken: 2000, storm: 2200, gate: 2000, forge: 2400, shortpath: 2800, enter: 1600 };

/** When each event of a beat is told, as beat progress (0..1), for beats where an even spread would rush the meaning.
 * gate: the proposal waits for a person for most of the beat (the amber hold), then approval -> apply -> verify.
 * forge: the drafted skill waits for a person (amber) before it is promoted. Beats not listed spread evenly. */
export const PACING: Partial<Record<Beat, readonly number[]>> = {
  gate: [0.04, 0.64, 0.76, 0.88],
  forge: [0.06, 0.48, 0.84],
  shortpath: [0.03, 0.14, 0.26, 0.46, 0.55, 0.64, 0.76, 0.87],
};

export const BEAT_START = {} as Record<Beat, number>;
export const BEAT_END = {} as Record<Beat, number>;
{
  let at = 0;
  for (const b of BEAT_ORDER) { BEAT_START[b] = at; at += BEAT_MS[b]; BEAT_END[b] = at; }
}
export const TOTAL_MS = BEAT_END[BEAT_ORDER[BEAT_ORDER.length - 1]];
export const LAST = BEAT_ORDER.length - 1;

/** Short names for the rail and for assistive tech. Plain words, no sequence letters. */
export const BEAT_TITLE: Record<Beat, string> = {
  awaken: "The machine wakes",
  storm: "Evidence arrives",
  gate: "A person decides",
  forge: "The skill is forged",
  shortpath: "The short path",
  enter: "Enter the product",
};

export interface Locus { beat: Beat; index: number; progress: number }

/** Where a timeline moment falls. t exactly on a boundary belongs to the beat that starts there; TOTAL_MS is the end of the last. */
export function locate(t: number, out: Locus = { beat: "awaken", index: 0, progress: 0 }): Locus {
  const tt = t < 0 ? 0 : t > TOTAL_MS ? TOTAL_MS : t;
  let i = LAST;
  for (let k = 0; k < LAST; k++) if (tt < BEAT_END[BEAT_ORDER[k]]) { i = k; break; }
  const b = BEAT_ORDER[i];
  out.beat = b;
  out.index = i;
  out.progress = Math.min(1, (tt - BEAT_START[b]) / BEAT_MS[b]);
  return out;
}

/** The moment a beat is fully told (progress 1): used by stepped modes (reduced motion, poster) and by "skip". */
export const endOfBeat = (i: number): number => (i >= LAST ? TOTAL_MS : BEAT_END[BEAT_ORDER[i]] - 0.01);
export const startOfBeat = (i: number): number => BEAT_START[BEAT_ORDER[Math.max(0, Math.min(LAST, i))]];
