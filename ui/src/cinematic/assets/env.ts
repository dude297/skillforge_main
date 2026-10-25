// A procedural studio for reflections: dark room, a few emissive softboxes. Baked once into a PMREM cube and used only as the
// envMap of the set's own metals (the scene's other objects are untouched). This is what makes anodised metal read as metal.
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, PMREMGenerator, Scene, type WebGLRenderTarget, type WebGLRenderer } from "three";

function panel(scene: Scene, geo: BoxGeometry, rgb: [number, number, number], x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new Mesh(geo, new MeshBasicMaterial({ color: new Color().setRGB(rgb[0], rgb[1], rgb[2]) }));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  scene.add(m);
}

/** The caller owns the returned target: use `.texture` as envMap and `.dispose()` it on unmount. */
export function makeStudioEnv(gl: WebGLRenderer, tier: "high" | "low"): WebGLRenderTarget {
  const s = new Scene();
  s.background = new Color(0.006, 0.009, 0.014);
  const unit = new BoxGeometry(1, 1, 1);
  const cool: [number, number, number] = [0.8, 1.1, 1.5];
  // key: large overhead softbox, slightly toward the camera
  panel(s, unit, [cool[0] * 3.2, cool[1] * 3.2, cool[2] * 3.2], 0.5, 9, 2, 0, 0, 0);
  s.children[s.children.length - 1].scale.set(9, 0.2, 5);
  // two tall strips either side of the front: they draw the long highlights down the front bevels
  panel(s, unit, [cool[0] * 2.6, cool[1] * 2.6, cool[2] * 2.6], -6.5, 3.2, 6, 0, 0.5, 0);
  s.children[s.children.length - 1].scale.set(0.5, 6, 0.2);
  panel(s, unit, [cool[0] * 2.0, cool[1] * 2.0, cool[2] * 2.0], 7, 2.6, 5, 0, -0.55, 0);
  s.children[s.children.length - 1].scale.set(0.45, 5, 0.2);
  // rim: long cool-white bar behind and above, separates the silhouette from the void
  panel(s, unit, [1.7, 2.3, 3.0], -1, 3.4, -9, 0, 0, 0);
  s.children[s.children.length - 1].scale.set(11, 0.35, 0.2);
  // a faint low kicker so undersides and floor-facing bevels are not dead black
  panel(s, unit, [0.18, 0.24, 0.32], 0, -2.5, 5, 0, 0, 0);
  s.children[s.children.length - 1].scale.set(12, 0.4, 0.2);
  // dim cool walls and ceiling: a broad fill so every metal shows its form from any camera angle, never flat black
  const room = (rgb: [number, number, number], x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    panel(s, unit, rgb, x, y, z);
    s.children[s.children.length - 1].scale.set(sx, sy, sz);
  };
  room([0.16, 0.22, 0.3], 0, 15, 0, 34, 0.2, 34);
  room([0.045, 0.065, 0.1], 0, 5, -15, 34, 14, 0.2);
  room([0.04, 0.06, 0.09], -15, 5, 0, 0.2, 14, 34);
  room([0.04, 0.06, 0.09], 15, 5, 0, 0.2, 14, 34);
  room([0.03, 0.045, 0.07], 0, 5, 15, 34, 14, 0.2);
  const pm = new PMREMGenerator(gl);
  const rt = pm.fromScene(s, 0.02, 0.1, 100, { size: tier === "high" ? 256 : 128 });
  pm.dispose();
  for (const c of s.children) ((c as Mesh).material as MeshBasicMaterial).dispose();
  unit.dispose();
  return rt;
}
