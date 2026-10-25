// Ember as a crisp pixel billboard: the same sprite frames the console uses (world/sprites.ts via runs()), painted once
// into a nearest-filtered atlas. The pose is `visual.ember` (the fold's corrected mascot state); this file never picks one.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace, ShaderMaterial } from "three";
import { H, STATES, W, runs, type MascotState } from "../../world/sprites";
import type { Choreo } from "./choreo";
import { createGlow } from "./fx";
import { COL } from "./util";

const ORDER: MascotState[] = ["idle", "investigating", "building", "verifying", "verified", "waiting", "error"];
const COLS = Math.max(...ORDER.map((k) => STATES[k].frames.length));
const PX = 0.052; // world units per sprite pixel
export const EMBER_POS: [number, number, number] = [-2.15, 0, 1.9];

function atlas() {
  const c = document.createElement("canvas");
  c.width = COLS * W; c.height = ORDER.length * H;
  const x = c.getContext("2d")!;
  ORDER.forEach((k, row) => STATES[k].frames.forEach((f, col) => { for (const r of runs(f)) { x.fillStyle = r.c; x.fillRect(col * W + r.x, row * H + r.y, r.w, 1); } }));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.magFilter = NearestFilter; t.minFilter = NearestFilter; t.generateMipmaps = false;
  t.repeat.set(1 / COLS, 1 / ORDER.length);
  return t;
}

/** the aura follows the fold's pose: only the semantic states get a semantic colour */
const AURA: Record<MascotState, Color> = { idle: COL.ember, building: COL.ember, investigating: COL.signal, verifying: COL.signal, verified: COL.verified, waiting: COL.warn, error: COL.fail };

export function EmberBillboard({ ch }: { ch: Choreo }) {
  const root = useRef<Group>(null), sprite = useRef<Mesh>(null);
  const tex = useMemo(() => atlas(), []);
  const geo = useMemo(() => new PlaneGeometry(W * PX, H * PX), []);
  const mat = useMemo(() => new MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.45, side: DoubleSide, toneMapped: false }), [tex]);
  const shadowMat = useMemo(() => new ShaderMaterial({
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying vec2 vP; void main(){ float a = pow(max(1.0 - length(vP), 0.0), 1.6) * 0.55; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }",
    transparent: true, depthWrite: false,
  }), []);
  const shadowGeo = useMemo(() => new PlaneGeometry(1.5, 0.7), []);
  const glow = useMemo(() => createGlow(2.4), []);
  const cam = useThree((s) => s.camera);
  const last = useRef(-1);
  useEffect(() => () => { tex.dispose(); geo.dispose(); mat.dispose(); shadowMat.dispose(); shadowGeo.dispose(); glow.mesh.geometry.dispose(); glow.mat.dispose(); }, [tex, geo, mat, shadowMat, shadowGeo, glow]);

  useFrame((s) => {
    const v = ch.v; if (!v || !root.current || !sprite.current) return;
    const state = v.ember, spec = STATES[state], row = ORDER.indexOf(state);
    const frame = ch.reduced ? 0 : Math.floor((s.clock.elapsedTime * 1000) / spec.ms) % spec.frames.length;
    const key = row * 16 + frame;
    if (key !== last.current) { last.current = key; tex.offset.set(frame / COLS, 1 - (row + 1) / ORDER.length); }
    // face the camera around the vertical axis only, so Ember always stands on the floor
    root.current.rotation.y = Math.atan2(cam.position.x - EMBER_POS[0], cam.position.z - EMBER_POS[2]);
    const bob = ch.reduced ? 0 : 0.03 * Math.sin(s.clock.elapsedTime * 2.1);
    sprite.current.position.y = (H * PX) / 2 + 0.02 + bob;
    const c = AURA[state];
    glow.set(EMBER_POS[0], EMBER_POS[1] + 0.75, EMBER_POS[2], 2.4, c.r * 1.2, c.g * 1.2, c.b * 1.2, 0.2 + 0.1 * Math.min(1, v.machine.power));
  });

  return (
    <>
      <group ref={root} position={EMBER_POS}>
        <mesh ref={sprite} geometry={geo} material={mat} renderOrder={7} />
      </group>
      <mesh geometry={shadowGeo} material={shadowMat} position={[EMBER_POS[0], 0.015, EMBER_POS[2]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} />
      <primitive object={glow.mesh} />
    </>
  );
}
void AdditiveBlending;
