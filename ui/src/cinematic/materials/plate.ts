// The GB10 front: a porous metal plate lit from inside. The plate is an opaque MeshStandardMaterial patched with a
// parallax core: for every pixel that falls in a hole we look "through" it at a glowing fin array sitting a few millimetres
// behind the surface, so the glow slides against the holes when the camera moves, and the plate edge keeps its bevel
// highlights from the (blurred) mask used as a bump map. No alpha test: mip-filtered holes stay stable at any distance.
import { Color, MeshStandardMaterial, Vector2, type Texture, type IUniform } from "three";
import { PLATE } from "../assets/textures";

export interface PlateUniforms {
  uCore: IUniform<Color>;
  uPower: IUniform<number>;
  uWork: IUniform<number>;
  uTime: IUniform<number>;
}

export function makePlateMaterial(mask: Texture, bump: Texture, rough: Texture, env: Texture, tier: "high" | "low"): { material: MeshStandardMaterial; uniforms: PlateUniforms } {
  const uniforms: PlateUniforms = {
    uCore: { value: new Color(0, 0, 0) },
    uPower: { value: 0 },
    uWork: { value: 0 },
    uTime: { value: 0 },
  };
  const material = new MeshStandardMaterial({
    color: new Color("#0f151b"), metalness: 0.9, roughness: 0.58, roughnessMap: rough, envMap: env, envMapIntensity: 0.5,
    bumpMap: tier === "high" ? bump : null, bumpScale: 1.6,
  });
  const size = new Vector2(PLATE.w, PLATE.h);
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = { value: mask };
    sh.uniforms.uPlate = { value: size };
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjCam;\nvarying vec2 vPUv;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vObjPos = position;
        vObjCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vPUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uMask; uniform vec2 uPlate; uniform vec3 uCore; uniform float uPower; uniform float uWork; uniform float uTime;
        varying vec3 vObjPos; varying vec3 vObjCam; varying vec2 vPUv;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        float forgeHole = 1.0 - smoothstep(0.28, 0.72, texture2D(uMask, vPUv).r);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.002), forgeHole);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 1.0, forgeHole);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor *= (1.0 - forgeHole);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          vec3 vd = normalize(vObjCam - vObjPos);
          vec2 shift = vd.xy / max(vd.z, 0.3) * 0.11 / uPlate;
          vec2 cuv = vPUv - shift;
          float fx = abs(fract(cuv.x * 23.0) - 0.5) * 2.0;
          float fin = 1.0 - smoothstep(0.08, 0.5, fx);
          float cdist = abs(cuv.x - 0.5) * 2.0;
          float ignite = smoothstep(cdist - 0.25, cdist + 0.05, uPower * 1.25);
          float band = exp(-pow((cuv.y - 0.5) * 3.0, 2.0));
          float flow = 0.72 + 0.28 * sin(cuv.x * 41.0 - uTime * 5.5 + cuv.y * 9.0);
          float act = mix(1.0, flow, uWork);
          float depthFade = 0.3 + 0.7 * band;
          totalEmissiveRadiance += uCore * (0.03 + 0.97 * fin) * depthFade * act * ignite * forgeHole;
        }`);
  };
  material.customProgramCacheKey = () => `forge-plate-${tier}`;
  return { material, uniforms };
}
