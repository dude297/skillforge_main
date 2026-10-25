// Additive "light in air" materials: volumetric-looking shafts (open cones, no raymarching), the intake veil and the
// verification sweep. All are single transparent draws with depthWrite off; uniforms are mutated in place per frame.
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, type IUniform } from "three";

export type ShaftUniforms = { uColor: IUniform<Color>; uIntensity: IUniform<number>; uTime: IUniform<number> };

export function makeShaft(color: Color): { material: ShaderMaterial; uniforms: ShaftUniforms } {
  const uniforms: ShaftUniforms = { uColor: { value: color.clone() }, uIntensity: { value: 0 }, uTime: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float edge = pow(abs(dot(normalize(vN), V)), 1.8);
        float h = vUv.y; // 1 at the source, 0 at the floor
        float along = smoothstep(0.0, 0.3, h) * (0.25 + 0.75 * h) * smoothstep(1.0, 0.8, h);
        float dust = 0.78 + 0.22 * sin(vW.x * 3.1 + uTime * 0.35) * sin(vW.z * 2.3 - uTime * 0.27 + vW.y * 1.7);
        float a = edge * along * dust * uIntensity;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  return { material, uniforms };
}

export type VeilUniforms = { uColor: IUniform<Color>; uIntensity: IUniform<number>; uFlow: IUniform<number>; uTime: IUniform<number> };

/** The intake veil: a faint curtain across the portal; with `uFlow` the evidence lines stream through it. */
export function makeVeil(): { material: ShaderMaterial; uniforms: VeilUniforms } {
  const uniforms: VeilUniforms = { uColor: { value: new Color() }, uIntensity: { value: 0 }, uFlow: { value: 0 }, uTime: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity; uniform float uFlow; uniform float uTime;
      varying vec2 vUv;
      void main() {
        float sides = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        float top = smoothstep(1.0, 0.75, vUv.y);
        float bottom = smoothstep(0.0, 0.2, vUv.y);
        float haze = 0.18 + 0.5 * pow(1.0 - vUv.y, 1.6);
        // a slow drift of faint vertical streaks: evidence in the air, not a screen
        float streak = smoothstep(0.55, 1.0, sin(vUv.x * 34.0 + sin(vUv.y * 5.0 + uTime * 0.4) * 1.2 + uTime * 0.7 * uFlow)) * 0.5;
        float a = (haze * 0.55 + streak * (0.25 + 0.75 * uFlow)) * sides * top * bottom * uIntensity * 0.45;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  return { material, uniforms };
}

export type SweepUniforms = { uColor: IUniform<Color>; uIntensity: IUniform<number> };

/** The verification sweep: a luminous plane with a bright hairline border, passed through the gate. */
export function makeSweep(): { material: ShaderMaterial; uniforms: SweepUniforms } {
  const uniforms: SweepUniforms = { uColor: { value: new Color() }, uIntensity: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        vec2 d = min(vUv, 1.0 - vUv);
        float edge = 1.0 - smoothstep(0.0, 0.02, min(d.x * 1.0, d.y * 0.7));
        float body = 0.07 + 0.1 * smoothstep(0.0, 0.6, vUv.y);
        float a = (edge * 0.9 + body) * uIntensity * smoothstep(1.0, 0.9, vUv.y + 0.0);
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  return { material, uniforms };
}
