// Procedural geometry helpers. Everything is cached by key and shared; geometry lives for the page lifetime (a handful of
// small meshes), so nothing here is disposed per mount.
import { BufferGeometry, ExtrudeGeometry, Shape } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const cache = new Map<string, BufferGeometry>();
function memo(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

/** A box with truly rounded (not chamfered-flat) edges: catches env highlights along every bevel. */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 4): BufferGeometry {
  return memo(`rb:${w}:${h}:${d}:${r}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
}

/** Rounded rectangle path centred on the origin, in the XY plane. */
export function roundedRectPath(target: Shape, w: number, h: number, r: number): Shape {
  const x = -w / 2, y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  target.moveTo(x + rr, y);
  target.lineTo(x + w - rr, y);
  target.quadraticCurveTo(x + w, y, x + w, y + rr);
  target.lineTo(x + w, y + h - rr);
  target.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  target.lineTo(x + rr, y + h);
  target.quadraticCurveTo(x, y + h, x, y + h - rr);
  target.lineTo(x, y + rr);
  target.quadraticCurveTo(x, y, x + rr, y);
  return target;
}

/** A rounded-rectangle ring (outer w x h, wall thickness t) extruded along +z by `depth`, with a small bevel. */
export function ringFrame(w: number, h: number, r: number, t: number, depth: number, bevel = 0.006): BufferGeometry {
  return memo(`ring:${w}:${h}:${r}:${t}:${depth}:${bevel}`, () => {
    const s = roundedRectPath(new Shape(), w, h, r);
    s.holes.push(roundedRectPath(new Shape(), w - 2 * t, h - 2 * t, Math.max(r - t, 0.001)));
    const g = new ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** A round-topped arch outline (straight legs, semicircular head). Origin at the floor centre (y up from 0). */
export function archRing(w: number, h: number, t: number, depth: number, bevel = 0.004): BufferGeometry {
  return memo(`arch:${w}:${h}:${t}:${depth}:${bevel}`, () => {
    const R = w / 2, r = R - t;
    const cy = h - R;
    const s = new Shape();
    s.moveTo(-R, 0);
    s.lineTo(-R, cy);
    s.absarc(0, cy, R, Math.PI, 0, true);
    s.lineTo(R, 0);
    s.lineTo(R - t, 0);
    s.lineTo(R - t, cy);
    s.absarc(0, cy, r, 0, Math.PI, false);
    s.lineTo(-R + t, 0);
    s.lineTo(-R, 0);
    const g = new ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 28 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}
