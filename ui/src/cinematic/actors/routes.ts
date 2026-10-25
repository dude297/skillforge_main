// The paths a work item can travel, sampled once into arc-length-uniform tables (no curve objects at runtime).
// Anchors are named positions on a path (as arc-length fractions), so state -> position never guesses.
import { CatmullRomCurve3, Vector3 } from "three";
import { LAYOUT } from "../contract";
import { HOVER } from "./util";

export type RouteId = "full" | "short" | "refused" | "skill";
export interface Route { n: number; p: Float32Array; a: Record<string, number> }

const N = 240;
function build(pts: [number, number, number][], names: Record<string, number>): Route {
  const curve = new CatmullRomCurve3(pts.map((q) => new Vector3(...q)), false, "centripetal");
  const s = curve.getSpacedPoints(N - 1);
  const p = new Float32Array(N * 3);
  s.forEach((v, i) => { p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z; });
  // anchor = arc-length fraction of the sample nearest to the named control point
  const a: Record<string, number> = {};
  for (const [name, idx] of Object.entries(names)) {
    const q = pts[idx]; let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) { const dx = p[i * 3] - q[0], dy = p[i * 3 + 1] - q[1], dz = p[i * 3 + 2] - q[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; } }
    a[name] = best / (N - 1);
  }
  return { n: N, p, a };
}

const I = HOVER.intake, M = HOVER.machine, R = HOVER.review, V = HOVER.verify, L = HOVER.library, S = HOVER.stop, H = HOVER.hero;
const v1 = LAYOUT.shortPathVia[0], v2 = LAYOUT.shortPathVia[1];
const t3 = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];

export const ROUTES: Record<RouteId, Route> = {
  // intake -> over the GB10 (where the proposal forms) -> review desk -> verification gate
  full: build([t3(I), [-7.6, 1.7, 1.4], [-4.4, 1.3, 1.9], [-2.0, 1.5, 1.0], t3(M), [2.5, 2.3, 0.8], t3(R), [7.0, 1.7, 0.6], t3(V)],
    { intake: 0, approach: 3, machine: 4, review: 6, verify: 8 }),
  // intake -> around the back, skipping the machine -> the library -> out to the review desk -> the gate
  short: build([t3(I), [v1[0], 1.1, v1[2]], [v2[0], 1.1, v2[2]], t3(L), [L.x + 0.6, 1.5, -3.0], t3(R), [7.0, 1.7, 0.6], t3(V)],
    { intake: 0, library: 3, review: 5, verify: 7 }),
  // the same road, stopped short of the library
  refused: build([t3(I), [v1[0], 1.1, v1[2]], [-2.8, 1.15, -7.2], [v2[0], 1.1, v2[2]], t3(S)], { intake: 0, stop: 4 }),
  // the finished skill: leaves the machine, forms and waits at the hero point between desk and library, then seats in its slot
  skill: build([t3(M), [2.4, 3.0, -1.2], t3(H), [4.5, 1.2, -4.9], t3(L)], { machine: 0, hero: 2, library: 4 }),
};

/** position at arc-length fraction u (clamped) */
export function routeAt(r: Route, u: number, out: Vector3): Vector3 {
  const f = (u < 0 ? 0 : u > 1 ? 1 : u) * (r.n - 1), i = Math.min(r.n - 2, Math.floor(f)), t = f - i, j = i * 3, k = j + 3;
  return out.set(r.p[j] + (r.p[k] - r.p[j]) * t, r.p[j + 1] + (r.p[k + 1] - r.p[j + 1]) * t, r.p[j + 2] + (r.p[k + 2] - r.p[j + 2]) * t);
}
