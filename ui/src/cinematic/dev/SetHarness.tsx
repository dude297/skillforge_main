// DEV ONLY (Worker A): isolates the set. /cinematic-dev.html?part=set&power=1&working=1&review=waiting&verify=checking
//   &drafted=1&stored=2&tickets=3&flowing=1&route=refused&tier=low|high&post=1&cam=hero|wide|intake|review|verify|library|top
//   &cx=&cy=&cz=&tx=&ty=&tz=&fov=   (manual camera overrides)
import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ForgeSet } from "../scenes/ForgeSet";
import { PostFX } from "../scenes/PostFX";
import { CINE_COLORS, type CineVisual, type Quality } from "../contract";

const CAMS: Record<string, [number, number, number, number, number, number, number]> = {
  hero: [3.4, 1.55, 6.2, 0, 0.62, 0, 32],
  front: [0, 1.0, 8.5, 0, 0.65, 0, 30],
  wide: [7, 5.2, 16, -0.5, 0.6, -1.5, 36],
  stage: [3, 6.5, 19, -0.5, 0.8, -2, 40],
  intake: [-6.5, 2.4, 6.5, -10, 1.7, 0, 38],
  review: [5.6, 2.1, 6.4, 5, 1.3, 0, 36],
  verify: [7.2, 2.4, 7, 9, 1.7, 0, 38],
  library: [4.8, 2.2, -0.6, 4.5, 1.5, -6, 40],
  top: [0.1, 16, 5, 0, 0, -1.5, 40],
};

function Cam({ spec }: { spec: number[] }) {
  const { camera } = useThree();
  useEffect(() => {
    /* eslint-disable react-hooks/immutability */
    const c = camera as import("three").PerspectiveCamera;
    c.position.set(spec[0], spec[1], spec[2]);
    c.fov = spec[6];
    c.near = 0.1;
    c.far = 200;
    c.lookAt(spec[3], spec[4], spec[5]);
    c.updateProjectionMatrix();
    /* eslint-enable react-hooks/immutability */
  }, [camera, spec]);
  return null;
}

function Probe() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const id = setInterval(() => {
      const r = gl.info.render;
      (window as unknown as { __cine: unknown }).__cine = { calls: r.calls, triangles: r.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length };
    }, 400);
    return () => clearInterval(id);
  }, [gl]);
  return null;
}

export function SetHarness({ q }: { q: URLSearchParams }) {
  const n = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  const tier = q.get("tier") === "low" ? "low" : "high";
  const visual: CineVisual = {
    provenance: "illustration", beat: "gate", progress: 0.5,
    machine: { power: n("power", 1), working: q.get("working") === "1" },
    ember: "idle",
    intake: { tickets: n("tickets", 0), flowing: q.get("flowing") === "1", converge: 0 },
    review: (q.get("review") as CineVisual["review"]) ?? "idle",
    verify: (q.get("verify") as CineVisual["verify"]) ?? "idle",
    library: { drafted: n("drafted", 0), stored: n("stored", 0) },
    artifact: null,
    route: q.get("route") === "refused" ? { kind: "refused", progress: 1 } : null,
    caption: null,
  };
  const quality: Quality = { tier, postfx: q.get("post") === "1" && tier === "high", dpr: [1, tier === "high" ? 1.5 : 1] };
  const cam = CAMS[q.get("cam") ?? "hero"] ?? CAMS.hero;
  const spec = [n("cx", cam[0]), n("cy", cam[1]), n("cz", cam[2]), n("tx", cam[3]), n("ty", cam[4]), n("tz", cam[5]), n("fov", cam[6])];
  return (
    <div style={{ height: "100dvh", background: CINE_COLORS.void }}>
      <Canvas dpr={quality.dpr} camera={{ position: [spec[0], spec[1], spec[2]], fov: spec[6] }} gl={{ antialias: true }}>
        <Cam spec={spec} />
        <ForgeSet visual={visual} quality={quality} />
        <PostFX quality={quality} />
        <Probe />
      </Canvas>
    </div>
  );
}
