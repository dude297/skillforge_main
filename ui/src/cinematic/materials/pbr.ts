// Shared physically-based materials of the set. One instance per kind (draw-call and state-change friendly).
import { Color, MeshStandardMaterial, RepeatWrapping, type Texture } from "three";
import { brushedTexture } from "../assets/textures";

export interface PbrSet {
  /** anodised graphite chassis */
  body: MeshStandardMaterial;
  /** darker, rougher graphite: plinths, legs, posts */
  dark: MeshStandardMaterial;
  /** satin steel for lips and bevel catchers */
  steel: MeshStandardMaterial;
  /** near-black matte backing: recesses, rack back panels */
  matte: MeshStandardMaterial;
  dispose(): void;
}

export function makePbr(env: Texture, tier: "high" | "low"): PbrSet {
  const brushed = brushedTexture(tier === "high" ? 512 : 256);
  const brushedWide = brushed.clone();
  brushedWide.repeat.set(3, 1);
  brushedWide.wrapS = brushedWide.wrapT = RepeatWrapping;
  brushedWide.needsUpdate = true;
  const body = new MeshStandardMaterial({
    color: new Color("#2b343f"), metalness: 0.78, roughness: 0.48, roughnessMap: brushedWide, envMap: env, envMapIntensity: 1.25,
  });
  if (tier === "high") { body.bumpMap = brushedWide; body.bumpScale = 0.35; }
  const dark = new MeshStandardMaterial({ color: new Color("#1a222a"), metalness: 0.7, roughness: 0.55, roughnessMap: brushed, envMap: env, envMapIntensity: 0.9 });
  const steel = new MeshStandardMaterial({ color: new Color("#6d7b89"), metalness: 1, roughness: 0.3, roughnessMap: brushed, envMap: env, envMapIntensity: 1.1 });
  const matte = new MeshStandardMaterial({ color: new Color("#05080c"), metalness: 0.2, roughness: 0.9, envMap: env, envMapIntensity: 0.25 });
  return {
    body, dark, steel, matte,
    dispose() { for (const m of [body, dark, steel, matte]) m.dispose(); brushed.dispose(); brushedWide.dispose(); },
  };
}
