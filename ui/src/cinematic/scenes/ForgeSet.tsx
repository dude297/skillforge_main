// The Forge's stage: environment, the GB10 and the places of the story. `visual` is ONE object the timeline mutates in place
// every frame, so every set piece reads it inside useFrame (never at render time) and eases toward it; React re-renders
// here only when the told events or the beat change.
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { CINE_COLORS, type SetProps } from "../contract";
import { Floor } from "./Floor";
import { Lights } from "./Lights";
import { Intake } from "./Intake";
import { Library } from "./Library";
import { Machine } from "./Machine";
import { RefusalStop } from "./RefusalStop";
import { ReviewDesk } from "./ReviewDesk";
import { Shafts } from "./Shafts";
import { VerifyGate } from "./VerifyGate";
import { makeRig, type Rig } from "./rig";
import { useAssets, type SetAssets } from "./useAssets";

const ENV_BASE = { body: 1.25, dark: 0.9, steel: 1.1, matte: 0.25 } as const;

/** Reflections are light too: with the machine unpowered the room must be dark, so env intensity follows power. */
function EnvGate({ assets, rig }: { assets: SetAssets; rig: Rig }) {
  useFrame(() => {
    const k = 0.03 + 0.97 * rig.power;
    // imperative GPU-material update, per frame (not React state)
    /* eslint-disable react-hooks/immutability */
    const m = assets.pbr;
    m.body.envMapIntensity = ENV_BASE.body * k;
    m.dark.envMapIntensity = ENV_BASE.dark * k;
    m.steel.envMapIntensity = ENV_BASE.steel * k;
    m.matte.envMapIntensity = ENV_BASE.matte * k;
    /* eslint-enable react-hooks/immutability */
  });
  return null;
}

export function ForgeSet({ visual, quality }: SetProps) {
  const rig = useMemo(() => makeRig(), []);
  const assets = useAssets(quality.tier);
  const tier = quality.tier;
  return (
    <group>
      <color attach="background" args={[CINE_COLORS.void]} />
      <fogExp2 attach="fog" args={["#05080d", 0.03]} />
      <Lights rig={rig} tier={tier} />
      <Floor rig={rig} tier={tier} />
      {assets && (
        <>
          <EnvGate assets={assets} rig={rig} />
          <Machine assets={assets} rig={rig} visual={visual} tier={tier} />
          <Intake assets={assets} rig={rig} visual={visual} />
          <ReviewDesk assets={assets} rig={rig} visual={visual} />
          <VerifyGate assets={assets} rig={rig} visual={visual} />
          <Library assets={assets} rig={rig} visual={visual} />
          <RefusalStop assets={assets} rig={rig} visual={visual} />
          {tier === "high" && <Shafts rig={rig} />}
        </>
      )}
    </group>
  );
}
