// Light in the air (high tier only): open cones with an additive, edge-softened gradient shader. Cheap, no raymarching.
import { memo, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, CylinderGeometry, Quaternion, Vector3 } from "three";
import { LAYOUT } from "../contract";
import { DESK_LAMP } from "../assets/dims";
import { COL } from "../materials/palette";
import { makeShaft } from "../materials/light";
import type { Rig } from "./rig";

interface ShaftDef { from: [number, number, number]; to: [number, number, number]; rTop: number; rBottom: number; color: Color; level: (r: Rig) => number }

const DEFS: ShaftDef[] = [
  { from: [-1.8, 9.5, 3.8], to: [0, 0, 0], rTop: 0.1, rBottom: 2.7, color: COL.cool, level: (r) => 0.17 * r.power },
  { from: [-4.5, 3.6, -5.8], to: [0, 0.2, -0.2], rTop: 0.05, rBottom: 1.2, color: new Color("#9fd0ff"), level: (r) => 0.1 * r.power },
  { from: [DESK_LAMP[0], DESK_LAMP[1] - 0.4, DESK_LAMP[2]], to: [LAYOUT.review[0], 0.92, LAYOUT.review[2]], rTop: 0.3, rBottom: 1.25, color: COL.warn, level: (r) => 0.7 * r.lamp },
];

function Shaft({ def, rig }: { def: ShaftDef; rig: Rig }) {
  const s = useMemo(() => makeShaft(def.color), [def.color]);
  const { geo, pos, quat } = useMemo(() => {
    const a = new Vector3(...def.from), b = new Vector3(...def.to);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    return {
      geo: new CylinderGeometry(def.rTop, def.rBottom, len, 36, 1, true),
      pos: a.clone().addScaledVector(dir, len / 2),
      quat: new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir),
    };
  }, [def]);
  useEffect(() => () => { s.material.dispose(); geo.dispose(); }, [s, geo]);
  useFrame((state) => {
    // eslint-disable-next-line react-hooks/immutability -- uniforms are mutated in place every frame by design
    s.uniforms.uIntensity.value = def.level(rig);
    s.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <mesh geometry={geo} material={s.material} position={pos} quaternion={quat} renderOrder={2} frustumCulled={false} />;
}

export const Shafts = memo(function Shafts({ rig }: { rig: Rig }) {
  return <>{DEFS.map((d, i) => <Shaft key={i} def={d} rig={rig} />)}</>;
});
