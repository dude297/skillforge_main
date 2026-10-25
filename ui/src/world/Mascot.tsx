import { useEffect, useMemo, useRef, useState } from "react";
import { useVisible } from "./Scene";
import { useReducedMotion } from "motion/react";
import { H, runs, STATES, W, type MascotState } from "./sprites";

/** Pixel sprite renderer. Reduced motion: the state's first frame, still (the prop says which state it is). */
export function Mascot({ state, px = 4, title, still = false }: { state: MascotState; px?: number; title?: string; still?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const visible = useVisible(ref);
  const reduce = useReducedMotion() || !visible || still; // off screen or an icon: no frame timer at all
  const spec = STATES[state];
  const frames = useMemo(() => spec.frames.map(runs), [spec]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setTick((t) => t + 1), spec.ms);
    return () => window.clearInterval(id);
  }, [reduce, spec.ms]);
  const f = frames[reduce ? 0 : tick % frames.length];
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W * px} height={H * px} shapeRendering="crispEdges" role="img" style={{ imageRendering: "pixelated" }} className="block"
      aria-label={title ?? `Ember, the SkillForge agent: ${spec.label.toLowerCase()}`}>
      {f.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />)}
    </svg>
  );
}

/** For use inside another SVG (the scene): same frames, positioned in the parent's coordinates. */
export function MascotSprite({ state, x, y, px = 1.6, still = false }: { state: MascotState; x: number; y: number; px?: number; still?: boolean }) {
  const reduce = useReducedMotion() || still;
  const spec = STATES[state];
  const frames = useMemo(() => spec.frames.map(runs), [spec]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setTick((t) => t + 1), spec.ms);
    return () => window.clearInterval(id);
  }, [reduce, spec.ms]);
  const f = frames[reduce ? 0 : tick % frames.length];
  return (
    <g transform={`translate(${x - (W * px) / 2} ${y - H * px}) scale(${px})`} shapeRendering="crispEdges" aria-hidden>
      {f.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />)}
    </g>
  );
}
