// The camera, as directed moves. One move per beat, no roll (the up vector never leaves +y), one FOV change over the
// whole film (34 -> 28 degrees, only in the last dolly). Every position is built from LAYOUT so the camera follows the
// set if the set moves. Positions are metres of the scene; y is up.
//
//   A  awaken     push in from darkness onto the GB10's face and core
//   B  storm      pull back and pan left->right as evidence streams from intake to the machine
//   C  gate       settle on the review desk, then HOLD (a deliberate pause while the light turns amber)
//   D  forge      tight orbit on the forging artifact (the hero shot), then follow it into the library
//   E  shortpath  rise to a wide establishing view: the short path skips the machine, the refusal stops
//   F  enter      one fast, smooth dolly to a near top-down view that matches the console / World layout
import { BEAT_ORDER, LAYOUT } from "../contract";
import { ease, clamp01, type EaseName } from "./ease";
import { locate, type Locus } from "./sequence";

type V3 = readonly [number, number, number];
const { machine: M, review: R, library: L, refusalStop: X, intake: I } = LAYOUT;

/** Where the artifact condenses (the hero). Between the review desk and the library, at eye height above the plinth.
 * Worker C's artifact should be born here; if the set moves it, change this one constant. */
export const HERO: V3 = [(R[0] + L[0]) / 2, 1.3, (R[2] + L[2]) / 2 - 0.6];

interface Move {
  pos: V3[];
  tgt: V3[];
  fov: readonly [number, number];
  /** horizontal frame offset as a fraction of the viewport width (content moves right): keeps the title area clear */
  shift: readonly [number, number];
  ease: EaseName;
  /** the part of the beat the move occupies; the camera is still after it */
  win: readonly [number, number];
  /** where the camera ends after a hold: a slow creep (eased, from rest to rest) from the settled pose; keeps a hold alive without a second move */
  creep?: { pos: V3; tgt: V3 };
}

const orbit = (deg: number, r: number, lift: number): V3 => {
  const a = (deg * Math.PI) / 180;
  return [HERO[0] + r * Math.sin(a), HERO[1] + lift, HERO[2] + r * Math.cos(a)];
};

// shared poses: the end of one beat is, exactly, the start of the next
const A_END: V3 = [1.6, 1.55, 8.4]; // the whole GB10 face in frame; Ember (front-left) reads small beside it
const B_END: V3 = [(I[0] + M[0]) / 2 + 0.4, 3.7, 12.6];
const B_END_T: V3 = [(I[0] + M[0]) / 2 + 0.4, 0.4, M[2]];
const toward = (p: V3, t: V3, f: number): V3 => [p[0] + (t[0] - p[0]) * f, p[1] + (t[1] - p[1]) * f, p[2] + (t[2] - p[2]) * f];
const C_SETTLE: V3 = [R[0] - 0.6, 2.1, 7.4];
const C_END_T: V3 = [R[0] - 1.6, 1.0, R[2] - 0.4];
const C_END = toward(C_SETTLE, C_END_T, 0.03);
const D_END: V3 = [L[0] - 2.4, 2.9, L[2] + 6.4];
const D_END_T: V3 = [L[0], 0.9, L[2]];
const E_SETTLE: V3 = [2.4, 6.4, 9.6];
const E_SETTLE_T: V3 = [X[0] + 1.6, 0.3, (L[2] + M[2]) / 2 - 0.4]; // library, refusal stop and the desk in one frame
const E_END_T: V3 = [E_SETTLE_T[0] + 1.2, 0, E_SETTLE_T[2] - 0.4]; // drifts toward the refusal stop
const E_END = toward(E_SETTLE, E_END_T, 0.04);

