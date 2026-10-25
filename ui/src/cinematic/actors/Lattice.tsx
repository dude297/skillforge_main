/* eslint-disable react-hooks/immutability, react-hooks/use-memo -- imperative three.js objects live outside React state and are mutated in the frame loop */
// The proposal: an unresolved, brilliant lattice (nested hairline polyhedra with nodes and a hot core). It forms from the
// converging evidence, halts at the review desk under an amber rim, is scanned at the gate, and only RESOLVES (edges stop
// shimmering, green) when the fold says verify "passed". Edges crawl in dashes while it is unresolved; failed turns it rose.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending, BufferGeometry, Color, DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh, LineBasicMaterial,
  LineLoop, LineSegments, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, ShaderMaterial, SphereGeometry, Vector3,
} from "three";
import type { Choreo } from "./choreo";
import { createGlow } from "./fx";
import { COL, TAU, clamp01, rng } from "./util";

const D = new Object3D();
const TMP = new Color();
const RAD = 0.82;

/** merged edge geometry: outer icosphere, inner icosahedron, and strands between them; attributes drive shimmer + build order */
function buildEdges() {
  const r = rng(77);
  const pos: number[] = [], aT: number[] = [], aId: number[] = [], aOrder: number[] = [];
  const nodes: Vector3[] = [];
  const add = (g: BufferGeometry, scale: number, rotY: number, order0: number) => {
    const e = new EdgesGeometry(g, 1).attributes.position;
    for (let i = 0; i < e.count; i += 2) {
      const id = r();
      const a = new Vector3(e.getX(i), e.getY(i), e.getZ(i)).multiplyScalar(scale).applyAxisAngle(new Vector3(0, 1, 0), rotY);
      const b = new Vector3(e.getX(i + 1), e.getY(i + 1), e.getZ(i + 1)).multiplyScalar(scale).applyAxisAngle(new Vector3(0, 1, 0), rotY);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); aT.push(0, 1); aId.push(id, id);
      const o = order0 + ((a.y + b.y) / (2 * scale) * 0.5 + 0.5) * 0.45 + r() * 0.1; aOrder.push(o, o);
      for (const v of [a, b]) if (!nodes.some((n) => n.distanceToSquared(v) < 1e-6)) nodes.push(v.clone());
    }
  };
  const outer = new IcosahedronGeometry(RAD, 1), inner = new IcosahedronGeometry(RAD * 0.5, 0);
  add(outer, 1, 0, 0.0); add(inner, 1, 0.5, 0.35);
  // strands: every inner vertex to its three nearest outer vertices
  const outerNodes = nodes.filter((n) => n.length() > RAD * 0.8), innerNodes = nodes.filter((n) => n.length() <= RAD * 0.8);
  for (const a of innerNodes) {
    const nearest = [...outerNodes].sort((p, q) => p.distanceToSquared(a) - q.distanceToSquared(a)).slice(0, 3);
    for (const b of nearest) { const id = r(); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); aT.push(0, 1); aId.push(id, id); const o = 0.55 + r() * 0.4; aOrder.push(o, o); }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aT", new Float32BufferAttribute(aT, 1));
  g.setAttribute("aId", new Float32BufferAttribute(aId, 1));
  g.setAttribute("aOrder", new Float32BufferAttribute(aOrder, 1));
  outer.dispose(); inner.dispose();
  return { g, nodes };
}

const ringGeo = (rad: number) => {
  const p: number[] = [];
  for (let i = 0; i < 120; i++) p.push(Math.cos((i / 120) * TAU) * rad, 0, Math.sin((i / 120) * TAU) * rad);
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(p, 3)); return g;
};

