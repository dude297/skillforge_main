// Where an incompatible incident is stopped before the library: a low barrier. Rose only while a refusal is happening.
import { memo, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, MeshBasicMaterial } from "three";
import { LAYOUT, type CineVisual } from "../contract";
import { roundedBox } from "../assets/geometry";
import { COL } from "../materials/palette";
import { damp, type Rig } from "./rig";
import type { SetAssets } from "./useAssets";

const POS = [...LAYOUT.refusalStop] as [number, number, number];

export const RefusalStop = memo(function RefusalStop({ assets, rig, visual }: { assets: SetAssets; rig: Rig; visual: CineVisual }) {
  const bar = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  useEffect(() => () => bar.dispose(), [bar]);
  useFrame((_, dt) => {
    rig.refuse = damp(rig.refuse, visual.route?.kind === "refused" ? 1 : 0, 7, dt);
    bar.color.copy(COL.hair).multiplyScalar(0.4 * rig.vis).lerp(COL.fail, rig.refuse).multiplyScalar(0.8 + 0.5 * rig.refuse);
  });
  return (
    <group position={POS}>
      <mesh geometry={roundedBox(0.22, 0.85, 0.22, 0.05, 3)} material={assets.pbr.body} position={[0, 0.425, -0.95]} />
      <mesh geometry={roundedBox(0.22, 0.85, 0.22, 0.05, 3)} material={assets.pbr.body} position={[0, 0.425, 0.95]} />
      <mesh geometry={roundedBox(0.14, 0.14, 2.1, 0.03, 2)} material={assets.pbr.dark} position={[0, 0.06, 0]} />
      <mesh position={[0, 0.66, 0]} material={bar}>
        <boxGeometry args={[0.035, 0.035, 1.7]} />
      </mesh>
    </group>
  );
});
