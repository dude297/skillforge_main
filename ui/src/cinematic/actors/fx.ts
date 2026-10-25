// Small GPU building blocks shared by the actors: camera-facing segment ribbons (trails, probes) and soft glows.
// Everything is created once; per-frame code only writes into the existing typed arrays.
import {
  AdditiveBlending, BufferAttribute, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry,
  ShaderMaterial, Vector2,
} from "three";

/** N independent screen-space ribbons from B (tail) to A (head): fade from 0 at the tail to 1 at the head. */
export function createSegments(count: number, widthPx: number) {
  const geo = new InstancedBufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aA = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
  const aB = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
  const aC = new InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(DynamicDrawUsage);
  geo.setAttribute("aA", aA); geo.setAttribute("aB", aB); geo.setAttribute("aC", aC);
  geo.instanceCount = count;
  const mat = new ShaderMaterial({
    uniforms: { uRes: { value: new Vector2(1440, 900) }, uWidth: { value: widthPx } },
    vertexShader: /* glsl */ `
      attribute vec3 aA; attribute vec3 aB; attribute vec4 aC;
      uniform vec2 uRes; uniform float uWidth;
      varying vec4 vC; varying vec2 vP;
      void main() {
        vec4 ca = projectionMatrix * viewMatrix * vec4(aA, 1.0);
        vec4 cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
        vec4 c = mix(cb, ca, position.x);
        float asp = uRes.x / uRes.y;
        vec2 d = (ca.xy / ca.w - cb.xy / cb.w) * vec2(asp, 1.0);
        float l = length(d);
        d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
        vec2 off = vec2(-d.y, d.x) * position.y * uWidth / uRes.y;
        off.x /= asp;
        gl_Position = vec4(c.xy + off * c.w, c.z, c.w);
        vC = aC; vP = position.xy;
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vC; varying vec2 vP;
      void main() {
        float a = pow(clamp(vP.x, 0.0, 1.0), 2.0) * (1.0 - vP.y * vP.y) * vC.a;
        gl_FragColor = vec4(vC.rgb, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const set = (i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number, a: number) => {
    aA.setXYZ(i, ax, ay, az); aB.setXYZ(i, bx, by, bz); aC.setXYZW(i, r, g, b, a);
  };
  const commit = () => { aA.needsUpdate = true; aB.needsUpdate = true; aC.needsUpdate = true; };
  return { mesh, set, commit, aA, aB, aC, res: mat.uniforms.uRes.value as Vector2 };
}

/** A camera-facing soft glow (radial falloff). One material per glow so each keeps its own colour and size. */
export function createGlow(sharp = 2.2) {
  const mat = new ShaderMaterial({
    uniforms: { uColor: { value: [1, 1, 1] }, uSize: { value: 1 }, uI: { value: 1 } , uSharp: { value: sharp } },
    vertexShader: /* glsl */ `
      uniform float uSize; varying vec2 vUv;
      void main() {
        vUv = position.xy * 2.0;
        vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uI; uniform float uSharp; varying vec2 vUv;
      void main() {
        float d = length(vUv);
        float a = pow(max(1.0 - d, 0.0), uSharp);
        gl_FragColor = vec4(uColor * uI, a * min(uI, 1.0));
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, toneMapped: false,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  const set = (x: number, y: number, z: number, size: number, r: number, g: number, b: number, intensity: number) => {
    mesh.position.set(x, y, z);
    mat.uniforms.uSize.value = size;
    const c = mat.uniforms.uColor.value as number[]; c[0] = r; c[1] = g; c[2] = b;
    mat.uniforms.uI.value = intensity;
    mesh.visible = intensity > 0.003 && size > 0;
  };
  return { mesh, set, mat };
}

/** helper: write a BufferAttribute without reallocating */
export const touch = (a: BufferAttribute) => { a.needsUpdate = true; };
