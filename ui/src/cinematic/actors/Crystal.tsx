/* eslint-disable react-hooks/immutability, react-hooks/use-memo -- imperative three.js objects live outside React state and are mutated in the frame loop */
// The skill artifact: the hero. Code lines, test ticks and a version seal spiral in and condense into a precise faceted
// ingot with engraved hairlines. `phase` (from the fold) decides everything:
//   condensing       cyan, particles converging, facets crystallising out of a hot seed
//   awaiting_person  amber outline, the seal ring is open (unsealed): a person must promote it
//   stored           sealed (ring closed, hash ring lit), the only place green appears; it seats itself in the library slot
// The hash ring shows the REAL characters only when artifact.hash is a 64-char hex string; otherwise a regular engraved
// pattern with no digits (a placeholder that cannot be mistaken for a hash).
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedMesh, LatheGeometry, LineLoop, LineSegments, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, RingGeometry, ShaderMaterial, SRGBColorSpace,
  LinearMipmapLinearFilter, LinearFilter, Vector2,
} from "three";
import type { Choreo } from "./choreo";
import { createGlow } from "./fx";
import { lineGlyph, sealGlyph, tickGlyph } from "./glyphs";
import { COL, TAU, clamp01, rng, smooth } from "./util";

const D = new Object3D();
const TMP = new Color();
const HEX = "0123456789abcdef";
const PAT = 16; // atlas cell of the placeholder diamond; 17 = a dash
const COLS = 18;
const RING_R = 0.78;

let atlas: CanvasTexture | null = null;
function glyphAtlas() {
  if (atlas) return atlas;
  const cw = 40, ch = 64, c = document.createElement("canvas");
  c.width = cw * COLS; c.height = ch;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
  x.font = "600 44px ui-monospace, 'JetBrains Mono Variable', 'JetBrains Mono', Menlo, Consolas, monospace";
  for (let i = 0; i < 16; i++) x.fillText(HEX[i], i * cw + cw / 2, ch / 2 + 2);
  x.strokeStyle = "#fff"; x.lineWidth = 3; x.beginPath();
  const cx = PAT * cw + cw / 2, cy = ch / 2; x.moveTo(cx, cy - 15); x.lineTo(cx + 9, cy); x.lineTo(cx, cy + 15); x.lineTo(cx - 9, cy); x.closePath(); x.stroke();
  x.fillRect((PAT + 1) * cw + 8, ch / 2 - 1.5, cw - 16, 3);
  atlas = new CanvasTexture(c);
  atlas.colorSpace = SRGBColorSpace; atlas.minFilter = LinearMipmapLinearFilter; atlas.magFilter = LinearFilter; atlas.anisotropy = 4;
  return atlas;
}

const DISSOLVE = /* glsl */ `
  float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float dis(vec3 o, float f) { return f * 1.7 - length(o * vec3(1.0, 0.72, 1.0)) * 0.85 - h31(floor(o * 7.0)) * 0.34; }
`;

function buildBody() {
  const prof = [[0, -1.18], [0.3, -0.98], [0.66, -0.62], [0.66, 0.62], [0.3, 0.98], [0, 1.18]].map(([r, y]) => new Vector2(r, y));
  const body = new LatheGeometry(prof, 6);
  const edges = new EdgesGeometry(body, 12);
  // engraved panels: an inset rectangle and a diagonal on each of the six faces, a hair proud of the surface
  const pos: number[] = [];
  const ap = 0.66 * Math.cos(Math.PI / 6) + 0.004;
  for (let k = 0; k < 6; k++) {
    const th = (k + 0.5) * (Math.PI / 3), nx = Math.sin(th), nz = Math.cos(th), tx = Math.cos(th), tz = -Math.sin(th);
    const P = (u: number, y: number): [number, number, number] => [nx * ap + tx * u, y, nz * ap + tz * u];
    const hw = 0.19, y0 = -0.4, y1 = 0.4;
    const quad = [P(-hw, y0), P(hw, y0), P(hw, y1), P(-hw, y1)];
    for (let i = 0; i < 4; i++) pos.push(...quad[i], ...quad[(i + 1) % 4]);
    pos.push(...P(-hw, y0 + 0.16), ...P(hw, y0 + 0.16));
    pos.push(...P(-hw, y1 - 0.16), ...P(hw, y1 - 0.16));
  }
  const panels = new BufferGeometry(); panels.setAttribute("position", new Float32BufferAttribute(pos, 3));
  prof.length = 0;
  return { body, edges, panels };
}

