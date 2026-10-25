// The intake portal: where incident evidence arrives. A machined frame with a funnel of hairline frames pointing at the
// machine, and two hairline lanes on the floor leading away from it. Cyan stirs only while evidence is flowing; pips on the
// base count the evidence items that have arrived (visual.intake.tickets).
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, MeshBasicMaterial, PlaneGeometry, Matrix4, type InstancedMesh } from "three";
import { LAYOUT, type CineVisual } from "../contract";
import { INTAKE } from "../assets/dims";
import { ringFrame, roundedBox } from "../assets/geometry";
import { COL } from "../materials/palette";
import { makeVeil } from "../materials/light";
import { damp, type Rig } from "./rig";
import type { SetAssets } from "./useAssets";

const POS = [...LAYOUT.intake] as [number, number, number];
const FUNNEL = 5;
const PIPS = 8;
const veilGeo = new PlaneGeometry(INTAKE.w - 0.5, INTAKE.h - 0.5);
const BOTTOM = 0.3;

export const Intake = memo(function Intake({ assets, rig, visual }: { assets: SetAssets; rig: Rig; visual: CineVisual }) {
  const hair = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  const lane = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  const pip = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  const veil = useMemo(() => makeVeil(), []);
  const pips = useRef<InstancedMesh>(null);
  useEffect(() => () => { hair.dispose(); lane.dispose(); pip.dispose(); veil.material.dispose(); }, [hair, lane, pip, veil]);

  useEffect(() => {
    const m = pips.current;
    if (!m) return;
    const mat = new Matrix4();
    for (let i = 0; i < PIPS; i++) { mat.makeTranslation((i - (PIPS - 1) / 2) * 0.27, 0.13, INTAKE.depth / 2 + 0.42); m.setMatrixAt(i, mat); }
    m.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((state, dt) => {
    const t = visual.intake;
    rig.intake = damp(rig.intake, t.flowing ? 1 : t.tickets > 0 ? 0.3 : 0, 4, dt);
    const k = rig.intake;
    hair.color.copy(COL.hair).multiplyScalar(0.8).lerp(COL.signal, k).multiplyScalar((0.7 + 1.0 * k) * (k + (1 - k) * rig.vis));
    lane.color.copy(COL.hair).multiplyScalar(0.5).lerp(COL.signal, k * 0.9).multiplyScalar((0.6 + 0.7 * k) * (k + (1 - k) * rig.vis));
    pip.color.copy(COL.signal).multiplyScalar(1.15);
    veil.uniforms.uColor.value.copy(COL.signal);
    veil.uniforms.uIntensity.value = 0.25 + 0.75 * k;
    veil.uniforms.uFlow.value = t.flowing ? 1 : 0.2;
    veil.uniforms.uTime.value = state.clock.elapsedTime;
    const m = pips.current;
    if (m) m.count = Math.min(PIPS, t.tickets);
  });

  const { w, h, depth } = INTAKE;
  const post = roundedBox(0.34, h, 0.7, 0.05, 3);
  return (
    <group position={POS} rotation-y={INTAKE.yaw}>
      {/* landing plinth */}
      <mesh geometry={roundedBox(w + 1.0, 0.1, depth + 1.2, 0.03, 3)} material={assets.pbr.dark} position={[0, 0.05, 0.15]} />
      {/* frame: two posts and a lintel, machined */}
      <mesh geometry={post} material={assets.pbr.body} position={[-w / 2 + 0.05, h / 2 + 0.1, 0]} />
      <mesh geometry={post} material={assets.pbr.body} position={[w / 2 - 0.05, h / 2 + 0.1, 0]} />
      <mesh geometry={roundedBox(w + 0.3, 0.34, 0.7, 0.05, 3)} material={assets.pbr.body} position={[0, h + 0.1, 0]} />
      <mesh geometry={roundedBox(w - 0.2, 0.05, 0.22, 0.015, 2)} material={assets.pbr.steel} position={[0, h - 0.12, 0.3]} />
      {/* hairline funnel: narrowing toward the machine */}
      {Array.from({ length: FUNNEL }, (_, i) => {
        const s = 1 - i * 0.07;
        const fh = (h - 0.5) * s;
        return <mesh key={i} geometry={ringFrame((w - 0.55) * s, fh, 0.06, 0.016, 0.01, 0.002)} material={hair} position={[0, BOTTOM + fh / 2, (i - (FUNNEL - 1) / 2) * 0.4]} />;
      })}
      <mesh geometry={veilGeo} material={veil.material} position={[0, BOTTOM + (h - 0.5) / 2, -0.05]} />
      {/* arrival lanes on the floor, pointing at the machine */}
      <mesh material={lane} position={[-0.55, 0.108, depth / 2 + 1.7]}>
        <boxGeometry args={[0.018, 0.006, 2.2]} />
      </mesh>
      <mesh material={lane} position={[0.55, 0.108, depth / 2 + 1.7]}>
        <boxGeometry args={[0.018, 0.006, 2.2]} />
      </mesh>
      {/* evidence pips */}
      <mesh geometry={roundedBox(w - 0.3, 0.06, 0.18, 0.015, 2)} material={assets.pbr.matte} position={[0, 0.12, depth / 2 + 0.42]} />
      <instancedMesh ref={pips} args={[undefined, undefined, PIPS]} material={pip} frustumCulled={false}>
        <boxGeometry args={[0.15, 0.05, 0.12]} />
      </instancedMesh>
    </group>
  );
});
