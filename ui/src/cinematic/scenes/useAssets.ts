// Builds (once per tier) and disposes the GPU assets the set shares: studio environment, PBR materials, the front mask.
// Built in an effect, not during render, so a StrictMode double-mount never reuses a disposed render target.
import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import type { Texture } from "three";
import { makeStudioEnv } from "../assets/env";
import { brushedTexture, perforationMask, ventTexture } from "../assets/textures";
import { makePbr, type PbrSet } from "../materials/pbr";

export interface SetAssets {
  env: Texture;
  pbr: PbrSet;
  mask: Texture;
  bump: Texture;
  brushed: Texture;
  vent: Texture;
}

export function useAssets(tier: "high" | "low"): SetAssets | null {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [assets, setAssets] = useState<SetAssets | null>(null);
  useEffect(() => {
    const rt = makeStudioEnv(gl, tier);
    const pbr = makePbr(rt.texture, tier);
    const m = perforationMask(tier);
    const brushed = brushedTexture(tier === "high" ? 512 : 256);
    const vent = ventTexture();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- GPU resources need the renderer and must be rebuilt on a StrictMode remount
    setAssets({ env: rt.texture, pbr, mask: m.mask, bump: m.bump, brushed, vent });
    invalidate();
    return () => {
      setAssets(null);
      rt.dispose();
      pbr.dispose();
      m.mask.dispose();
      m.bump.dispose();
      brushed.dispose();
      vent.dispose();
    };
  }, [gl, tier, invalidate]);
  return assets;
}
