// Procedural textures (no files, no network): brushed-metal roughness/bump, the porous front perforation mask and the
// top vent slots. Generated once per quality tier on first use with seeded noise so frames are reproducible.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, type Texture } from "three";
import { MACHINE } from "./dims";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  return [c, g];
}

function dataTexture(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** smooth value noise in [0,1], cheap and seedable: enough for pore density variation */
function makeNoise(seed: number, cells: number) {
  const r = rng(seed);
  const n = cells + 1;
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = Math.min(Math.max(x, 0), 0.9999) * cells, fy = Math.min(Math.max(y, 0), 0.9999) * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = sm(fx - ix), ty = sm(fy - iy);
    const a = grid[iy * n + ix], b = grid[iy * n + ix + 1], c = grid[(iy + 1) * n + ix], d = grid[(iy + 1) * n + ix + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** Fine horizontal brushing. Mid-grey with streaks: used as roughnessMap (G) and bumpMap (R). */
export function brushedTexture(size: number): Texture {
  const [c, g] = canvas(size, size);
  const r = rng(7);
  g.fillStyle = "rgb(150,150,150)";
  g.fillRect(0, 0, size, size);
  const lines = size * 2.4;
  for (let i = 0; i < lines; i++) {
    const y = r() * size, len = size * (0.15 + r() * 0.85), x = r() * size;
    const v = r() < 0.5 ? 255 : 40;
    g.strokeStyle = `rgba(${v},${v},${v},${0.025 + r() * 0.1})`;
    g.lineWidth = 0.6 + r() * 1.1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (r() - 0.5) * 1.2);
    if (x + len > size) { g.moveTo(x - size, y); g.lineTo(x + len - size, y + (r() - 0.5) * 1.2); }
    g.stroke();
  }
  return dataTexture(c, true);
}

/** Geometry of the front perforation, shared by the mask and the shader that reads it. */
export const PLATE = { w: MACHINE.w - 0.26, h: 0.93, pitch: 0.05, hole: 0.0185 } as const;

/**
 * The porous front: a hex field of round holes whose radius breathes with low-frequency noise (denser, larger pores near
 * the centre and at random patches), like machined porous metal. White = metal, black = hole. Margin stays solid.
 */
export function perforationMask(tier: "high" | "low"): { mask: Texture; bump: Texture; aspect: number } {
  const W = tier === "high" ? 2048 : 1024;
  const aspect = PLATE.w / PLATE.h;
  const H = Math.round(W / aspect);
  const [c, g] = canvas(W, H);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#000";
  const px = W / PLATE.w;
  const noise = makeNoise(11, 6);
  const noise2 = makeNoise(23, 14);
  const rowH = PLATE.pitch * 0.866;
  const margin = 0.085;
  const rows = Math.floor((PLATE.h - margin * 2) / rowH);
  const cols = Math.floor((PLATE.w - margin * 2) / PLATE.pitch);
  const x0 = (PLATE.w - (cols - 0.5) * PLATE.pitch) / 2;
  const y0 = (PLATE.h - (rows - 1) * rowH) / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const wx = x0 + i * PLATE.pitch + (j % 2 ? PLATE.pitch / 2 : 0);
      const wy = y0 + j * rowH;
      const u = wx / PLATE.w, v = wy / PLATE.h;
      const centre = 1 - Math.min(1, Math.abs(u - 0.5) * 1.5);
      const k = 0.62 + 0.38 * noise(u, v) + 0.34 * (noise2(u, v) - 0.5) + 0.16 * centre;
      const rad = PLATE.hole * Math.min(1.12, Math.max(0.35, k));
      g.beginPath();
      g.arc(wx * px, wy * px, rad * px, 0, Math.PI * 2);
      g.fill();
    }
  }
  const [c2, g2] = canvas(W, H);
  try { g2.filter = `blur(${(W / 700).toFixed(2)}px)`; } catch { /* unsupported: unblurred bump is acceptable */ }
  g2.drawImage(c, 0, 0);
  return { mask: dataTexture(c), bump: dataTexture(c2), aspect };
}

/** Long thin vent slots near the back of the top face; white = slot. Used as the alphaMap of a near-black decal. */
export function ventTexture(): Texture {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = "#000";
  g.fillRect(0, 0, 1024, 1024);
  g.fillStyle = "#fff";
  const slots = 13;
  for (let i = 0; i < slots; i++) {
    const x = 80 + i * ((1024 - 160) / (slots - 1));
    const y0 = 90, y1 = 330;
    g.beginPath();
    g.roundRect(x - 5, y0, 10, y1 - y0, 5);
    g.fill();
  }
  return dataTexture(c);
}
