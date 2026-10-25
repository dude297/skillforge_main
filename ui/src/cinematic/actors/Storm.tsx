/* eslint-disable react-hooks/immutability -- imperative three.js objects live outside React state and are mutated in the frame loop */
// The incident storm: layered evidence (log lines, metric sparklines, config blocks, deploy markers) streams from the
// intake along curved lanes into the GB10's investigation orbit, is scanned there ring by ring, then spirals into the
// proposal (or into the skill being written). Instanced; no per-frame allocation. Low tier: fewer fragments, no trails.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending, BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, LineBasicMaterial, LineLoop,
  MeshBasicMaterial, Object3D, ShaderMaterial,
} from "three";
import type { Choreo } from "./choreo";
import { configGlyph, deployGlyph, logGlyph, metricGlyph } from "./glyphs";
import { createGlow, createSegments } from "./fx";
import { COL, HOVER, TAU, clamp01, rng, smooth } from "./util";

const D = new Object3D();
const TMP = new Color();
const KIND_MIX = [0.38, 0.22, 0.22, 0.18];
const LAYER_R = [2.1, 2.7, 3.4];
const LAYER_SCALE = [1.1, 0.9, 0.7];
const LAYER_BR = [1, 0.72, 0.46];
const LAYER_W = [0.5, -0.38, 0.28];
const LAYER_SWING: [number, number][] = [[0.6, 3.4], [3.5, 0.4], [0.4, -3.4]]; // [dy, dz] of the lane's bow
const KIND_SCALE = [0.5, 0.46, 0.4, 0.4];
const TINTS = ["#82D8FF", "#CDEEFF", "#5BB4E6", "#A5E4FF"].map((h) => new Color(h));
const SPAWN = { x: -10.9, y: 0.25, z: 0 };
const O = HOVER.orbit, T = HOVER.machine, TC = HOVER.hero;

function build(n: number) {
  const r = rng(20261025);
  const kind = new Uint8Array(n), layer = new Uint8Array(n), slot = new Uint16Array(n);
  const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
  const c1x = new Float32Array(n), c1y = new Float32Array(n), c1z = new Float32Array(n), c2x = new Float32Array(n), c2y = new Float32Array(n), c2z = new Float32Array(n);
  const a0 = new Float32Array(n), w = new Float32Array(n), R = new Float32Array(n), h = new Float32Array(n), ph = new Float32Array(n), d = new Float32Array(n);
  const sc = new Float32Array(n), br = new Float32Array(n), yaw = new Float32Array(n), tilt = new Float32Array(n), roll = new Float32Array(n), tint = new Uint8Array(n);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const q = r(); const k = q < KIND_MIX[0] ? 0 : q < KIND_MIX[0] + KIND_MIX[1] ? 1 : q < KIND_MIX[0] + KIND_MIX[1] + KIND_MIX[2] ? 2 : 3;
    kind[i] = k; slot[i] = counts[k]++;
    const L = i % 3; layer[i] = L;
    sx[i] = SPAWN.x + r() * 1.0; sy[i] = SPAWN.y + r() * 2.5; sz[i] = SPAWN.z + (r() - 0.5) * 2.6;
    const [sy2, sz2] = LAYER_SWING[L];
    c1x[i] = 3.0 + r() * 1.6; c1y[i] = sy2 * (0.6 + r() * 0.7) - (L === 1 ? 0 : 0.2); c1z[i] = sz2 * (0.6 + r() * 0.7);
    c2x[i] = -3.8 - r() * 1.2; c2y[i] = sy2 * (0.25 + r() * 0.4); c2z[i] = sz2 * (0.4 + r() * 0.5);
    a0[i] = r() * TAU; w[i] = LAYER_W[L] * (0.8 + r() * 0.4); R[i] = LAYER_R[L] + (r() - 0.5) * 0.5;
    h[i] = (r() - 0.5) * (1.2 + L * 0.5); ph[i] = r() * TAU; d[i] = k * 0.04 + r() * 0.62;
    sc[i] = KIND_SCALE[k] * LAYER_SCALE[L] * (0.85 + r() * 0.3); br[i] = LAYER_BR[L] * (0.7 + r() * 0.5);
    yaw[i] = (r() - 0.5) * 1.1; tilt[i] = (r() - 0.5) * 0.5; roll[i] = (r() - 0.5) * 0.6; tint[i] = Math.floor(r() * TINTS.length);
  }
  return { n, kind, layer, slot, sx, sy, sz, c1x, c1y, c1z, c2x, c2y, c2z, a0, w, R, h, ph, d, sc, br, yaw, tilt, roll, tint, counts };
}