function ringLine(n: number, rad: number, hex = false) {
  const p: number[] = [], u: number[] = [];
  const count = hex ? 6 : n;
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * TAU + (hex ? Math.PI / 6 : 0);
    p.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); u.push(i / count);
  }
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(p, 3)); g.setAttribute("aU", new Float32BufferAttribute(u, 1)); return g;
}

const RING_VS = "attribute float aU; varying float vU; void main(){ vU = aU; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }";
const RING_FS = `uniform vec3 uColor; uniform float uArc; uniform float uAlpha; varying float vU;
  void main(){ float a = uAlpha * (1.0 - smoothstep(uArc - 0.02, uArc, vU)); if (a < 0.003) discard; gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;
const ringMaterial = () => new ShaderMaterial({ uniforms: { uColor: { value: new Color() }, uArc: { value: 1 }, uAlpha: { value: 1 } }, vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });

const isHash = (h: string | null | undefined): h is string => !!h && /^[0-9a-f]{64}$/i.test(h);

export function Crystal({ ch, low }: { ch: Choreo; low: boolean }) {
  const beamRef = useRef<Mesh>(null), shockRef = useRef<Mesh>(null), hearthRef = useRef<Mesh>(null);
  const root = useRef<Group>(null), spin = useRef<Group>(null), collar = useRef<Group>(null), partRoot = useRef<Group>(null), sealRef = useRef<Group>(null);
  const G = useMemo(buildBody, []);
  const bodyMat = useMemo(() => new ShaderMaterial({
    uniforms: { uForm: { value: 0 }, uRim: { value: new Color() }, uSeal: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vObj; varying vec3 vView;
      void main() { vObj = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uForm; uniform vec3 uRim; uniform float uSeal; uniform float uAlpha;
      varying vec3 vObj; varying vec3 vView;
      ${DISSOLVE}
      vec3 env(vec3 r) {
        float y = r.y * 0.5 + 0.5;
        vec3 c = mix(vec3(0.012, 0.02, 0.034), vec3(0.09, 0.15, 0.22), smoothstep(0.0, 0.75, y));
        c += vec3(0.75, 0.93, 1.0) * pow(smoothstep(0.55, 0.98, r.y), 2.0) * 1.1;
        float az = atan(r.x, r.z);
        c += vec3(0.55, 0.88, 1.0) * smoothstep(0.14, 0.0, abs(az - 0.9)) * smoothstep(-0.25, 0.3, r.y) * 2.4;
        c += mix(uRim, vec3(1.0), 0.35) * smoothstep(0.1, 0.0, abs(az + 2.25)) * smoothstep(-0.3, 0.4, r.y) * 2.0;
        c += uRim * 0.5 * smoothstep(-0.2, -0.9, r.y);
        return c;
      }
      void main() {
        float d = dis(vObj, uForm);
        if (d < 0.0) discard;
        float edge = 1.0 - smoothstep(0.0, 0.16, d);
        vec3 N = normalize(cross(dFdx(vView), dFdy(vView)));
        vec3 V = normalize(-vView);
        if (dot(N, V) < 0.0) N = -N;
        float ndv = max(dot(N, V), 0.0);
        vec3 R = reflect(-V, N);
        vec3 Rw = (vec4(R, 0.0) * viewMatrix).xyz;
        vec3 No = normalize(cross(dFdx(vObj), dFdy(vObj)));
        float facet = h31(floor(No * 5.0 + 0.5));
        float F = pow(1.0 - ndv, 3.0);
        float core = pow(ndv, 2.0) * (0.55 + 0.45 * (1.0 - abs(vObj.y) / 1.2));
        vec3 col = mix(env(Rw) * 0.85, uRim * core * (0.9 + 0.5 * uSeal), 0.3) + uRim * F * 0.9;
        col *= 0.5 + 0.9 * facet;
        col += edge * mix(uRim, vec3(1.0), 0.65) * 2.6;
        gl_FragColor = vec4(col, uAlpha);
        #include <colorspace_fragment>
      }`,
    transparent: true, toneMapped: false,
  }), []);
  const lineMat = useMemo(() => new ShaderMaterial({
    uniforms: { uForm: { value: 0 }, uColor: { value: new Color() }, uAlpha: { value: 1 } },
    vertexShader: "varying vec3 vObj; void main(){ vObj = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform float uForm; uniform vec3 uColor; uniform float uAlpha; varying vec3 vObj; ${DISSOLVE}
      void main(){ if (dis(vObj, uForm) < 0.0) discard; gl_FragColor = vec4(uColor, uAlpha);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }), []);
  const edgeLines = useMemo(() => { const l = new LineSegments(G.edges, lineMat); l.renderOrder = 3; return l; }, [G, lineMat]);
  const panelLines = useMemo(() => { const l = new LineSegments(G.panels, lineMat); l.renderOrder = 3; return l; }, [G, lineMat]);

  // collar: two engraved hairline rings with the hash characters between them; hex seal ring around it
  const collarMats = useMemo(() => [ringMaterial(), ringMaterial()], []);
  const collarLoops = useMemo(() => [0.17, -0.17].map((y, i) => { const l = new LineLoop(ringLine(120, RING_R + 0.02), collarMats[i]); l.position.y = y; return l; }), [collarMats]);
  const sealMat = useMemo(() => ringMaterial(), []);
  const sealLoops = useMemo(() => [1.08, 1.2].map((r) => new LineLoop(ringLine(6, r, true), sealMat)), [sealMat]);
  const charGeo = useMemo(() => new PlaneGeometry(0.15, 0.2), []);
  const glyphAttr = useMemo(() => new InstancedBufferAttribute(new Float32Array(64), 1), []);
  const idxAttr = useMemo(() => { const a = new Float32Array(64); for (let i = 0; i < 64; i++) a[i] = i / 64; return new InstancedBufferAttribute(a, 1); }, []);
  const charMat = useMemo(() => new ShaderMaterial({
    uniforms: { uAtlas: { value: null }, uCols: { value: COLS }, uColor: { value: new Color() }, uAlpha: { value: 0 }, uReveal: { value: 0 } },
    vertexShader: `attribute float aGlyph; attribute float aIdx; varying vec2 vUv; varying float vG; varying float vI;
      void main(){ vUv = uv; vG = aGlyph; vI = aIdx; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D uAtlas; uniform float uCols; uniform vec3 uColor; uniform float uAlpha; uniform float uReveal; varying vec2 vUv; varying float vG; varying float vI;
      void main(){ float a = texture2D(uAtlas, vec2((vG + vUv.x) / uCols, vUv.y)).a; float on = smoothstep(vI, vI + 0.05, uReveal);
        gl_FragColor = vec4(uColor * 1.5, a * uAlpha * on);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, toneMapped: false,
  }), []);
  const chars = useMemo(() => {
    const m = new InstancedMesh(charGeo, charMat, 64);
    charGeo.setAttribute("aGlyph", glyphAttr); charGeo.setAttribute("aIdx", idxAttr);
    for (let i = 0; i < 64; i++) {
      const row = i < 32 ? 1 : 0, k = i % 32, a = (k / 32) * TAU;
      // normal pointing outward, characters upright, reading around the ring
      D.position.set(Math.sin(a) * (RING_R + 0.01), row ? 0.085 : -0.085, Math.cos(a) * (RING_R + 0.01));
      D.rotation.set(0, a, 0); D.scale.set(0.5, 0.5, 0.5); D.updateMatrix(); m.setMatrixAt(i, D.matrix);
    }
    m.frustumCulled = false; m.renderOrder = 4; return m;
  }, [charGeo, charMat, glyphAttr, idxAttr]);
  const lastHash = useRef<string | null | undefined>(undefined);

  // condensing particles
  const NC = low ? 34 : 150, NT = low ? 8 : 26, NS = low ? 3 : 6;
  const P = useMemo(() => {
    const r = rng(4242), mk = (n: number) => ({ R: new Float32Array(n), a0: new Float32Array(n), y0: new Float32Array(n), dly: new Float32Array(n), sw: new Float32Array(n), len: new Float32Array(n), roll: new Float32Array(n) });
    const out = { code: mk(NC), tick: mk(NT), seal: mk(NS) };
    for (const [key, o] of Object.entries(out)) {
      const n = o.R.length, isCode = key === "code";
      for (let i = 0; i < n; i++) {
        o.R[i] = (isCode ? 1.8 : 1.5) + r() * (isCode ? 2.0 : 1.4); o.a0[i] = r() * TAU; o.y0[i] = (r() - 0.35) * 3.2; o.dly[i] = (isCode ? 0 : key === "tick" ? 0.18 : 0.4) + r() * 0.36;
        o.sw[i] = (r() < 0.5 ? -1 : 1) * (4 + r() * 4); o.len[i] = isCode ? 0.16 + r() * 0.34 : key === "tick" ? 0.26 : 0.36; o.roll[i] = (r() - 0.5) * 0.4;
      }
    }
    return out;
  }, [NC, NT, NS]);
  const partMat = useMemo(() => new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }), []);
  const partMeshes = useMemo(() => [[lineGlyph(), NC], [tickGlyph(), NT], [sealGlyph(), NS]].map(([g, n]) => {
    const m = new InstancedMesh(g as BufferGeometry, partMat, n as number); m.frustumCulled = false; m.renderOrder = 4;
    for (let i = 0; i < (n as number); i++) m.setColorAt(i, TMP.setRGB(0, 0, 0));
    return m;
  }), [NC, NT, NS, partMat]);

  const beamGeo = useMemo(() => new CylinderGeometry(0.02, 0.02, 1, 6, 1, true), []);
  const beamMat = useMemo(() => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#ffffff", opacity: 0 }), []);
  const shockGeo = useMemo(() => new RingGeometry(0.97, 1, 96), []);
  const shockMat = useMemo(() => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#ffffff", opacity: 0, side: DoubleSide }), []);
  const hearthMat = useMemo(() => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#ffffff", opacity: 0, side: DoubleSide }), []);
  const hearthGeo = useMemo(() => new RingGeometry(1.22, 1.25, 96), []);
  const glow = useMemo(() => createGlow(1.8), []);
  const glow2 = useMemo(() => createGlow(3.2), []);
  const rim = useMemo(() => new Color(), []);
  const st = useRef({ lastForm: 0, shock: 0, lastPhase: "" as string, probeGeo: null as BufferGeometry | null });

  useEffect(() => { charMat.uniforms.uAtlas.value = glyphAtlas(); }, [charMat]);
  useEffect(() => () => {
    G.body.dispose(); G.edges.dispose(); G.panels.dispose(); bodyMat.dispose(); lineMat.dispose(); collarMats.forEach((m) => m.dispose()); sealMat.dispose(); charGeo.dispose(); charMat.dispose();
    partMat.dispose(); partMeshes.forEach((m) => { m.geometry.dispose(); m.dispose(); }); beamGeo.dispose(); beamMat.dispose(); shockGeo.dispose(); shockMat.dispose(); hearthMat.dispose(); hearthGeo.dispose();
    collarLoops.forEach((l) => l.geometry.dispose()); sealLoops.forEach((l) => l.geometry.dispose()); glow.mesh.geometry.dispose(); glow.mat.dispose(); glow2.mesh.geometry.dispose(); glow2.mat.dispose();
  }, [G, bodyMat, lineMat, collarMats, sealMat, charGeo, charMat, partMat, partMeshes, beamGeo, beamMat, shockGeo, shockMat, hearthMat, hearthGeo, collarLoops, sealLoops, glow, glow2]);

  useFrame((s, dt) => {
    const a = ch.cryAlpha;
    if (!root.current || !partRoot.current) return;
    const form = ch.cryForm;
    const S = st.current;
    if (a < 0.01) { root.current.visible = false; partRoot.current.visible = false; glow.mesh.visible = false; glow2.mesh.visible = false; S.lastForm = 0; return; }
    const phase = ch.phase, v = ch.v, t = ch.reduced ? 0 : s.clock.elapsedTime;
    rim.copy(COL.signal).lerp(COL.warn, ch.cryAwait).lerp(COL.verified, ch.cryGreen);
    const seal = ch.seal.v;

    // ---- body
    root.current.visible = form > 0.02;
    root.current.position.copy(ch.cryPos);
    const sc = ch.cryScale.v * (0.96 + 0.04 * Math.min(1, form * 1.2));
    root.current.scale.setScalar(sc);
    if (spin.current) spin.current.rotation.y = ch.reduced ? 0.6 : t * (phase === "condensing" ? 0.7 : phase === "awaiting_person" ? 0.16 : 0.28) + 0.6;
    bodyMat.uniforms.uForm.value = form; bodyMat.uniforms.uSeal.value = seal; bodyMat.uniforms.uAlpha.value = a;
    (bodyMat.uniforms.uRim.value as Color).copy(rim);
    lineMat.uniforms.uForm.value = form; lineMat.uniforms.uAlpha.value = a * (0.75 + 0.25 * ch.cryAwait);
    (lineMat.uniforms.uColor.value as Color).copy(rim).lerp(COL.white, 0.45 + 0.2 * ch.cryGreen).multiplyScalar(1.6);

    // ---- collar: hairlines + hash/pattern characters
    const hash = v?.artifact?.hash;
    if (lastHash.current !== hash) {
      lastHash.current = hash;
      const real = isHash(hash);
      for (let i = 0; i < 64; i++) glyphAttr.setX(i, real ? HEX.indexOf(hash![i].toLowerCase()) : i % 2 === 0 ? PAT : PAT + 1);
      glyphAttr.needsUpdate = true;
    }
    const showCollar = clamp01((form - 0.82) / 0.18) * a;
    const reveal = phase === "stored" ? seal : phase === "awaiting_person" ? 0.55 : 0.3 * showCollar;
    const collarCol = TMP.copy(rim).lerp(COL.white, 0.35);
    charMat.uniforms.uReveal.value = reveal * 1.05; charMat.uniforms.uAlpha.value = showCollar * (0.35 + 0.65 * Math.max(seal, ch.cryAwait * 0.75));
    (charMat.uniforms.uColor.value as Color).copy(collarCol);
    for (const m of collarMats) { (m.uniforms.uColor.value as Color).copy(collarCol).multiplyScalar(1.3); m.uniforms.uAlpha.value = showCollar * 0.9; m.uniforms.uArc.value = 1; }
    if (collar.current) collar.current.rotation.y = ch.reduced ? 0.2 : -t * 0.2 + 0.2;
    // the version seal: open (unsealed) while a person is needed, closed once stored
    (sealMat.uniforms.uColor.value as Color).copy(rim).lerp(COL.white, 0.4).multiplyScalar(1.4);
    sealMat.uniforms.uAlpha.value = clamp01((form - 0.8) / 0.2) * a * (phase === "condensing" ? 0.45 : 0.85);
    sealMat.uniforms.uArc.value = phase === "stored" ? 0.02 + 0.98 * smooth(0, 0.9, seal) : phase === "awaiting_person" ? 0.68 : 0.4 * clamp01((form - 0.85) / 0.15);
    if (sealRef.current) sealRef.current.rotation.y = ch.reduced ? 0.4 : t * 0.16 * (phase === "stored" ? 0.4 : 1);

    // ---- edge events: crystallised / sealed / promoted flash
    if (S.lastForm < 0.97 && form >= 0.97 && !ch.reduced) S.shock = 1;
    if (S.lastPhase !== phase) { if (phase === "stored" && S.lastPhase !== "" && !ch.reduced) S.shock = 1; S.lastPhase = phase ?? ""; }
    S.lastForm = form; S.shock = Math.max(0, S.shock - dt * 0.9);
    const shock = S.shock;
    shockMat.opacity = shock * 0.8 * a; shockMat.color.copy(rim);
    const shockMesh = shockRef.current;
    if (shockMesh) { shockMesh.visible = shock > 0.01; shockMesh.scale.setScalar(0.9 + (1 - shock) * 3.4 * ch.cryScale.v / 0.85); shockMesh.rotation.x = -Math.PI / 2; }

    // ---- condensing particles (world-space group at the crystal)
    const parts = form < 0.995 && (phase === "condensing" || form < 0.995) && !ch.reduced;
    partRoot.current.visible = a > 0.02;
    partRoot.current.position.copy(ch.cryPos);
    for (const m of partMeshes) m.visible = parts;
    if (parts) {
      const kinds = [P.code, P.tick, P.seal] as const;
      for (let ki = 0; ki < 3; ki++) {
        const o = kinds[ki], m = partMeshes[ki], n = o.R.length;
        for (let i = 0; i < n; i++) {
          const q = clamp01((form * 1.38 - o.dly[i]) / 0.72), r = o.R[i] * Math.pow(1 - q, 1.6), ang = o.a0[i] + q * o.sw[i] + t * 0.15;
          D.position.set(Math.cos(ang) * r, o.y0[i] * Math.pow(1 - q, 1.2), Math.sin(ang) * r);
          D.rotation.set(0, Math.PI / 2 - ang, o.roll[i]);
          const sz = o.len[i] * smooth(0, 0.12, q) * (1 - smooth(0.82, 1, q)) * a;
          D.scale.set(sz, ki === 0 ? sz * 1.0 : sz, sz); D.updateMatrix(); m.setMatrixAt(i, D.matrix);
          const b = (0.55 + 1.3 * q) * (ki === 1 ? 1.05 : 1);
          m.setColorAt(i, TMP.setRGB((0.5 + 0.5 * q) * b * 0.8, (0.85 + 0.15 * q) * b, 1.0 * b));
        }
        m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
    // the forge axis: a thin column of light through the crystal, and the hearth ring on the floor
    const beam = beamRef.current;
    const axis = clamp01(1.15 - form) * a * (phase === "condensing" ? 1 : 0);
    beamMat.opacity = 0.22 * axis; beamMat.color.copy(rim);
    if (beam) { beam.visible = axis > 0.01; const top = ch.cryPos.y + 2.2, bot = 0.02; beam.scale.set(1, top - bot, 1); beam.position.set(0, (top + bot) / 2 - ch.cryPos.y, 0); }
    const hearth = hearthRef.current;
    hearthMat.opacity = a * (0.18 + 0.4 * clamp01(form)) * (phase === "stored" ? 0 : 1); hearthMat.color.copy(rim);
    if (hearth) { hearth.visible = hearthMat.opacity > 0.01; hearth.position.set(0, -ch.cryPos.y + 0.025, 0); hearth.rotation.x = -Math.PI / 2; hearth.scale.setScalar(1 + 0.03 * Math.sin(t * 2)); }

    // ---- light that comes from the skill: a hot seed that becomes a steady inner glow
    const p = ch.cryPos;
    const seed = (1 - smooth(0.2, 0.9, form)) * (0.5 + 0.5 * smooth(0, 0.3, form));
    glow.set(p.x, p.y, p.z, (0.5 + 1.2 * form) * ch.cryScale.v / 0.85 * 2.2, rim.r * 1.3 + seed * 0.6, rim.g * 1.3 + seed * 0.6, rim.b * 1.3 + seed * 0.6, (0.3 + 0.45 * seed + 0.2 * form) * a);
    glow2.set(p.x, p.y, p.z, 5.5 * ch.cryScale.v / 0.85, rim.r, rim.g, rim.b, (0.12 + 0.2 * form + 0.5 * S.shock) * a);
  });

  return (
    <>
      <group ref={root} visible={false}>
        <group ref={spin} scale={[1, 1, 0.86]}>
          <mesh geometry={G.body} material={bodyMat} renderOrder={2} />
          <primitive object={edgeLines} />
          <primitive object={panelLines} />
        </group>
        <group rotation={[0.22, 0, 0.06]}>
        <group ref={collar}>
          {collarLoops.map((l, i) => <primitive key={i} object={l} />)}
          <primitive object={chars} />
        </group>
        <group ref={sealRef}>{sealLoops.map((l, i) => <primitive key={i} object={l} />)}</group>
        </group>
      </group>
      <group ref={partRoot} visible={false}>
        {partMeshes.map((m, i) => <primitive key={i} object={m} />)}
        <mesh ref={beamRef} geometry={beamGeo} material={beamMat} renderOrder={3} />
        <mesh ref={shockRef} geometry={shockGeo} material={shockMat} renderOrder={4} />
        <mesh ref={hearthRef} geometry={hearthGeo} material={hearthMat} renderOrder={3} />
      </group>
      <primitive object={glow.mesh} />
      <primitive object={glow2.mesh} />
    </>
  );
}
