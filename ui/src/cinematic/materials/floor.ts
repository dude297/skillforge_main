// The stage floor in one shader: a dark glossy lacquer with (high tier) a blurred planar reflection, coloured light pools
// thrown by the set's practical lights, a soft contact shadow under the machine, and a hairline grid that dissolves with
// distance (the console's 1 px lines, laid on the ground). Used by three's Reflector on high tier and as a plain mesh on low.
import { Color, Matrix4, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, Vector4, type IUniform } from "three";

export const POOLS = 7;

export interface FloorUniforms {
  [k: string]: IUniform;
  color: IUniform<Color>;
  tDiffuse: IUniform<unknown>;
  textureMatrix: IUniform<unknown>;
  uTime: IUniform<number>;
  uReflect: IUniform<number>;
  uKey: IUniform<number>;
  /** x, z, radius, intensity per pool */
  uPool: IUniform<Vector4[]>;
  uPoolCol: IUniform<Vector3[]>;
  /** machine footprint: cx, cz, halfW, halfD */
  uBox: IUniform<Vector4>;
  uRail: IUniform<number>;
}

const FLOOR_VS = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vRefl;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vRefl = textureMatrix * vec4(position, 1.0);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FLOOR_FS = /* glsl */ `
  uniform vec3 color;
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uReflect;
  uniform float uKey;
  uniform vec4 uPool[${POOLS}];
  uniform vec3 uPoolCol[${POOLS}];
  uniform vec4 uBox;
  uniform float uRail;
  varying vec4 vRefl;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float gridLine(vec2 p, float s) {
    vec2 q = p / s;
    vec2 w = fwidth(q);
    vec2 d = abs(fract(q - 0.5) - 0.5) / max(w, vec2(1e-4));
    return 1.0 - min(min(d.x, d.y), 1.0);
  }
  float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  // datum rail along z = 0 between x0 and x1, with a tick at every whole unit
  float rail(vec2 p, float x0, float x1) {
    float px = max(max(fwidth(p.x), fwidth(p.y)), 1e-4);
    float inside = step(x0 - px, p.x) * step(p.x, x1 + px);
    float line = 1.0 - smoothstep(px * 0.5, px * 1.5, abs(p.y));
    float tick = (1.0 - smoothstep(px * 0.5, px * 1.5, abs(p.x - floor(p.x + 0.5)))) * (1.0 - smoothstep(0.1, 0.1 + px * 2.0, abs(p.y)));
    return inside * max(line, tick * 0.6);
  }

  void main() {
    vec2 p = vWorld.xz;
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = clamp(V.y, 0.0, 1.0);
    float fres = 0.1 + 0.9 * pow(1.0 - ndv, 3.5);

    // lacquer micro-variation so the reflection is not a perfect mirror
    float n1 = vnoise(p * 2.3) - 0.5;
    float n2 = vnoise(p * 7.1 + 3.7) - 0.5;
    vec3 base = color * (0.85 + 0.3 * vnoise(p * 0.35));

    // contact shadow under the machine (key light from above-front-left, so the shadow falls back and right)
    float sd = sdBox(p - uBox.xy - vec2(0.18, -0.22), uBox.zw);
    float shadow = 1.0 - smoothstep(-0.2, 1.3, sd);
    float ao = exp(-max(sdBox(p - uBox.xy, uBox.zw), 0.0) * 2.4);

    // key pool: a cool spot on the ground around the machine, cut by the shadow
    float rk = length((p - uBox.xy) * vec2(0.8, 1.0));
    float key = pow(max(1.0 - rk / 9.0, 0.0), 2.2) * uKey;
    vec3 lit = vec3(0.55, 0.72, 0.95) * key * (1.0 - 0.9 * shadow) * 0.1;

    // practical pools
    for (int i = 0; i < ${POOLS}; i++) {
      vec4 pl = uPool[i];
      float d = length(p - pl.xy) / max(pl.z, 0.01);
      float f = pow(max(1.0 - d, 0.0), 2.0) * pl.w;
      lit += uPoolCol[i] * f;
    }

    vec3 col = base + lit * 0.3;

    #ifndef NO_REFLECT
      vec2 ruv = vRefl.xy / vRefl.w;
      ruv += vec2(n1, n2) * 0.0032;
      vec3 refl = vec3(0.0);
      float rad = 0.004 + 0.008 * (1.0 - ndv);
      float lod = 2.4 + 1.4 * (1.0 - ndv);
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 2.399963;
        float r = sqrt((float(i) + 0.5) / 6.0);
        refl += texture2D(tDiffuse, ruv + vec2(cos(a), sin(a)) * r * rad * vec2(0.6, 1.0), lod).rgb;
      }
      refl /= 6.0;
      col += refl * fres * uReflect * (1.0 - 0.6 * ao) * 0.9;
    #else
      // no reflection on the low tier: a soft sheen so the floor still reads as lacquer
      col += lit * fres * 0.18;
    #endif

    col *= 1.0 - 0.85 * ao;

    // hairline grid: minor every 1 unit, major every 5; dissolves with distance from the stage
    float dc = length(p - vec2(-0.5, -1.5));
    float fade = exp(-pow(dc / 15.0, 2.0));
    float g1 = gridLine(p, 1.0) * 0.07;
    float g5 = gridLine(p, 5.0) * 0.1;
    vec3 gcol = vec3(0.12, 0.2, 0.28);
    col += gcol * (g1 + g5) * fade * (0.5 + 0.5 * (1.0 - ndv)) * (0.1 + 0.9 * uKey);

    // datum rail: the straight route intake -> review -> verify, drawn as an etched measuring line
    col += vec3(0.2, 0.32, 0.44) * rail(p, -10.0, 9.0) * 0.5 * uRail;

    // the far floor dissolves into the void so there is no horizon line
    col = mix(col, vec3(0.0015, 0.0024, 0.0040), smoothstep(16.0, 40.0, dc));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** The shader definition in the shape three's Reflector wants; also usable for a plain ShaderMaterial. */
export function floorShader() {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      color: { value: new Color("#070b11") },
      tDiffuse: { value: null },
      textureMatrix: { value: new Matrix4() },
      uTime: { value: 0 },
      uReflect: { value: 1 },
      uKey: { value: 0 },
      uPool: { value: Array.from({ length: POOLS }, () => new Vector4(0, 0, 1, 0)) },
      uPoolCol: { value: Array.from({ length: POOLS }, () => new Vector3(0, 0, 0)) },
      uBox: { value: new Vector4(0, 0, 1.5, 1.5) },
      uRail: { value: 1 },
    },
  ]);
  return { name: "ForgeFloor", uniforms, vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS };
}

export function makePlainFloor(): { material: ShaderMaterial; uniforms: FloorUniforms } {
  const s = floorShader();
  const material = new ShaderMaterial({ ...s, fog: true, defines: { NO_REFLECT: "" } });
  return { material, uniforms: material.uniforms as FloorUniforms };
}