const MOVES: Move[] = [
  { // A
    pos: [[0.4, 0.9, 13.5], [1.1, 1.2, 10.6], A_END],
    tgt: [[M[0] - 0.2, 0.62, M[2] + 1.2], [M[0] - 0.2, 0.64, M[2] + 1.2], [M[0] - 0.3, 0.66, M[2] + 1.2]],
    fov: [34, 34], shift: [0.1, 0.1], ease: "emphasis", win: [0, 1],
  },
  { // B
    pos: [A_END, [-2.2, 2.6, 10.4], B_END],
    tgt: [[M[0] - 0.3, 0.66, M[2] + 1.2], [-2.6, 0.5, M[2]], B_END_T],
    fov: [34, 34], shift: [0.1, 0], ease: "standard", win: [0, 1],
  },
  { // C: the move is quick, the hold is the point
    pos: [B_END, C_SETTLE],
    tgt: [B_END_T, C_END_T],
    fov: [34, 34], shift: [0, 0], ease: "standard", win: [0, 0.5], creep: { pos: C_END, tgt: C_END_T },
  },
  { // D: orbit the artifact, then follow it into the library
    pos: [C_END, orbit(42, 4.6, 0.6), orbit(4, 4.3, 0.7), orbit(-34, 4.5, 0.55), D_END],
    tgt: [C_END_T, HERO, HERO, [HERO[0] - 0.1, HERO[1] - 0.15, HERO[2] - 0.2], D_END_T],
    fov: [34, 34], shift: [0.06, 0.06], ease: "standard", win: [0, 1],
  },
  { // E
    pos: [D_END, [L[0] - 1.5, 6.5, 8.5], E_SETTLE],
    tgt: [D_END_T, [L[0] - 2, 0.4, -4], E_SETTLE_T],
    fov: [34, 34], shift: [0.08, 0], ease: "standard", win: [0, 0.6], creep: { pos: E_END, tgt: E_END_T },
  },
  { // F: top-down, composed like the product's own layout (intake on the left, library above the desk)
    pos: [E_END, [2.6, 13, 9.5], [1.4, 17.5, 6.2]],
    tgt: [E_END_T, [1.2, 0, -2.4], [1.2, 0, -2.6]],
    fov: [34, 28], shift: [0, 0], ease: "glide", win: [0, 1],
  },
];

export interface CamPose { px: number; py: number; pz: number; tx: number; ty: number; tz: number; fov: number; shift: number }
export const newPose = (): CamPose => ({ px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 34, shift: 0 });

/** Uniform Catmull-Rom through `pts` at u in [0,1]; writes into o[0..2]. No allocation. */
function spline(pts: readonly V3[], u: number, o: number[]): void {
  const n = pts.length;
  if (n === 1) { o[0] = pts[0][0]; o[1] = pts[0][1]; o[2] = pts[0][2]; return; }
  const x = clamp01(u) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  for (let k = 0; k < 3; k++) {
    o[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3);
  }
}

const scratch = [0, 0, 0];
const loc: Locus = { beat: "awaken", index: 0, progress: 0 };

/** The camera at timeline moment t for a viewport of this aspect ratio (narrow screens stand further back, same move). */
export function cameraAt(t: number, aspect: number, out: CamPose): CamPose {
  locate(t, loc);
  const m = MOVES[BEAT_ORDER.indexOf(loc.beat)];
  const p = loc.progress;
  const u = ease[m.ease](clamp01((p - m.win[0]) / (m.win[1] - m.win[0])));
  spline(m.tgt, u, scratch);
  let tx = scratch[0], ty = scratch[1], tz = scratch[2];
  spline(m.pos, u, scratch);
  let px = scratch[0], py = scratch[1], pz = scratch[2];
  if (m.creep && p > m.win[1]) {
    const c = ease.standard(clamp01((p - m.win[1]) / (1 - m.win[1])));
    px += (m.creep.pos[0] - px) * c; py += (m.creep.pos[1] - py) * c; pz += (m.creep.pos[2] - pz) * c;
    tx += (m.creep.tgt[0] - tx) * c; ty += (m.creep.tgt[1] - ty) * c; tz += (m.creep.tgt[2] - tz) * c;
  }
  const k = Math.min(2.1, Math.max(1, Math.pow(1.5 / Math.max(aspect, 0.2), 0.85)));
  out.px = tx + (px - tx) * k;
  out.py = ty + (py - ty) * k;
  out.pz = tz + (pz - tz) * k;
  out.tx = tx; out.ty = ty; out.tz = tz;
  out.fov = m.fov[0] + (m.fov[1] - m.fov[0]) * u;
  out.shift = (m.shift[0] + (m.shift[1] - m.shift[0]) * u) * clamp01((aspect - 1.1) / 0.5);
  return out;
}
