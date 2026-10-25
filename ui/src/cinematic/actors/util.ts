// Shared math and constants for the actors. Nothing here allocates per call; module-level scratch objects are reused.
import { Color, Vector3 } from "three";
import { CINE_COLORS, LAYOUT } from "../contract";

export const TAU = Math.PI * 2;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t)));
/** frame-rate independent exponential approach */
export const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** deterministic PRNG (mulberry32): fragment layouts are identical on every load */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Semantic colours as linear THREE.Colors (three converts the sRGB hex). Meaning is fixed by CINE_COLORS. */
export const COL = {
  signal: new Color(CINE_COLORS.signal), verified: new Color(CINE_COLORS.verified), warn: new Color(CINE_COLORS.warn),
  fail: new Color(CINE_COLORS.fail), ember: new Color(CINE_COLORS.ember), steel: new Color(CINE_COLORS.steel),
  white: new Color("#EAF6FF"), void: new Color(CINE_COLORS.void),
};

/** A scalar that eases from where it is to a new target over a duration, restartable at any moment. */
export class Tween {
  v: number; private from: number; private to: number; private t0 = 0; private dur = 0.0001;
  constructor(v = 0) { this.v = v; this.from = v; this.to = v; }
  get target() { return this.to; }
  /** retarget (no-op when the target did not change); `snap` jumps. Returns this for chaining. */
  go(to: number, now: number, dur: number, snap = false): this {
    if (snap) { this.v = this.from = this.to = to; return this; }
    if (Math.abs(to - this.to) > 1e-6) { this.from = this.v; this.to = to; this.t0 = now; this.dur = Math.max(1e-4, dur); }
    return this;
  }
  /** advance to `now` and return the value */
  at(now: number, ease: (t: number) => number = easeInOut): number {
    const k = clamp01((now - this.t0) / this.dur);
    this.v = k >= 1 ? this.to : this.from + (this.to - this.from) * ease(k);
    return this.v;
  }
  set(v: number) { this.v = this.from = this.to = v; }
}

// ---- world anchors (scene units). Everything derives from LAYOUT so a re-layout moves the actors with it. ----
export const SLOT_Y = 0.95; // height of a skill slot in the library (the artifact seats here)
export const HOVER = {
  machine: new Vector3(LAYOUT.machine[0], 2.3, LAYOUT.machine[2] + 0.2),
  review: new Vector3(LAYOUT.review[0], 1.9, LAYOUT.review[2]),
  verify: new Vector3(LAYOUT.verify[0], 1.45, LAYOUT.verify[2]),
  library: new Vector3(LAYOUT.library[0], SLOT_Y, LAYOUT.library[2]),
  /** where the camera's hero orbit centres in the forge beat (timeline/camera.ts HERO): the skill condenses and waits here */
  hero: new Vector3(4.55, 1.3, -3.6),
  stop: new Vector3(LAYOUT.refusalStop[0], 1.0, LAYOUT.refusalStop[2]),
  intake: new Vector3(LAYOUT.intake[0], 1.0, LAYOUT.intake[2]),
  /** the centre the investigated evidence orbits (a little in front of the GB10) */
  orbit: new Vector3(LAYOUT.machine[0], 1.15, LAYOUT.machine[2] + 0.2),
};

export interface Quality3 { low: boolean; reduced: boolean; trails: boolean }
