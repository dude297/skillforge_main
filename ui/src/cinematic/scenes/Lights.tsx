// The rig: a cool key from above, rim lights that separate the machine from the void, and practical lights that come from
// the work itself (core, review lamp, verification gate). Everything scales with machine power: at 0 the room is dark.
import { memo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PointLight, SpotLight, DirectionalLight, HemisphereLight } from "three";
import { LAYOUT } from "../contract";
import { DESK_LAMP } from "../assets/dims";
import { COL } from "../materials/palette";
import type { Rig } from "./rig";

export const Lights = memo(function Lights({ rig, tier }: { rig: Rig; tier: "high" | "low" }) {
  const key = useRef<SpotLight>(null);
  const rimA = useRef<SpotLight>(null);
  const rimB = useRef<SpotLight>(null);
  const keyD = useRef<DirectionalLight>(null);
  const rimD = useRef<DirectionalLight>(null);
  const core = useRef<PointLight>(null);
  const lamp = useRef<PointLight>(null);
  const gate = useRef<PointLight>(null);
  const hemi = useRef<HemisphereLight>(null);

  useEffect(() => {
    for (const l of [key.current, rimA.current, rimB.current]) { if (l) { l.target.position.set(LAYOUT.machine[0], 0.6, LAYOUT.machine[2]); l.target.updateMatrixWorld(); } }
    for (const l of [keyD.current, rimD.current]) { if (l) { l.target.position.set(LAYOUT.machine[0], 0.6, LAYOUT.machine[2]); l.target.updateMatrixWorld(); } }
  }, [tier]);

  useFrame(() => {
    const p = rig.power;
    if (key.current) key.current.intensity = 210 * p;
    if (rimA.current) rimA.current.intensity = 230 * p;
    if (rimB.current) rimB.current.intensity = 120 * p;
    if (keyD.current) keyD.current.intensity = 1.35 * p;
    if (rimD.current) rimD.current.intensity = 1.2 * p;
    if (hemi.current) hemi.current.intensity = 0.55 * p;
    if (core.current) {
      core.current.intensity = 26;
      core.current.color.copy(rig.core);
      core.current.intensity = 26 * Math.max(rig.core.r, rig.core.g, rig.core.b);
    }
    if (lamp.current) lamp.current.intensity = 70 * rig.lamp;
    if (gate.current) {
      gate.current.color.copy(rig.gateCol);
      gate.current.intensity = 48 * rig.gate;
    }
  });

  if (tier === "low") {
    return (
      <>
        <directionalLight ref={keyD} position={[-2, 9, 5]} color={COL.cool} />
        <directionalLight ref={rimD} position={[-3, 3, -7]} color="#8fc8ff" />
        <pointLight ref={core} position={[LAYOUT.machine[0], 0.85, LAYOUT.machine[2] + 2.7]} distance={9} decay={2} />
      </>
    );
  }
  return (
    <>
      <hemisphereLight ref={hemi} args={["#9bb8d8", "#05080d", 0]} />
      <spotLight ref={key} position={[-1.8, 9.5, 3.8]} angle={0.5} penumbra={1} decay={2} color={COL.cool} />
      <spotLight ref={rimA} position={[-4.5, 3.6, -5.8]} angle={0.5} penumbra={1} decay={2} color="#9fd0ff" />
      <spotLight ref={rimB} position={[5.5, 2.8, -4.6]} angle={0.5} penumbra={1} decay={2} color="#cfe0ff" />
      <pointLight ref={core} position={[LAYOUT.machine[0], 0.85, LAYOUT.machine[2] + 2.7]} distance={10} decay={2} />
      <pointLight ref={lamp} position={[DESK_LAMP[0], DESK_LAMP[1] - 0.5, DESK_LAMP[2] + 0.4]} color={COL.warn} distance={8} decay={2} />
      <pointLight ref={gate} position={[LAYOUT.verify[0], 2.3, LAYOUT.verify[2] + 1.6]} distance={8} decay={2} />
    </>
  );
});
