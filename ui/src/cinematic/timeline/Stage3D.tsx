// The WebGL stage. Lazy-loaded by Cinematic.tsx so three.js never reaches a route that does not play the film.
// Composition: CameraRig (timeline/camera.ts) + ForgeSet (Worker A) + Actors (Worker C) + PostFX (Worker A).
//
// How the film reaches the scene without React re-rendering per frame:
//   * the clock is a plain number; this stage renders on demand (frameloop="demand") and every clock tick calls invalidate();
//     when paused, nothing renders at all (a seek renders exactly one frame);
//   * `visual` is a single object per told-events set. React re-renders the set and the actors only when that set (or the
//     beat) changes, a few times per film. Between those moments the SAME object is updated in place every frame
//     (progress, machine.power, route.progress ...), so components must READ `visual.*` inside useFrame, not capture
//     values at render time.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CINE_COLORS, type CineVisual, type Quality } from "../contract";
import { ForgeSet } from "../scenes/ForgeSet";
import { PostFX } from "../scenes/PostFX";
import { Actors } from "../actors/Actors";
import { CameraRig } from "./CameraRig";
import type { Clock } from "./clock";
import { frameAt, visualFor } from "./frame";

export interface Stage3DProps {
  clock: Clock;
  quality: Quality;
  reducedMotion: boolean;
  /** the first frames are drawn and shaders are compiled: the film may start */
  onReady: () => void;
  /** the context was lost or could not be created: show the poster instead */
  onFail: (why: string) => void;
  /** dev only: draw placeholder stations at LAYOUT so the camera can be judged before the real set exists */
  devProxy?: boolean;
}

// dead-code-eliminated from production builds
const DevProxy = import.meta.env.DEV ? lazy(() => import("../dev/ProxySet")) : null;

/** Updates the shared `visual` in place each frame and swaps it (a new object, a React render) only when the told events change. */
function Bridge({ clock, quality, reducedMotion, onReady, devProxy }: Pick<Stage3DProps, "clock" | "quality" | "reducedMotion" | "onReady" | "devProxy">) {
  const { invalidate, gl, scene, camera } = useThree();
  const [visual, setVisual] = useState<CineVisual>(() => visualFor(frameAt(clock.t)));
  const live = useRef<CineVisual>(visual);
  const key = useRef(frameAt(clock.t).key);

  // every tick of the clock (and every seek) renders exactly one frame
  useEffect(() => clock.onFrame(() => invalidate()), [clock, invalidate]);

  // prewarm every material, then let the film start
  useEffect(() => {
    let alive = true;
    try { gl.compile(scene, camera); } catch { /* a shader that fails here would also fail on first draw; the ErrorBoundary owns that */ }
    invalidate();
    const id = requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) onReady(); }));
    return () => { alive = false; cancelAnimationFrame(id); };
  }, [gl, scene, camera, invalidate, onReady]);

  useFrame(() => {
    const f = frameAt(clock.t);
    const next = visualFor(f);
    if (f.key !== key.current) {
      key.current = f.key;
      live.current = { ...next };
      setVisual(live.current);
    } else {
      Object.assign(live.current, next);
    }
  }, -3);

  return (
    <>
      <CameraRig clock={clock} />
      <ForgeSet visual={visual} quality={quality} />
      <Actors visual={visual} quality={quality} reducedMotion={reducedMotion} />
      <PostFX quality={quality} />
      {DevProxy && devProxy ? <Suspense fallback={null}><DevProxy visual={visual} /></Suspense> : null}
    </>
  );
}

export default function Stage3D(props: Stage3DProps) {
  const { quality, onFail } = props;
  return (
    <Canvas
      frameloop="demand"
      dpr={quality.dpr}
      shadows={quality.tier === "high" ? "percentage" : false}
      gl={{ antialias: quality.tier === "high", powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: 34, near: 0.1, far: 160, position: [-3.2, 0.8, 9.2] }}
      style={{ position: "absolute", inset: 0 }}
      aria-hidden
      onCreated={({ gl }) => {
        const el = gl.domElement;
        el.addEventListener("webglcontextlost", (e) => { e.preventDefault(); onFail("WebGL context lost"); }, { once: true });
      }}
    >
      <color attach="background" args={[CINE_COLORS.void]} />
      <Bridge {...props} />
    </Canvas>
  );
}
