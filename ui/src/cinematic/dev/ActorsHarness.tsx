// DEV ONLY: renders the actors alone over a plain dark floor with stand-in boxes for the set.
//   ?part=actors&beat=storm|gate|forge|shortpath&t=0..1      a still: the visual is built from the real script + fold
//   &ev=<index>&p=<0..1>                                     override: event index inside the beat, progress inside it
//   &source=recorded                                         the recorded OnCall fixture instead of the illustration
//   &q=low|high  &bloom=1  &reduced=1  &play=1 (real-time run through the beat)  &cam=x,y,z,tx,ty,tz
import { useEffect, useMemo, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Vector3 } from "three";
import { BEAT_ORDER, LAYOUT, type Beat, type CineVisual, type Quality, type VizEvent } from "../contract";
import { ILLUSTRATION_BEATS } from "../adapters/illustration";
import { oncallBeats, oncallCtx } from "../adapters/oncall";
import { visualAt } from "../adapters/visual";
import { Actors } from "../actors/Actors";
import type { OnCallRun } from "../../data/oncall";
import recorded from "../../../public/demo/oncall-run.recorded.json";

const q = new URLSearchParams(location.search);
const beat = (q.get("beat") ?? "storm") as Beat;
const CAMS: Record<string, number[]> = {
  storm: [-1.5, 4.4, 15.5, -4, 1.4, 0], gate: [4.5, 3.8, 12, 4.5, 1.6, 0], forge: [2.2, 3.6, 9, 1.8, 1.9, 0],
  shortpath: [3, 7, 15, 2, 0.8, -3], all: [0, 8, 24, 0, 1, -2],
};
const cam = (q.get("cam")?.split(",").map(Number) ?? CAMS[beat] ?? CAMS.all);

function script(): { prev: VizEvent[]; cur: VizEvent[]; ctx: { provenance: "illustration" | "recorded" | "live"; hash?: { value: string | null; kind: "illustration" | "recorded_reference" | "live" }; modelRan?: boolean } } {
  const rec = q.get("source") === "recorded";
  const beats = rec ? oncallBeats(recorded as unknown as OnCallRun) : ILLUSTRATION_BEATS;
  const i = BEAT_ORDER.indexOf(beat);
  const prev = BEAT_ORDER.slice(0, i).flatMap((b) => beats[b]);
  return { prev, cur: beats[beat], ctx: rec ? oncallCtx(recorded as unknown as OnCallRun) : { provenance: "illustration" } };
}

function useVisual(): CineVisual {
  const S = useMemo(() => script(), []);
  const t = Number(q.get("t") ?? 0.5);
  const n = S.cur.length;
  const still = useMemo(() => {
    const k = q.has("ev") ? Number(q.get("ev")) : Math.min(Math.max(n - 1, 0), Math.floor(t * n));
    const p = q.has("p") ? Number(q.get("p")) : n ? Math.min(1, t * n - k) : t;
    return visualAt([...S.prev, ...S.cur.slice(0, k + 1)], { ...S.ctx, beat, progress: p });
  }, [S, n, t]);
  const [vis, setVis] = useState(still);
  useEffect(() => {
    if (!q.has("play")) return;
    const ms = Number(q.get("ms") ?? 1500), t0 = performance.now(), id = window.setInterval(() => {
      const el = (performance.now() - t0) / ms, k = Math.min(n - 1, Math.floor(el)), p = Math.min(1, el - k);
      setVis(visualAt([...S.prev, ...S.cur.slice(0, k + 1)], { ...S.ctx, beat, progress: p }));
    }, 50);
    return () => window.clearInterval(id);
  }, [S, n]);
  return q.has("play") ? vis : still;
}

function Rig() {
  const { camera } = useThree();
  useEffect(() => { camera.position.set(cam[0], cam[1], cam[2]); camera.lookAt(new Vector3(cam[3], cam[4], cam[5])); camera.updateProjectionMatrix(); }, [camera]);
  useFrame(() => { /* fixed camera */ });
  return null;
}

function Stage() {
  const L = LAYOUT;
  return (
    <group>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 9, 7]} intensity={0.9} />
      <fog attach="fog" args={["#05080D", 22, 60]} />
      <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[80, 50]} /><meshStandardMaterial color="#16202b" roughness={0.6} metalness={0.2} /></mesh>
      <mesh position={[L.machine[0], 0.6, L.machine[2]]}><boxGeometry args={[1.5, 1.2, 1.5]} /><meshStandardMaterial color="#46566a" metalness={0.8} roughness={0.35} /></mesh>
      <mesh position={[L.review[0], 0.35, L.review[2]]}><boxGeometry args={[2.2, 0.7, 1.2]} /><meshStandardMaterial color="#33414f" metalness={0.7} roughness={0.4} /></mesh>
      <mesh position={[L.verify[0] - 1, 1.3, 0]}><boxGeometry args={[0.18, 2.6, 0.5]} /><meshStandardMaterial color="#33414f" metalness={0.7} roughness={0.4} /></mesh>
      <mesh position={[L.verify[0] + 1, 1.3, 0]}><boxGeometry args={[0.18, 2.6, 0.5]} /><meshStandardMaterial color="#33414f" metalness={0.7} roughness={0.4} /></mesh>
      <mesh position={[L.library[0], 0.8, L.library[2] - 0.6]}><boxGeometry args={[3.4, 1.6, 0.5]} /><meshStandardMaterial color="#33414f" metalness={0.7} roughness={0.4} /></mesh>
      <mesh position={[L.intake[0] - 0.4, 1.4, 0]}><boxGeometry args={[0.12, 2.8, 2.8]} /><meshStandardMaterial color="#33414f" metalness={0.7} roughness={0.4} /></mesh>
    </group>
  );
}

export function ActorsHarness() {
  const visual = useVisual();
  const quality: Quality = { tier: q.get("q") === "low" ? "low" : "high", postfx: q.has("bloom"), dpr: [1, 1.5] };
  return (
    <div style={{ height: "100dvh", background: "#05080D" }}>
      <Canvas dpr={quality.dpr} camera={{ fov: Number(q.get("fov") ?? 36), near: 0.1, far: 120 }} gl={{ antialias: true }}>
        <color attach="background" args={["#05080D"]} />
        <Rig />
        <Stage />
        <Actors visual={visual} quality={quality} reducedMotion={q.has("reduced")} />
        {quality.postfx ? <EffectComposer><Bloom intensity={Number(q.get("bloom")) || 0.9} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur /><Vignette darkness={0.55} offset={0.3} /></EffectComposer> : <></>}
      </Canvas>
      <pre style={{ position: "fixed", left: 12, bottom: 8, margin: 0, color: "#9CADBA", font: "11px monospace", pointerEvents: "none" }}>
        {`${beat} ev=${q.get("ev") ?? "auto"} p=${visual.progress.toFixed(2)} | ${visual.caption?.title ?? ""} | review=${visual.review} verify=${visual.verify} art=${visual.artifact?.phase ?? "-"} route=${visual.route?.kind ?? "-"} conv=${visual.intake.converge}`}
      </pre>
    </div>
  );
}
