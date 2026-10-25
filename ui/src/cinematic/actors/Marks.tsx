/* eslint-disable react-hooks/immutability, react-hooks/use-memo -- imperative three.js objects live outside React state and are mutated in the frame loop */
// Marks on the set that belong to the work, not to the set: the review desk's amber light pool (only while a person is
// needed), the gate's scan / pass pulse / failure flicker (only from the fold's verify state), the refusal stop line, and
// the probe that ties the independent gate to a skill being tested.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshBasicMaterial, RingGeometry, ShaderMaterial } from "three";
import type { Choreo } from "./choreo";
import { COL, HOVER, TAU, smooth } from "./util";
import { LAYOUT } from "../contract";
import { ROUTES } from "./routes";

const poolMat = () => new ShaderMaterial({
  uniforms: { uColor: { value: new Color() }, uI: { value: 0 } },
  vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform vec3 uColor; uniform float uI; varying vec2 vP;
    void main(){ float d = length(vP); float a = pow(max(1.0 - d, 0.0), 2.0) * uI; gl_FragColor = vec4(uColor * 1.2, a);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, toneMapped: false,
});
const addMat = (c = "#fff") => new MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, toneMapped: false });

export function Marks({ ch }: { ch: Choreo }) {
  const rv = LAYOUT.review, vf = LAYOUT.verify, st = LAYOUT.refusalStop;
  const reviewPool = useMemo(poolMat, []), reviewRingMat = useMemo(() => addMat(), []);
  const verifyPool = useMemo(poolMat, []), scanMat = useMemo(() => addMat(), []), passMat = useMemo(() => addMat(), []), passMat2 = useMemo(() => addMat(), []);
  const poolGeo = useMemo(() => new CircleGeometry(1, 48), []);
  const ring1 = useMemo(() => new RingGeometry(1.34, 1.37, 96), []), ring2 = useMemo(() => new RingGeometry(0.99, 1.0, 96), []), ring3 = useMemo(() => new RingGeometry(0.97, 1.0, 96), []);
  const stopGeo = useMemo(() => { const g = new BufferGeometry(); const w = 0.9, h = 1.9; g.setAttribute("position", new Float32BufferAttribute([-w, 0, 0, -w, h, 0, w, 0, 0, w, h, 0, -w, h, 0, w, h, 0, -w, 0.04, 0, w, 0.04, 0], 3)); return g; }, []);
  const stopMat = useMemo(() => new LineBasicMaterial({ color: COL.fail, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }), []);
  const stopLines = useMemo(() => new LineSegments(stopGeo, stopMat), [stopGeo, stopMat]);
  const probeGeo = useMemo(() => { const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(new Float32Array(28 * 3), 3)); return g; }, []);
  const probeMat = useMemo(() => new LineBasicMaterial({ color: COL.signal, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }), []);
  const probe = useMemo(() => { const l = new Line(probeGeo, probeMat); l.frustumCulled = false; return l; }, [probeGeo, probeMat]);
  const gRev = useRef<Group>(null), gVer = useRef<Group>(null), scanRef = useRef<Mesh>(null), passRef = useRef<Mesh>(null), pass2Ref = useRef<Mesh>(null), stopRef = useRef<Group>(null);
  const c = useMemo(() => new Color(), []);
  void LineLoop; void TAU;
  useEffect(() => () => { [reviewPool, reviewRingMat, verifyPool, scanMat, passMat, passMat2, stopMat, probeMat].forEach((m) => m.dispose()); [poolGeo, ring1, ring2, ring3, stopGeo, probeGeo].forEach((g) => g.dispose()); }, [reviewPool, reviewRingMat, verifyPool, scanMat, passMat, passMat2, stopMat, probeMat, poolGeo, ring1, ring2, ring3, stopGeo, probeGeo]);

  useFrame((s) => {
    const t = ch.reduced ? 0 : s.clock.elapsedTime;
    const v = ch.v;
    // review desk: amber light pool, exactly while the fold says a person is needed
    const rg = ch.reviewGlow;
    if (gRev.current) gRev.current.visible = rg > 0.01;
    reviewPool.uniforms.uI.value = rg * (0.34 + 0.06 * Math.sin(t * 1.6)); (reviewPool.uniforms.uColor.value as Color).copy(COL.warn);
    reviewRingMat.color.copy(COL.warn); reviewRingMat.opacity = rg * (0.55 + 0.15 * Math.sin(t * 1.6));
    // verification gate
    const scan = ch.verifyScan, pass = ch.verifyPass, fail = ch.verifyFail;
    if (gVer.current) gVer.current.visible = scan > 0.01 || pass > 0.01 || fail > 0.01;
    if (scanRef.current) { scanRef.current.position.y = 0.2 + (0.5 + 0.5 * Math.sin(t * 2.6)) * 2.2; scanRef.current.scale.setScalar(1.15); }
    scanMat.color.copy(COL.signal); scanMat.opacity = scan * 0.75;
    verifyPool.uniforms.uI.value = Math.max(scan * 0.22, fail * (0.3 + 0.12 * Math.sin(t * 9)), pass * 0.5);
    (verifyPool.uniforms.uColor.value as Color).copy(fail > 0.05 ? COL.fail : pass > 0.05 ? COL.verified : COL.signal);
    // the pass pulse is green by the fold's verify === "passed" edge only
    if (passRef.current) { passRef.current.scale.setScalar(0.5 + (1 - pass) * 3.2); passRef.current.visible = pass > 0.01; }
    if (pass2Ref.current) { pass2Ref.current.scale.setScalar(0.4 + (1 - pass) * 2.2); pass2Ref.current.visible = pass > 0.01; }
    passMat.color.copy(COL.verified); passMat.opacity = pass * 0.9; passMat2.color.copy(COL.verified); passMat2.opacity = pass * 0.6;
    // refusal: a hairline stop at the end of the road, appearing as the packet reaches it
    const refused = ch.routeId === "refused";
    const stopU = ROUTES.refused.a.stop;
    const sa = refused ? smooth(stopU - 0.14, stopU, ch.pkU.v) : 0;
    stopMat.opacity = sa * 0.85 * (0.75 + 0.25 * Math.sin(t * 7 * (1 - ch.shatter.v)));
    if (stopRef.current) stopRef.current.visible = sa > 0.01;
    // probe: the independent gate reaching toward a skill that is being tested
    const pr = ch.probe;
    probe.visible = pr > 0.02;
    if (probe.visible) {
      const a = HOVER.verify, b = ch.cryPos, pos = probeGeo.attributes.position;
      for (let i = 0; i < 28; i++) { const u = i / 27, arc = Math.sin(u * Math.PI) * 0.9; pos.setXYZ(i, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + arc, a.z + (b.z - a.z) * u); }
      pos.needsUpdate = true; probeMat.opacity = pr * (0.45 + 0.3 * Math.sin(t * 6)); probeMat.color.copy(c.copy(COL.signal));
    }
    void v;
  });

  return (
    <>
      <group ref={gRev} position={[rv[0], 0.03, rv[2]]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <mesh geometry={poolGeo} material={reviewPool} scale={2.6} renderOrder={1} />
        <mesh geometry={ring1} material={reviewRingMat} renderOrder={1} />
      </group>
      <group ref={gVer} position={[vf[0], 0.03, vf[2]]} visible={false}>
        <mesh geometry={poolGeo} material={verifyPool} scale={2.4} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} />
        <mesh ref={scanRef} geometry={ring2} material={scanMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} />
        <mesh ref={passRef} geometry={ring3} material={passMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={2} />
        <mesh ref={pass2Ref} geometry={ring3} material={passMat2} rotation={[0, Math.PI / 2, 0]} position={[0, 1.45, 0]} renderOrder={2} />
      </group>
      <group ref={stopRef} position={[st[0] + 0.55, 0.03, st[2]]} rotation={[0, Math.PI / 2 - 0.45, 0]} visible={false}>
        <primitive object={stopLines} />
      </group>
      <primitive object={probe} />
    </>
  );
}
