/* eslint-disable react-hooks/immutability -- imperative three.js objects live outside React state and are mutated in the frame loop */
// The packet: a compact glowing item that carries a similar incident along the SHORT path (skipping the machine) to the
// library, or a mismatching one along the same road until it is REFUSED. A refusal turns rose, stops and fractures:
// shards fall and go dark. It never flashes, never rises, never celebrates.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BoxGeometry, Color, DoubleSide, EdgesGeometry, Group, InstancedMesh, LineBasicMaterial, LineSegments, MeshBasicMaterial, Object3D } from "three";
import type { Choreo } from "./choreo";
import { createGlow } from "./fx";
import { shardGlyph } from "./glyphs";
import { COL, TAU, clamp01, rng, smooth } from "./util";
import { ROUTES } from "./routes";

const D = new Object3D();
const NS = 18;

export function Packet({ ch }: { ch: Choreo }) {
  const root = useRef<Group>(null), body = useRef<Group>(null);
  const boxGeo = useMemo(() => new BoxGeometry(0.3, 0.3, 0.3), []);
  const coreMat = useMemo(() => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#fff" }), []);
  const edgeGeo = useMemo(() => new EdgesGeometry(new BoxGeometry(0.5, 0.5, 0.5)), []);
  const edgeMat = useMemo(() => new LineBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: "#fff" }), []);
  const edges = useMemo(() => new LineSegments(edgeGeo, edgeMat), [edgeGeo, edgeMat]);
  const shardGeo = useMemo(() => shardGlyph(), []);
  const shardMat = useMemo(() => new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }), []);
  const shards = useMemo(() => { const m = new InstancedMesh(shardGeo, shardMat, NS); m.frustumCulled = false; for (let i = 0; i < NS; i++) m.setColorAt(i, new Color(0, 0, 0)); return m; }, [shardGeo, shardMat]);
  const R = useMemo(() => {
    const r = rng(909), o = { vx: new Float32Array(NS), vy: new Float32Array(NS), vz: new Float32Array(NS), sp: new Float32Array(NS), sz: new Float32Array(NS) };
    for (let i = 0; i < NS; i++) { const a = r() * TAU; const s = 0.4 + r() * 0.9; o.vx[i] = Math.cos(a) * s; o.vz[i] = Math.sin(a) * s * 0.7; o.vy[i] = 0.2 + r() * 0.9; o.sp[i] = (r() - 0.5) * 6; o.sz[i] = 0.07 + r() * 0.12; }
    return o;
  }, []);
  const glow = useMemo(() => createGlow(2.2), []);
  const col = useMemo(() => new Color(), []);
  const tmp = useMemo(() => new Color(), []);
  useEffect(() => () => { boxGeo.dispose(); coreMat.dispose(); edgeGeo.dispose(); edgeMat.dispose(); shardGeo.dispose(); shardMat.dispose(); shards.dispose(); glow.mesh.geometry.dispose(); glow.mat.dispose(); }, [boxGeo, coreMat, edgeGeo, edgeMat, shardGeo, shardMat, shards, glow]);

  useFrame((s) => {
    const a = ch.pkAlpha;
    if (!root.current) return;
    const refused = ch.routeId === "refused";
    if (a < 0.01 && !(refused && ch.shatter.v > 0.01)) { root.current.visible = false; glow.mesh.visible = false; return; }
    root.current.visible = true;
    const t = ch.reduced ? 0 : s.clock.elapsedTime, sh = ch.shatter.v;
    const stop = ROUTES.refused.a.stop;
    const rose = refused ? smooth(stop * 0.72, stop, ch.pkU.v) : 0;
    col.copy(COL.signal).lerp(COL.fail, rose);
    root.current.position.copy(ch.pkPos);
    // the packet itself: dims and breaks apart on a refusal
    const alive = 1 - sh;
    const pulse = ch.pkHeld ? 1 + 0.12 * Math.sin(t * 5) : 1;
    if (body.current) { body.current.visible = alive > 0.02 || refused; body.current.rotation.set(t * 0.9, t * 1.3, 0); body.current.scale.setScalar(pulse * (refused ? 1 - 0.35 * sh : 1)); }
    coreMat.color.copy(tmp.copy(col).lerp(COL.white, 0.6 * (1 - rose))); coreMat.opacity = a * (refused ? 0.15 + 0.85 * alive : 1);
    edgeMat.color.copy(col); edgeMat.opacity = a * (refused ? 0.35 + 0.65 * alive : 0.95);
    // shards: eject once, fall under gravity, lie dark on the floor
    shards.visible = refused && sh > 0.005;
    if (shards.visible) {
      const tau = sh, floor = 0.03 - ch.pkPos.y;
      for (let i = 0; i < NS; i++) {
        const y = Math.max(floor, R.vy[i] * tau * 1.6 - 2.4 * tau * tau);
        D.position.set(R.vx[i] * tau * 1.5, y, R.vz[i] * tau * 1.5);
        D.rotation.set(R.sp[i] * tau, R.sp[i] * tau * 0.7, 0.4 * i);
        D.scale.setScalar(R.sz[i] * (1 - 0.3 * tau)); D.updateMatrix(); shards.setMatrixAt(i, D.matrix);
        const b = (0.9 - 0.7 * smooth(0.2, 1, tau));
        shards.setColorAt(i, tmp.copy(COL.fail).multiplyScalar(b * 0.9));
      }
      shards.instanceMatrix.needsUpdate = true; if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
    }
    const gp = ch.pkPos;
    glow.set(gp.x, gp.y, gp.z, 1.6 * (refused ? 0.6 + 0.4 * alive : 1), col.r * 1.3, col.g * 1.3, col.b * 1.3, 0.8 * a * (refused ? 0.2 + 0.8 * alive : 1) * clamp01(1));
  });

  return (
    <>
      <group ref={root} visible={false}>
        <group ref={body}>
          <mesh geometry={boxGeo} material={coreMat} renderOrder={5} />
          <primitive object={edges} />
        </group>
        <primitive object={shards} />
      </group>
      <primitive object={glow.mesh} />
    </>
  );
}
