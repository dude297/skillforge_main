// Procedural glyph geometry: flat, hairline-built pictograms for the evidence (log lines, metric sparklines, config
// blocks, deploy markers) and for the skill being written (code lines, test ticks, version seals). Pure data builders.
import { BufferGeometry, Float32BufferAttribute } from "three";

class B {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, br: number) {
    const o = this.pos.length / 3;
    this.pos.push(x0, y0, 0, x1, y1, 0, x2, y2, 0, x3, y3, 0);
    for (let i = 0; i < 4; i++) this.col.push(br, br, br);
    this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  rect(cx: number, cy: number, w: number, h: number, br: number) { this.quad(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2, br); }
  seg(x0: number, y0: number, x1: number, y1: number, th: number, br: number) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * th / 2, ny = (dx / l) * th / 2;
    this.quad(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, br);
  }
  /** left-aligned bar starting at x */
  bar(x: number, y: number, w: number, th: number, br: number) { this.rect(x + w / 2, y, w, th, br); }
  poly(pts: [number, number][], th: number, br: number, close = false) {
    for (let i = 0; i < pts.length - (close ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.seg(a[0], a[1], b[0], b[1], th, br); }
  }
  done(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** an application log: a timestamp block and four ragged lines */
export function logGlyph() {
  const b = new B();
  b.rect(0, 0, 1.0, 0.64, 0.1);
  b.rect(-0.37, 0.2, 0.15, 0.075, 1);
  b.bar(-0.2, 0.2, 0.56, 0.06, 0.95);
  b.bar(-0.43, 0.07, 0.78, 0.055, 0.7);
  b.bar(-0.43, -0.06, 0.5, 0.055, 0.8);
  b.bar(-0.43, -0.19, 0.66, 0.055, 0.65);
  return b.done();
}

/** a metric panel: a baseline and a sparkline ending in a bright point */
export function metricGlyph() {
  const b = new B();
  b.rect(0, 0, 1.0, 0.64, 0.1);
  b.bar(-0.43, -0.22, 0.86, 0.022, 0.5);
  const ys = [-0.12, -0.04, -0.1, 0.02, -0.06, 0.12, 0.04, 0.16, 0.08, 0.22];
  const pts: [number, number][] = ys.map((y, i) => [-0.41 + (i * 0.82) / (ys.length - 1), y]);
  b.poly(pts, 0.05, 1);
  const e = pts[pts.length - 1];
  b.rect(e[0], e[1], 0.11, 0.11, 1);
  return b.done();
}

/** a configuration block: corner brackets around indented key/value rows */
export function configGlyph() {
  const b = new B();
  b.rect(0, 0, 0.84, 0.84, 0.1);
  const h = 0.42, l = 0.22, t = 0.05;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    b.seg(sx * h, sy * h, sx * (h - l), sy * h, t, 0.95);
    b.seg(sx * h, sy * h, sx * h, sy * (h - l), t, 0.95);
  }
  b.rect(-0.2, 0.2, 0.06, 0.06, 1); b.bar(-0.1, 0.2, 0.3, 0.05, 0.9);
  b.rect(-0.12, 0.07, 0.06, 0.06, 1); b.bar(-0.02, 0.07, 0.4, 0.05, 0.75);
  b.rect(-0.12, -0.06, 0.06, 0.06, 1); b.bar(-0.02, -0.06, 0.26, 0.05, 0.85);
  b.rect(-0.2, -0.19, 0.06, 0.06, 1); b.bar(-0.1, -0.19, 0.2, 0.05, 0.7);
  return b.done();
}

/** a deployment marker: a diamond on a timeline with a pin */
export function deployGlyph() {
  const b = new B();
  const r = 0.34;
  b.poly([[0, r], [r, 0], [0, -r], [-r, 0]], 0.055, 1, true);
  b.quad(0, 0.13, 0.13, 0, 0, -0.13, -0.13, 0, 1);
  b.seg(-0.62, 0, -r - 0.04, 0, 0.03, 0.55); b.seg(r + 0.04, 0, 0.62, 0, 0.03, 0.55);
  b.seg(0, -r, 0, -0.62, 0.045, 0.9); b.rect(0, -0.64, 0.2, 0.04, 0.9);
  return b.done();
}

/** one code line */
export function lineGlyph() { const b = new B(); b.rect(0, 0, 1, 0.07, 1); b.rect(-0.62, 0, 0.1, 0.07, 0.6); return b.done(); }

/** a test passing: a check mark inside a box (cyan-white, it is the skill's own test, not the independent gate) */
export function tickGlyph() {
  const b = new B();
  b.poly([[-0.4, 0.38], [0.4, 0.38], [0.4, -0.38], [-0.4, -0.38]], 0.07, 0.6, true);
  b.seg(-0.22, 0.0, -0.06, -0.18, 0.1, 1); b.seg(-0.06, -0.18, 0.26, 0.2, 0.1, 1);
  return b.done();
}

/** the version seal: a hexagon outline with a notch */
export function sealGlyph() {
  const b = new B();
  const pts: [number, number][] = Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3 + Math.PI / 6) * 0.5, Math.sin((i * Math.PI) / 3 + Math.PI / 6) * 0.5]);
  b.poly(pts, 0.07, 1, true);
  b.poly(pts.map(([x, y]) => [x * 0.55, y * 0.55] as [number, number]), 0.05, 0.8, true);
  return b.done();
}

/** a flat splinter for the refusal */
export function shardGlyph() { const b = new B(); b.quad(-0.5, -0.3, 0.5, -0.1, 0.1, 0.35, -0.3, 0.1, 1); return b.done(); }