export function Lattice({ ch }: { ch: Choreo }) {
  const root = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const rings = useRef<Group>(null);
  const { g, nodes } = useMemo(buildEdges, []);
  const lineMat = useMemo(() => new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uUnres: { value: 1 }, uForm: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new Color() } },
    vertexShader: /* glsl */ `
      attribute float aT; attribute float aId; attribute float aOrder;
      uniform float uTime; uniform float uUnres; uniform float uForm;
      varying float vT; varying float vId; varying float vShow;
      void main() {
        vec3 p = position;
        float j = sin(dot(p, vec3(12.9898, 78.233, 37.719)) * 3.0 + uTime * 3.1 + aId * 20.0);
        p += normalize(p + 1e-4) * j * uUnres * 0.05
           + vec3(sin(uTime * 1.7 + aId * 9.0), cos(uTime * 1.3 + aId * 7.0), sin(uTime * 1.9 + aId * 5.0)) * 0.014 * uUnres;
        vT = aT; vId = aId; vShow = smoothstep(aOrder, aOrder + 0.12, uForm);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uUnres; uniform float uAlpha; uniform vec3 uColor;
      varying float vT; varying float vId; varying float vShow;
      void main() {
        float dash = step(0.32, fract(vT * 2.0 - uTime * 0.55 * (0.5 + vId) + vId * 7.0));
        float un = clamp(uUnres, 0.0, 1.0);
        float a = vShow * uAlpha * mix(1.0, 0.25 + 0.75 * dash, un * 0.85);
        gl_FragColor = vec4(uColor * (1.15 + 0.5 * un * dash), a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }), []);
  const lines = useMemo(() => { const l = new LineSegments(g, lineMat); l.frustumCulled = false; l.renderOrder = 5; return l; }, [g, lineMat]);
  const nodeMat = useMemo(() => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#ffffff" }), []);
  const nodeGeo = useMemo(() => new OctahedronGeometry(0.036, 0), []);
  const nodeMesh = useMemo(() => { const m = new InstancedMesh(nodeGeo, nodeMat, nodes.length); m.frustumCulled = false; m.renderOrder = 5; return m; }, [nodeGeo, nodeMat, nodes.length]);
  const coreGeo = useMemo(() => new OctahedronGeometry(0.16, 0), []);
  const coreMat = useMemo(() => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#ffffff" }), []);
  const shellMat = useMemo(() => new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uI: { value: 0 } },
    vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 4.0); gl_FragColor = vec4(uColor * 1.3, f * uI);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false,
  }), []);
  const shellGeo = useMemo(() => new SphereGeometry(RAD * 1.32, 32, 20), []);
  const ringMat = useMemo(() => new LineBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#ffffff", opacity: 0 }), []);
  const ringLoops = useMemo(() => [ringGeo(RAD * 1.45), ringGeo(RAD * 1.2)].map((gg) => new LineLoop(gg, ringMat)), [ringMat]);
  const glow = useMemo(() => createGlow(2.0), []);
  const col = useMemo(() => new Color(), []);

  useEffect(() => () => { g.dispose(); lineMat.dispose(); nodeGeo.dispose(); nodeMat.dispose(); coreGeo.dispose(); coreMat.dispose(); shellMat.dispose(); shellGeo.dispose(); ringMat.dispose(); ringLoops.forEach((l) => l.geometry.dispose()); glow.mesh.geometry.dispose(); glow.mat.dispose(); }, [g, lineMat, nodeGeo, nodeMat, coreGeo, coreMat, shellMat, shellGeo, ringMat, ringLoops, glow]);

  useFrame((s) => {
    const a = ch.latAlpha;
    if (!root.current) return;
    if (a < 0.01) { root.current.visible = false; glow.mesh.visible = false; return; }
    root.current.visible = true;
    const t = ch.reduced ? 0 : s.clock.elapsedTime, form = ch.latForm;
    // colour from the fold: cyan agent / amber person / green verified / rose failed
    col.copy(COL.signal).lerp(COL.warn, ch.amber).lerp(COL.verified, ch.green).lerp(COL.fail, ch.rose);
    lineMat.uniforms.uTime.value = t; lineMat.uniforms.uUnres.value = ch.unres; lineMat.uniforms.uForm.value = form; lineMat.uniforms.uAlpha.value = a;
    (lineMat.uniforms.uColor.value as Color).copy(col);
    root.current.position.copy(ch.latPos);
    const sc = (0.34 + 0.66 * easeForm(form)) * (1 + (ch.reduced ? 0 : 0.025 * Math.sin(t * 2.2))) * (1 - 0.25 * ch.rose * Math.sin(t * 14) * (ch.reduced ? 0 : 1));
    root.current.scale.setScalar(sc);
    if (spin.current) { spin.current.rotation.y = t * 0.35; spin.current.rotation.x = 0.35 + 0.1 * Math.sin(t * 0.4); }
    if (rings.current) { rings.current.rotation.y = -t * 0.5; rings.current.rotation.z = t * 0.21; }
    ringMat.color.copy(col); ringMat.opacity = 0.55 * a * form;
    nodeMat.color.copy(TMP.copy(col).lerp(COL.white, 0.55)); nodeMat.opacity = a;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; const shown = clamp01((form - (n.y / RAD * 0.5 + 0.5) * 0.45) / 0.15);
      D.position.copy(n); D.scale.setScalar(shown * (1 + 0.3 * (1 - clamp01(ch.unres)) * 0)); D.updateMatrix(); nodeMesh.setMatrixAt(i, D.matrix);
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    coreMat.color.copy(TMP.copy(col).lerp(COL.white, 0.7)); coreMat.opacity = a * form;
    shellMat.uniforms.uI.value = a * form * (0.22 + 0.5 * ch.amber + 0.3 * ch.green); (shellMat.uniforms.uColor.value as Color).copy(col);
    const gp = ch.latPos, k = 1.6 + 0.3 * ch.amber;
    glow.set(gp.x, gp.y, gp.z, 3.0 * sc * (0.7 + 0.3 * k), col.r * 1.4, col.g * 1.4, col.b * 1.4, 0.55 * a * form);
  });

  return (
    <>
      <group ref={root} visible={false}>
        <group ref={spin}>
          <primitive object={lines} />
          <primitive object={nodeMesh} />
        </group>
        <mesh geometry={coreGeo} material={coreMat} renderOrder={5} />
        <mesh geometry={shellGeo} material={shellMat} renderOrder={4} />
        <group ref={rings}>{ringLoops.map((l, i) => <primitive key={i} object={l} />)}</group>
      </group>
      <primitive object={glow.mesh} />
    </>
  );
}
const easeForm = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
void Mesh;