export function Storm({ ch, low }: { ch: Choreo; low: boolean }) {
  const N = low ? 96 : 360;
  const P = useMemo(() => build(N), [N]);
  const kinds = useMemo(() => [logGlyph(), metricGlyph(), configGlyph(), deployGlyph()], []);
  const mat = useMemo(() => new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }), []);
  const meshes = useMemo(() => kinds.map((g, k) => {
    const m = new InstancedMesh(g, mat, Math.max(1, P.counts[k]));
    m.frustumCulled = false; m.renderOrder = 3;
    m.instanceColor = null;
    for (let j = 0; j < P.counts[k]; j++) m.setColorAt(j, TMP.setRGB(0, 0, 0));
    return m;
  }), [kinds, mat, P]);
  const trails = useMemo(() => (low ? null : createSegments(N, 1.6)), [low, N]);
  const lag = useMemo(() => new Float32Array(N * 3), [N]);
  const state = useRef({ hidden: true, resetLag: true });
  const group = useRef<Group>(null);
  const fanMesh = useRef<Group>(null);
  const rings = useRef<Group>(null);
  const ringMat = useMemo(() => new LineBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, color: COL.signal, opacity: 0, toneMapped: false }), []);
  const ringGeos = useMemo(() => LAYER_R.map((rad) => {
    const pts: number[] = [];
    for (let i = 0; i <= 96; i++) pts.push(Math.cos((i / 96) * TAU) * rad, 0, Math.sin((i / 96) * TAU) * rad * 0.78);
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(pts, 3)); return g;
  }), []);
  const ringLoops = useMemo(() => ringGeos.map((g) => new LineLoop(g, ringMat)), [ringGeos, ringMat]);
  const fanGeo = useMemo(() => new CircleGeometry(3.7, 40, 0, 0.8), []);
  const fanMat = useMemo(() => new ShaderMaterial({
    uniforms: { uI: { value: 0 }, uColor: { value: COL.signal.clone() } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform float uI; uniform vec3 uColor; varying vec3 vP;
      void main(){ float th = atan(vP.y, vP.x) / 0.8; float r = length(vP.xy) / 3.7;
        float a = pow(clamp(1.0 - th, 0.0, 1.0), 2.6) * smoothstep(0.1, 0.35, r) * (0.35 + 0.65 * r) * uI;
        a += smoothstep(0.035, 0.0, th) * smoothstep(0.1, 0.5, r) * uI * 0.8;
        gl_FragColor = vec4(uColor * 1.4, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, toneMapped: false,
  }), []);
  const glow = useMemo(() => createGlow(2.6), []);
  const gl = useThree((s) => s.gl);

  useEffect(() => () => { kinds.forEach((g) => g.dispose()); mat.dispose(); meshes.forEach((m) => m.dispose()); trails?.mesh.geometry.dispose(); trails?.mesh.material.dispose(); ringGeos.forEach((g) => g.dispose()); ringMat.dispose(); fanGeo.dispose(); fanMat.dispose(); glow.mesh.geometry.dispose(); glow.mat.dispose(); }, [kinds, mat, meshes, trails, ringGeos, ringMat, fanGeo, fanMat, glow]);

  useFrame((s) => {
    const a = ch.stormAlpha;
    const st = state.current;
    if (a < 0.004) {
      if (!st.hidden) { st.hidden = true; if (group.current) group.current.visible = false; glow.mesh.visible = false; }
      st.resetLag = true;
      return;
    }
    if (st.hidden) { st.hidden = false; if (group.current) group.current.visible = true; }
    const t = ch.orbitClock, stream = ch.stream.v, k = ch.collapse.v, scan = ch.scan;
    const sa = t * 1.7, toCrystal = ch.collapseToCrystal ? 1 : 0;
    const dt = ch.dt, lagK = 1 - Math.exp(-9 * dt);
    const ease = a * a * (3 - 2 * a);
    const kk = 1 - k, shrink = Math.pow(kk, 1.7), grow = Math.pow(kk, 0.6);
    const rot = k * 4.2, cr = Math.cos(rot), sr = Math.sin(rot);
    const reduced = ch.reduced;
    const tg = ch.collapseToCrystal ? TC : T; // the evidence converges on the proposal, or on the skill being written
    for (let i = 0; i < P.n; i++) {
      const A = P.a0[i] + P.w[i] * t;
      const ca = Math.cos(A), sa2 = Math.sin(A);
      const ex = O.x + P.R[i] * ca, ez = O.z + P.R[i] * sa2 * 0.78;
      const ey = O.y + P.h[i] + 0.28 * Math.sin(2 * A + P.ph[i]) + (ez - O.z) * 0.16;
      const u = clamp01(stream * 1.75 - P.d[i]);
      let px: number, py: number, pz: number;
      if (u >= 1) { px = ex; py = ey; pz = ez; } else {
        const ue = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
        const iu = 1 - ue, b0 = iu * iu * iu, b1 = 3 * iu * iu * ue, b2 = 3 * iu * ue * ue, b3 = ue * ue * ue;
        const sx = P.sx[i], sy = P.sy[i], sz = P.sz[i];
        px = b0 * sx + b1 * (sx + P.c1x[i]) + b2 * (ex + P.c2x[i]) + b3 * ex;
        py = b0 * sy + b1 * (sy + P.c1y[i]) + b2 * (ey + P.c2y[i]) + b3 * ey + Math.sin(ue * 9 + P.ph[i]) * 0.12 * Math.sin(ue * Math.PI);
        pz = b0 * sz + b1 * (sz + P.c1z[i]) + b2 * (ez + P.c2z[i]) + b3 * ez;
      }
      if (k > 0) { // spiral into the proposal / skill
        const dx = px - tg.x, dy = py - tg.y, dz = pz - tg.z;
        px = tg.x + (dx * cr - dz * sr) * shrink; pz = tg.z + (dx * sr + dz * cr) * shrink; py = tg.y + dy * shrink;
      }
      // scan: the fan lights fragments it passes (once they are in orbit)
      let da = ((A - sa) % TAU + TAU) % TAU; if (da > Math.PI) da -= TAU;
      const hl = u >= 1 ? Math.exp(-da * da * 5) * scan : 0;
      const arrive = smooth(0, 0.07, u);
      const L = P.layer[i];
      const size = P.sc[i] * arrive * grow * (0.85 + 0.3 * hl) * ease;
      const bright = P.br[i] * (0.5 + 2.1 * hl + 2.2 * Math.sin(Math.PI * k) * (0.5 + 0.5 * toCrystal)) * (reduced ? 1 : 0.92 + 0.08 * Math.sin(s.clock.elapsedTime * 3 + P.ph[i] * 4)) * ease;
      const kind = P.kind[i];
      const m = meshes[kind];
      const wob = reduced ? 0 : 1;
      D.position.set(px, py, pz);
      D.rotation.set(P.tilt[i] + (kind === 1 ? 0.25 * Math.sin(t * 0.9 + P.ph[i]) * wob : 0), P.yaw[i] + 0.35 * Math.sin(t * 0.7 + P.ph[i]) * wob + (kind === 3 ? t * 0.8 * wob : 0), P.roll[i] + 0.15 * Math.sin(t * 0.8 + P.ph[i] * 2) * wob);
      D.scale.set(size * (kind === 1 && P.slot[i] % 2 ? -1 : 1), size, size);
      D.updateMatrix();
      m.setMatrixAt(P.slot[i], D.matrix);
      const tc = TINTS[P.tint[i]], white = 0.7 * smooth(0, 0.9, k);
      m.setColorAt(P.slot[i], TMP.setRGB((tc.r + (1 - tc.r) * white) * bright, (tc.g + (1 - tc.g) * white) * bright, (tc.b + (1 - tc.b) * white) * bright));
      if (trails) {
        const o = i * 3;
        if (st.resetLag) { lag[o] = px; lag[o + 1] = py; lag[o + 2] = pz; }
        lag[o] += (px - lag[o]) * lagK; lag[o + 1] += (py - lag[o + 1]) * lagK; lag[o + 2] += (pz - lag[o + 2]) * lagK;
        const tb = bright * 0.55 * (L === 0 ? 1 : 0.8) * (size > 0.02 ? 1 : 0);
        trails.set(i, px, py, pz, lag[o], lag[o + 1], lag[o + 2], 0.35 * tb, 0.75 * tb, 1.0 * tb, 1);
      }
    }
    st.resetLag = false;
    for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    if (trails) { trails.commit(); trails.res.set(s.size.width * gl.getPixelRatio(), s.size.height * gl.getPixelRatio()); (trails.mesh.material as ShaderMaterial).uniforms.uWidth.value = 1.5 * gl.getPixelRatio(); }

    // the investigation scan: a radar fan and the three band rings
    fanMat.uniforms.uI.value = scan * a * 0.55;
    if (fanMesh.current) { fanMesh.current.rotation.y = -sa; fanMesh.current.visible = scan * a > 0.02; }
    ringMat.opacity = scan * a * 0.22;
    if (rings.current) rings.current.visible = ringMat.opacity > 0.004;
    // an emission flash at the intake while the evidence leaves it
    const em = (1 - smooth(0.0, 0.85, stream)) * a * (reduced ? 0 : 1);
    glow.set(SPAWN.x + 0.5, 1.5, 0, 4.2, COL.signal.r * 1.3, COL.signal.g * 1.3, COL.signal.b * 1.3, 0.55 * em);
  });

  return (
    <group ref={group} visible={false}>
      {meshes.map((m, i) => <primitive key={i} object={m} />)}
      {trails ? <primitive object={trails.mesh} /> : null}
      <group ref={fanMesh} position={[O.x, O.y - 0.35, O.z]} scale={[1, 1, 0.78]}>
        <mesh geometry={fanGeo} material={fanMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} />
      </group>
      <group ref={rings} position={[O.x, O.y - 0.35, O.z]}>
        {ringLoops.map((l, i) => <primitive key={i} object={l} />)}
      </group>
      <primitive object={glow.mesh} />
    </group>
  );
}
