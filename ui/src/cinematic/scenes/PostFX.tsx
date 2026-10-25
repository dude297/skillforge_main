// Restrained post-processing: bloom on the set's emissive light only (threshold sits above the lacquer and metal highlights),
// a whisper of chromatic aberration toward the frame edge, a vignette, and the same ACES tone curve the renderer uses so the
// image does not jump when postfx is toggled. Renders nothing when quality.postfx is false.
import { Bloom, ChromaticAberration, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Vector2 } from "three";
import type { Quality } from "../contract";

const CA_OFFSET = new Vector2(0.00045, 0.00045);

export function PostFX({ quality }: { quality: Quality }) {
  if (!quality.postfx) return null;
  return (
    <EffectComposer multisampling={quality.tier === "high" ? 4 : 0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={0.36} luminanceThreshold={1.05} luminanceSmoothing={0.25} radius={0.72} />
      <ChromaticAberration offset={CA_OFFSET} radialModulation modulationOffset={0.35} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.62} />
    </EffectComposer>
  );
}
