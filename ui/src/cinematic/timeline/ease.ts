// Easing for the film. The two curves are the product's motion tokens (src/lib/motion.ts), turned into functions so the
// camera, the typography reveals and the progress rail all move with the same physics as the rest of the UI.
import { EASE } from "../../lib/motion";

type Bezier = readonly [number, number, number, number];

/** cubic-bezier(x1, y1, x2, y2) as a function of time -> value. Newton with a bisection fallback; no allocation per call. */
export function cubicBezier([x1, y1, x2, y2]: Bezier): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const Y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 6; i++) {
      const err = X(s) - t;
      if (Math.abs(err) < 1e-5) return Y(s);
      const d = dX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0, hi = 1;
    s = t;
    for (let i = 0; i < 24; i++) {
      const x = X(s);
      if (Math.abs(x - t) < 1e-5) break;
      if (x < t) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return Y(s);
  };
}

export const ease = {
  /** token `standard`: slow in, fast middle, long settle. Camera moves that start from rest. */
  standard: cubicBezier(EASE.standard),
  /** token `emphasis`: immediate, decisive, then a long exponential settle. Reveals and arrivals. */
  emphasis: cubicBezier(EASE.emphasis),
  /** `standard` with a longer, softer start for the one big dolly (beat F): same family, derived from the token. */
  glide: cubicBezier([0.4, 0, 0.1, 1]),
};
export type EaseName = keyof typeof ease;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0..1 ramp over [from, from + dur] in ms, eased. */
export const ramp = (t: number, from: number, dur: number, fn: (x: number) => number = ease.emphasis) => fn(clamp01((t - from) / dur));
