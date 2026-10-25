// The GB10: a compact graphite workstation, anodised and machined, with a porous front lit from inside by its core.
import { memo, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from "three";
import { LAYOUT, type CineVisual } from "../contract";
import { FACE_Y, MACHINE } from "../assets/dims";
import { PLATE } from "../assets/textures";
import { ringFrame, roundedBox } from "../assets/geometry";
import { makePlateMaterial } from "../materials/plate";
import { COL } from "../materials/palette";
import { damp, type Rig } from "./rig";
import type { SetAssets } from "./useAssets";

const POS = [...LAYOUT.machine] as [number, number, number];
const plateGeo = new PlaneGeometry(PLATE.w, PLATE.h);
const topGeo = new PlaneGeometry(2.9, 2.9);

interface Props { assets: SetAssets; rig: Rig; visual: CineVisual; tier: "high" | "low" }

export const Machine = memo(function Machine({ assets, rig, visual, tier }: Props) {
  const plate = useMemo(() => makePlateMaterial(assets.mask, assets.bump, assets.brushed, assets.env, tier), [assets, tier]);
  const seam = useMemo(() => new MeshBasicMaterial({ color: new Color(0, 0, 0), toneMapped: false }), []);
  const vent = useMemo(() => new MeshStandardMaterial({ color: "#020304", alphaMap: assets.vent, transparent: true, roughness: 0.7, metalness: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), [assets.vent]);
  useEffect(() => () => { plate.material.dispose(); seam.dispose(); vent.dispose(); }, [plate, seam, vent]);

  useFrame((state, dt) => {
    // `visual` is one object mutated in place every frame: always read it here, never at render time
    rig.power = damp(rig.power, visual.machine.power, 5, dt);
    rig.work = damp(rig.work, visual.machine.working ? 1 : 0, 3.5, dt);
    rig.time = state.clock.elapsedTime;
    const p = rig.power;
    const w = rig.work;
    rig.vis = 0.08 + 0.92 * Math.min(1, Math.max(0, (p - 0.05) / 0.55));
    const breathe = 1 + 0.07 * w * Math.sin(state.clock.elapsedTime * 3.2);
    const level = p * (0.85 + 1.25 * w) * breathe;
    rig.core.copy(COL.neutral).lerp(COL.signal, w).multiplyScalar(level);
    const u = plate.uniforms;
    u.uCore.value.copy(rig.core).multiplyScalar(0.34);
    u.uPower.value = p;
    u.uWork.value = w;
    u.uTime.value = state.clock.elapsedTime;
    seam.color.copy(COL.neutral).lerp(COL.signal, w).multiplyScalar(p * p * (0.55 + 1.2 * w));
  });

  const { w, h, d, foot, radius } = MACHINE;
  return (
    <group position={POS}>
      {/* recessed plinth: the machine floats on a black shadow gap */}
      <mesh geometry={roundedBox(w - 0.36, foot * 1.4, d - 0.36, 0.02, 2)} material={assets.pbr.matte} position={[0, foot * 0.7, 0]} />
      {/* chassis */}
      <mesh geometry={roundedBox(w, h, d, radius, 5)} material={assets.pbr.body} position={[0, foot + h / 2, 0]} />
      {/* top vents */}
      <mesh geometry={topGeo} material={vent} rotation-x={-Math.PI / 2} position={[0, foot + h + 0.0015, 0.1]} />
      {/* front: satin lip, then the porous plate */}
      <mesh geometry={ringFrame(PLATE.w + 0.1, PLATE.h + 0.1, 0.05, 0.05, 0.03, 0.006)} material={assets.pbr.steel} position={[0, FACE_Y, d / 2 + 0.006]} />
      <mesh geometry={plateGeo} material={plate.material} position={[0, FACE_Y, d / 2 + 0.003]} />
      {/* thin status seam in the chin below the plate */}
      <mesh position={[0, 0.195, d / 2 + 0.004]} material={seam}>
        <boxGeometry args={[2.9, 0.012, 0.008]} />
      </mesh>
    </group>
  );
});
