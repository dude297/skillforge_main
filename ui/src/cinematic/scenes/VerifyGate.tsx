// The independent verification gate: a tunnel of hairline arches along the travel axis, standing apart from the machine.
// Neutral when idle; a cyan sweep runs through it while checking; verified green ONLY when visual.verify === "passed"; rose on failure.
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Euler, Quaternion, Vector3 } from "three";
import { LAYOUT, type CineVisual } from "../contract";
import { GATE } from "../assets/dims";
import { archRing, roundedBox } from "../assets/geometry";
import { COL } from "../materials/palette";
import { makeSweep } from "../materials/light";
import { damp, type Rig } from "./rig";
import type { SetAssets } from "./useAssets";

const POS = [...LAYOUT.verify] as [number, number, number];
const sweepGeo = new PlaneGeometry(GATE.w - 0.12, GATE.h - 0.06);
const ribGeo = archRing(GATE.w, GATE.h, 0.032, 0.03, 0.003);

export const VerifyGate = memo(function VerifyGate({ assets, rig, visual }: { assets: SetAssets; rig: Rig; visual: CineVisual }) {
  const ribs = useRef<InstancedMesh>(null);
  const ribMat = useMemo(() => new MeshBasicMaterial({ color: new Color(1, 1, 1), toneMapped: false }), []);
  const beam = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  const sweep = useMemo(() => makeSweep(), []);
  const sweepMesh = useRef<import("three").Mesh>(null);
  const work = useMemo(() => ({ target: new Color(), col: new Color(), tmp: new Color() }), []);
  useEffect(() => () => { ribMat.dispose(); beam.dispose(); sweep.material.dispose(); }, [ribMat, beam, sweep]);

  useEffect(() => {
    const m = ribs.current;
    if (!m) return;
    const mat = new Matrix4();
    const q = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
    const one = new Vector3(1, 1, 1);
    const pos = new Vector3();
    for (let i = 0; i < GATE.ribs; i++) {
      pos.set((i - (GATE.ribs - 1) / 2) * (GATE.span / (GATE.ribs - 1)), 0.12, 0);
      m.setMatrixAt(i, mat.compose(pos, q, one));
      m.setColorAt(i, work.tmp.setRGB(1, 1, 1));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [work]);

  useFrame((state, dt) => {
    const v = visual.verify;
    const t = state.clock.elapsedTime;
    const checking = v === "checking";
    // target colour and level: only `passed` is green
    const base = v === "passed" ? COL.verified : v === "failed" ? COL.fail : checking ? COL.signal : COL.hair;
    const lvl = v === "passed" || v === "failed" ? 1 : checking ? 0.7 : 0;
    work.target.copy(base);
    const k = 1 - Math.exp(-6 * dt);
    work.col.lerp(work.target, k);
    rig.gate = damp(rig.gate, lvl, 5, dt);
    rig.gateCol.copy(work.col);
    const u = (t / 2.4) % 1;
    const m = ribs.current;
    const settled = v === "passed" || v === "failed";
    if (m && m.instanceColor) {
      for (let i = 0; i < GATE.ribs; i++) {
        const x = i / (GATE.ribs - 1);
        const pass = checking ? Math.exp(-Math.pow((x - u) / 0.16, 2)) : 0;
        const gain = settled ? 0.95 : checking ? 0.4 + 1.35 * pass : 0.6 * rig.vis;
        work.tmp.copy(work.col).multiplyScalar(gain);
        m.setColorAt(i, work.tmp);
      }
      m.instanceColor.needsUpdate = true;
    }
    beam.color.copy(work.col).multiplyScalar(settled ? 1.5 : checking ? 1.2 : 0.8 * rig.vis);
    const s = sweepMesh.current;
    if (s) {
      s.position.x = (u - 0.5) * GATE.span;
      s.visible = checking;
    }
    sweep.uniforms.uColor.value.copy(COL.signal);
    sweep.uniforms.uIntensity.value = checking ? 1 : 0;
  });

  const { w, h, span } = GATE;
  return (
    <group position={POS} rotation-y={GATE.yaw}>
      {/* rails and spine */}
      <mesh geometry={roundedBox(span + 1.1, 0.14, 0.24, 0.04, 2)} material={assets.pbr.dark} position={[0, 0.07, -w / 2 + 0.02]} />
      <mesh geometry={roundedBox(span + 1.1, 0.14, 0.24, 0.04, 2)} material={assets.pbr.dark} position={[0, 0.07, w / 2 - 0.02]} />
      <mesh geometry={roundedBox(span + 0.7, 0.12, 0.16, 0.03, 2)} material={assets.pbr.body} position={[0, h + 0.22, 0]} />
      <mesh geometry={roundedBox(0.12, 0.34, 0.12, 0.02, 2)} material={assets.pbr.dark} position={[-span / 2 - 0.2, h + 0.05, 0]} />
      <mesh geometry={roundedBox(0.12, 0.34, 0.12, 0.02, 2)} material={assets.pbr.dark} position={[span / 2 + 0.2, h + 0.05, 0]} />
      {/* the state beam on the spine: the one place the verdict reads at a glance */}
      <mesh position={[0, h + 0.2, 0.09]} material={beam}>
        <boxGeometry args={[span * 0.6, 0.025, 0.02]} />
      </mesh>
      <instancedMesh ref={ribs} args={[ribGeo, ribMat, GATE.ribs]} frustumCulled={false} />
      <mesh ref={sweepMesh} geometry={sweepGeo} material={sweep.material} rotation-y={Math.PI / 2} position={[0, 0.12 + h / 2 - 0.02, 0]} visible={false} />
    </group>
  );
});
