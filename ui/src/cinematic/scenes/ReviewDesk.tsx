// The human review desk: a machined desk under a pendant lamp, and a stool for the person who is expected. The lamp is amber
// ONLY while a person is needed (visual.review === "waiting"); idle it is a dark fixture; decided it settles to neutral.
import { memo, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { CylinderGeometry, Color, LatheGeometry, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector2 } from "three";
import { LAYOUT, type CineVisual } from "../contract";
import { DESK } from "../assets/dims";
import { ringFrame, roundedBox } from "../assets/geometry";
import { COL } from "../materials/palette";
import { damp, type Rig } from "./rig";
import type { SetAssets } from "./useAssets";

const POS = [...LAYOUT.review] as [number, number, number];
const shadeProfile = [new Vector2(0.05, 0.0), new Vector2(0.09, -0.05), new Vector2(0.32, -0.16), new Vector2(0.52, -0.36), new Vector2(0.56, -0.42), new Vector2(0.5, -0.42), new Vector2(0.3, -0.3), new Vector2(0.06, -0.08)];
const shadeGeo = new LatheGeometry(shadeProfile, 40);
const rimGeo = new RingGeometry(0.47, 0.52, 48);
const bulbGeo = new SphereGeometry(0.13, 20, 12);
const cableGeo = new CylinderGeometry(0.012, 0.012, 14, 6);
const sealGeo = new RingGeometry(0.17, 0.2, 48);
const stoolSeat = new CylinderGeometry(0.34, 0.31, 0.09, 40);
const stoolPole = new CylinderGeometry(0.035, 0.035, 0.6, 12);
const stoolBase = new CylinderGeometry(0.26, 0.28, 0.04, 32);

export const ReviewDesk = memo(function ReviewDesk({ assets, rig, visual }: { assets: SetAssets; rig: Rig; visual: CineVisual }) {
  const lampMat = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  const inlay = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  const tint = useMemo(() => new Color(), []);
  useEffect(() => () => { lampMat.dispose(); inlay.dispose(); }, [lampMat, inlay]);

  useFrame((state, dt) => {
    const r = visual.review;
    const waiting = r === "waiting";
    rig.lamp = damp(rig.lamp, waiting ? 1 : 0, 5, dt);
    const pulse = waiting ? 0.9 + 0.1 * Math.sin(state.clock.elapsedTime * 2.6) : 1;
    // the fixture: dim steel when idle, amber only while waiting, a quiet steady neutral once decided (never green, never amber)
    if (r === "decided") tint.copy(COL.neutral).multiplyScalar(0.7);
    else tint.copy(COL.hair).multiplyScalar(0.9 * rig.vis);
    lampMat.color.copy(tint).lerp(COL.warn, rig.lamp).multiplyScalar(0.8 + 0.6 * rig.lamp * pulse);
    const seal = r === "decided" ? 0.75 : 0.6 * rig.vis;
    inlay.color.copy(r === "decided" ? COL.neutral : COL.hair).multiplyScalar(seal).lerp(COL.warn, rig.lamp).multiplyScalar(0.8 + 0.4 * rig.lamp * pulse);
  });

  const { w, d, topY, lampY } = DESK;
  return (
    <group position={POS}>
      {/* desk */}
      <mesh geometry={roundedBox(w, 0.12, d, 0.04, 3)} material={assets.pbr.body} position={[0, topY - 0.06, 0]} />
      <mesh geometry={roundedBox(0.16, topY - 0.12, d - 0.24, 0.03, 2)} material={assets.pbr.dark} position={[-w / 2 + 0.32, (topY - 0.12) / 2, 0]} />
      <mesh geometry={roundedBox(0.16, topY - 0.12, d - 0.24, 0.03, 2)} material={assets.pbr.dark} position={[w / 2 - 0.32, (topY - 0.12) / 2, 0]} />
      <mesh geometry={roundedBox(w - 0.9, 0.55, 0.05, 0.015, 2)} material={assets.pbr.matte} position={[0, topY - 0.5, -d / 2 + 0.2]} />
      {/* inlay: where the proposal is laid for a person to read, and the seal */}
      <mesh geometry={ringFrame(1.5, 0.78, 0.05, 0.014, 0.004, 0.001)} material={inlay} rotation-x={-Math.PI / 2} position={[-0.3, topY + 0.003, 0.02]} />
      <mesh geometry={sealGeo} material={inlay} rotation-x={-Math.PI / 2} position={[0.85, topY + 0.003, 0.02]} />
      {/* pendant lamp */}
      <mesh geometry={cableGeo} material={assets.pbr.matte} position={[0, lampY + 7 - 0.05, -0.15]} />
      <group position={[0, lampY, -0.15]}>
        <mesh geometry={shadeGeo} material={assets.pbr.dark} />
        <mesh geometry={rimGeo} material={lampMat} rotation-x={Math.PI / 2} position={[0, -0.425, 0]} />
        <mesh geometry={bulbGeo} material={lampMat} position={[0, -0.26, 0]} />
      </group>
      {/* a stool: someone is expected here */}
      <group position={[-0.5, 0, d / 2 + 0.95]}>
        <mesh geometry={stoolBase} material={assets.pbr.dark} position={[0, 0.02, 0]} />
        <mesh geometry={stoolPole} material={assets.pbr.steel} position={[0, 0.34, 0]} />
        <mesh geometry={stoolSeat} material={assets.pbr.dark} position={[0, 0.68, 0]} />
      </group>
    </group>
  );
});
