// Deterministic geometry: fixed positions per node id (world units, 1200 x 800), curved edge paths, camera foci per beat.
// The graph is a graph (edges may cross, nodes have many links); the tree is only the look: roots at the bottom, Ember in the middle.
import type { BeatId, MoonshotEdge } from "./types";

export const WORLD = { w: 1200, h: 800 };
export const NODE_W = 184, NODE_H = 48;
export type P = { x: number; y: number };

const SRC_POS: P[] = [{ x: 250, y: 560 }, { x: 410, y: 662 }, { x: 770, y: 662 }, { x: 1010, y: 610 }];

const FIXED: Record<string, P> = {
  ember: { x: 600, y: 380 }, plinth: { x: 600, y: 730 }, service: { x: 150, y: 420 }, incident1: { x: 240, y: 150 },
  skill: { x: 470, y: 92 }, verifier: { x: 700, y: 92 }, gate: { x: 930, y: 150 }, workflow: { x: 1050, y: 420 },
  router: { x: 870, y: 490 }, incident2: { x: 1090, y: 525 }, incident3: { x: 1090, y: 690 }, refusal: { x: 880, y: 752 },
  "ill:git": { x: 230, y: 250 }, "ill:chat": { x: 970, y: 250 }, "ill:erp": { x: 600, y: 120 },
};

export function pos(id: string): P {
  if (FIXED[id]) return FIXED[id];
  const m = /^src:(.+)$/.exec(id);
  if (m) {
    const i = SOURCE_ORDER.indexOf(m[1]);
    return SRC_POS[i >= 0 ? i : SRC_POS.length - 1];
  }
  return { x: 600, y: 400 };
}
const SOURCE_ORDER = ["log", "metric", "config", "deploy"];

const BEND: Record<string, number> = { "edge:ember-incident1": -0.22, "edge:incident1-service": 0.2, "edge:incident1-skill": -0.2, "edge:skill-verifier": 0.12, "edge:verifier-gate": 0.18, "edge:router-skill": -0.28, "edge:skill-workflow": 0.2, "edge:incident2-router": 0.15, "edge:incident3-router": -0.15, "edge:router-refusal": 0.1, "edge:plinth-ember": 0.0 };

export interface Geom { d: string; mid: P }

/** Cubic arch for the primary edge (over the top of Ember); quadratic bends for the rest. */
export function edgeGeom(e: Pick<MoonshotEdge, "id" | "from" | "to" | "primary">): Geom {
  const a = pos(e.from), b = pos(e.to);
  if (e.primary) {
    const c1 = { x: a.x + 180, y: a.y - 250 }, c2 = { x: b.x - 180, y: b.y - 250 };
    return { d: `M${a.x} ${a.y - 10} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y - 10}`, mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y - 10 + 3 * c1.y + 3 * c2.y + b.y - 10) / 8 } };
  }
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bend = (BEND[e.id] ?? (e.id.startsWith("edge:src:") ? (a.x < 600 ? -0.16 : 0.16) : 0.1)) * len;
  const cx = (a.x + b.x) / 2 + (dy / len) * bend, cy = (a.y + b.y) / 2 - (dx / len) * bend;
  return { d: `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`, mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 } };
}

export interface Cam { x: number; y: number; z: number }
export const FIT: Cam = { x: 600, y: 400, z: 1 };
export const EMBER_CAM: Cam = { x: 600, y: 380, z: 2.2 };
export const INTRO_CAM: Cam = { x: 600, y: 380, z: 3.2 };

const DESKTOP: Record<BeatId, Cam> = {
  bootstrap: { x: 600, y: 540, z: 1.25 }, explore: { x: 430, y: 320, z: 1.15 }, propose: { x: 600, y: 300, z: 1.0 },
  test: { x: 560, y: 190, z: 1.35 }, approval: { x: 780, y: 220, z: 1.35 }, reuse: { x: 850, y: 380, z: 1.15 }, refuse: { x: 930, y: 600, z: 1.3 },
};
const PHONE: Record<BeatId, Cam> = {
  bootstrap: { x: 600, y: 560, z: 1 }, explore: { x: 400, y: 300, z: 1 }, propose: { x: 600, y: 300, z: 0.8 },
  test: { x: 580, y: 130, z: 1 }, approval: { x: 820, y: 140, z: 1 }, reuse: { x: 860, y: 400, z: 0.85 }, refuse: { x: 950, y: 620, z: 0.95 },
};
export const beatCam = (b: BeatId, narrow: boolean): Cam => (narrow ? PHONE : DESKTOP)[b];

export const viewBox = (narrow: boolean) => (narrow ? { w: 600, h: 760 } : { w: WORLD.w, h: WORLD.h });
export const camTransform = (c: Cam, narrow: boolean) => {
  const vb = viewBox(narrow);
  return { tx: vb.w / 2 - c.x * c.z, ty: vb.h / 2 - c.y * c.z, s: c.z };
};
