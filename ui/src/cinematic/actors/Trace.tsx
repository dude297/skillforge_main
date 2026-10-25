/* eslint-disable react-hooks/immutability -- imperative three.js objects live outside React state and are mutated in the frame loop */
// The trace: one luminous hairline that follows the work. A camera-facing ribbon (constant pixel width) along the route
// the work item is on; lit from the tail to the item (the head), brightest at the head, with a faint guide of the road
// ahead. It is the motif that carries into the product UI. Colour at the head is semantic and comes from the fold only.
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial, Vector2 } from "three";
import type { Choreo } from "./choreo";
import { ROUTES, type RouteId } from "./routes";
import { COL } from "./util";

const IDS: RouteId[] = ["full", "short", "refused", "skill"];

function ribbon(id: RouteId) {
  const r = ROUTES[id], n = r.n, pos = new Float32Array(n * 2 * 3), prv = new Float32Array(n * 2 * 3), nxt = new Float32Array(n * 2 * 3), side = new Float32Array(n * 2), u = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1) * 3, b = Math.min(n - 1, i + 1) * 3, c = i * 3;
    for (let s = 0; s < 2; s++) {
      const o = (i * 2 + s) * 3;
      for (let k = 0; k < 3; k++) { pos[o + k] = r.p[c + k]; prv[o + k] = r.p[a + k]; nxt[o + k] = r.p[b + k]; }
      side[i * 2 + s] = s === 0 ? -1 : 1; u[i * 2 + s] = i / (n - 1);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3)); g.setAttribute("aPrev", new Float32BufferAttribute(prv, 3)); g.setAttribute("aNext", new Float32BufferAttribute(nxt, 3));
  g.setAttribute("aSide", new Float32BufferAttribute(side, 1)); g.setAttribute("aU", new Float32BufferAttribute(u, 1)); g.setIndex(idx);
  return g;
}

const VS = /* glsl */ `
  attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute float aU;
  uniform vec2 uRes; uniform float uWidth; varying float vU; varying float vS;
  void main() {
    mat4 pv = projectionMatrix * viewMatrix;
    vec4 c = pv * vec4(position, 1.0), a = pv * vec4(aPrev, 1.0), b = pv * vec4(aNext, 1.0);
    float asp = uRes.x / uRes.y;
    vec2 d = (b.xy / b.w - a.xy / a.w) * vec2(asp, 1.0);
    float l = length(d);
    d = l > 1e-6 ? d / l : vec2(1.0, 0.0);
    vec2 off = vec2(-d.y, d.x) * aSide * uWidth / uRes.y;
    off.x /= asp;
    gl_Position = vec4(c.xy + off * c.w, c.z, c.w);
    vU = aU; vS = aSide;
  }`;
const FS = /* glsl */ `
  uniform float uHead; uniform float uTail; uniform float uAlpha; uniform float uGlow; uniform float uTime; uniform vec3 uColor; uniform vec3 uBase;
  varying float vU; varying float vS;
  void main() {
    float inSeg = smoothstep(uTail - 0.003, uTail + 0.012, vU) * (1.0 - smoothstep(uHead - 0.002, uHead + 0.002, vU));
    float dh = max(uHead - vU, 0.0);
    float body = 0.3 + 0.7 * exp(-dh * 7.0);
    float spark = exp(-dh * 55.0) * 2.2;
    float flow = smoothstep(0.82, 1.0, sin(vU * 190.0 - uTime * 7.0)) * 0.35 * inSeg;
    float guide = 0.05 * (1.0 - inSeg);
    vec3 col = mix(uBase, uColor, exp(-dh * 16.0));
    float edge = 1.0 - vS * vS * 0.6;
    float a = (inSeg * (body + spark + flow) + guide) * uAlpha * edge * uGlow;
    gl_FragColor = vec4(col * (1.0 + spark * 0.6), a);
    #include <colorspace_fragment>
  }`;

export function Trace({ ch }: { ch: Choreo }) {
  const geos = useMemo(() => IDS.map(ribbon), []);
  const made = useMemo(() => IDS.flatMap((id, i) => [1, 0].map((core) => {
    const m = new ShaderMaterial({
      uniforms: { uRes: { value: new Vector2(1440, 900) }, uWidth: { value: core ? 1.5 : 7 }, uHead: { value: 0 }, uTail: { value: 0 }, uAlpha: { value: 0 }, uGlow: { value: core ? 1 : 0.16 }, uTime: { value: 0 }, uColor: { value: new Color() }, uBase: { value: COL.signal.clone() } },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide,
    });
    const mesh = new Mesh(geos[i], m); mesh.frustumCulled = false; mesh.renderOrder = core ? 5 : 4; mesh.visible = false;
    return { id, core: !!core, m, mesh };
  })), [geos]);
  const size = useThree((s) => s.size), gl = useThree((s) => s.gl);

  useEffect(() => () => { geos.forEach((g) => g.dispose()); made.forEach((x) => x.m.dispose()); }, [geos, made]);

  useFrame((s) => {
    const t = ch.reduced ? 0 : s.clock.elapsedTime, pr = gl.getPixelRatio();
    for (const x of made) {
      const tr = ch.trace[x.id], u = x.m.uniforms;
      x.mesh.visible = tr.alpha > 0.01;
      if (!x.mesh.visible) continue;
      (u.uRes.value as Vector2).set(size.width * pr, size.height * pr);
      u.uWidth.value = (x.core ? 1.5 : 7) * pr;
      u.uHead.value = tr.head; u.uTail.value = tr.tail; u.uAlpha.value = tr.alpha; u.uTime.value = t;
      (u.uColor.value as Color).copy(tr.color).multiplyScalar(1.5);
    }
  });

  return <>{made.map((x, i) => <primitive key={i} object={x.mesh} />)}</>;
}
