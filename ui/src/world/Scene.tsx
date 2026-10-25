// 2.5D isometric company in plain SVG: no canvas, no WebGL, no new dependency. Pixel feel from crisp edges, a 2:1
// tile grid and stepped colours. Everything the scene shows comes from `state` (see events.ts sceneState).
import { useEffect, useRef, useState, type RefObject } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Dept, SceneState } from "./events";
import { DEPTS } from "./events";
import { MascotSprite } from "./Mascot";
import { THEMES, type ThemeName } from "./theme";

const TW = 18, TH = 9, ZH = 18; // half tile width/height, one height unit
export const P = (x: number, y: number, z = 0): [number, number] => [(x - y) * TW, (x + y) * TH - z * ZH];
export const pts = (a: [number, number][]) => a.map((p) => p.join(",")).join(" ");

export function Box({ x, y, z = 0, w, d, h, top, left, right, stroke }: { x: number; y: number; z?: number; w: number; d: number; h: number; top: string; left: string; right: string; stroke?: string }) {
  return (
    <g stroke={stroke} strokeWidth={stroke ? 0.6 : 0}>
      <polygon points={pts([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)])} fill={left} />
      <polygon points={pts([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)])} fill={right} />
      <polygon points={pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)])} fill={top} />
    </g>
  );
}

const ROOMS: Record<Exclude<Dept, "gate">, { x: number; y: number }> = {
  server: { x: 0, y: 0 }, review: { x: 9, y: 0 }, intake: { x: 0, y: 9 }, library: { x: 9, y: 9 },
};
const SIZE = 6;
/** each sign sits at its room's OUTER corner, so none collides with the central gate */
const SIGN: Record<Exclude<Dept, "gate">, { at: [number, number, number]; anchor: "start" | "middle" | "end"; dy: number }> = {
  server: { at: [0, 0, 2.2], anchor: "middle", dy: -8 }, review: { at: [15, 0, 2.2], anchor: "end", dy: -6 },
  intake: { at: [0, 15, 2.2], anchor: "start", dy: -6 }, library: { at: [15, 15, 0], anchor: "middle", dy: 22 },
};
/** where the companion stands in each department (tile coords) */
const SPOT: Record<Dept, [number, number]> = { server: [3.6, 4.4], review: [11, 4.6], intake: [3.2, 12.6], library: [12.4, 13.2], gate: [7.5, 7.5] };
export const FOCUS: Record<Dept, [number, number]> = { server: [3, 3], review: [12, 3], intake: [3, 12], library: [12, 12], gate: [7.5, 7.5] };
const HUB = P(7.5, 7.5);

function Room({ id, theme, children, onOpen, active }: { id: Exclude<Dept, "gate">; theme: ThemeName; children: React.ReactNode; onOpen: (d: Dept) => void; active: boolean }) {
  const t = THEMES[theme];
  const { x, y } = ROOMS[id];
  const tiles = [];
  for (let i = 0; i < SIZE; i++)
    for (let j = 0; j < SIZE; j++)
      tiles.push(<polygon key={`${i}-${j}`} points={pts([P(x + i, y + j), P(x + i + 1, y + j), P(x + i + 1, y + j + 1), P(x + i, y + j + 1)])}
        fill={(i + j) % 2 ? t.floorA : t.floorB} />);
  const sign = SIGN[id];
  const [sx, sy] = P(...sign.at);
  const tw = DEPTS[id].name.length * 5.5 + 10;
  const rx = sign.anchor === "start" ? -4 : sign.anchor === "end" ? -tw + 4 : -tw / 2;
  return (
    <g role="button" tabIndex={0} aria-label={`${DEPTS[id].name}. Show what happens here`} className="world-dept cursor-pointer outline-none"
      onClick={() => onOpen(id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(id); } }}>
      {tiles}
      {/* back walls */}
      <polygon points={pts([P(x, y), P(x + SIZE, y), P(x + SIZE, y, 2), P(x, y, 2)])} fill={t.wallA} />
      <polygon points={pts([P(x, y), P(x, y + SIZE), P(x, y + SIZE, 2), P(x, y, 2)])} fill={t.wallB} />
      <polygon className="world-dept-ring" points={pts([P(x, y), P(x + SIZE, y), P(x + SIZE, y + SIZE), P(x, y + SIZE)])} fill="none"
        stroke={active ? t.focus : "transparent"} strokeWidth={1.5} />
      {children}
      <g transform={`translate(${sx} ${sy + sign.dy})`}>
        <rect x={rx} y={-10} width={tw} height={14} fill={t.sign} rx={1} />
        <text x={rx + tw / 2} y={0} textAnchor="middle" fontSize={9} fontFamily="JetBrains Mono Variable, monospace" fill={t.signText}>{DEPTS[id].name}</text>
      </g>
      <title>{DEPTS[id].name}</title>
    </g>
  );
}

/** a tiny LED that blinks irregularly; still under reduced motion and while off screen */
function Led({ at, color, delay, live }: { at: [number, number]; color: string; delay: number; live: boolean }) {
  return <rect x={at[0] - 1} y={at[1] - 1} width={2} height={2} fill={color} className={live ? "world-led" : ""} style={{ animationDelay: `${delay}ms` }} />;
}

/** true while the element is (near) the viewport: off-screen scenes stop animating */
export function useVisible(ref: RefObject<Element | null>) {
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return v;
}

function Person({ at, theme }: { at: [number, number]; theme: ThemeName }) {
  const t = THEMES[theme];
  // an original 7x12 reviewer: hair, face, shirt, legs (pixel blocks)
  const px = 1.7, [x, y] = at;
  const rows: [number, number, number, string][] = [
    [2, 0, 3, t.hair], [1, 1, 5, t.hair], [1, 2, 5, t.skin], [1, 3, 5, t.skin], [2, 4, 3, t.skin],
    [0, 5, 7, t.shirt], [0, 6, 7, t.shirt], [0, 7, 7, t.shirt], [1, 8, 5, t.shirt], [1, 9, 2, t.legs], [4, 9, 2, t.legs], [1, 10, 2, t.legs], [4, 10, 2, t.legs],
  ];
  return (
    <g transform={`translate(${x - 3.5 * px} ${y - 11 * px}) scale(${px})`} shapeRendering="crispEdges" aria-hidden>
      {rows.map(([rx, ry, w, c], i) => <rect key={i} x={rx} y={ry} width={w} height={1} fill={c} />)}
      <rect x={2} y={2} width={1} height={1} fill="#14203A" /><rect x={4} y={2} width={1} height={1} fill="#14203A" />
    </g>
  );
}

export function Scene({ state, theme, focus, zoom = 1, onOpen, open, label, still = false }: {
  state: SceneState; theme: ThemeName; focus: Dept | null; zoom?: number; onOpen: (d: Dept) => void; open: Dept | null; label: string;
  /** a static frame (mobile cards): no camera or walking motion, departments not interactive */
  still?: boolean;
}) {
  const t = THEMES[theme];
  const reduce = useReducedMotion() || still;
  const box = useRef<HTMLDivElement>(null);
  const visible = useVisible(box);
  const animate = visible && !reduce;
  const cur = state.current;
  const dept: Dept = cur?.dept ?? "intake";
  const [mx, my] = P(...SPOT[dept]);

  // companion path: always through the central hub, like walking the corridor (keyframes from the previous spot).
  // Derived during render from the previous target (React's "adjust state when a prop changes" pattern).
  const [path, setPath] = useState({ at: [mx, my], x: [mx], y: [my] });
  if (path.at[0] !== mx || path.at[1] !== my)
    setPath({ at: [mx, my], x: [path.at[0], HUB[0], mx], y: [path.at[1], HUB[1], my] });

  // camera: the viewBox frames the focused department (whole office when focus is null)
  const [fx, fy] = focus ? P(...FOCUS[focus]) : [0, 128];
  const vw = 640 / (focus ? zoom : 1), vh = 400 / (focus ? zoom : 1);
  const viewBox = `${fx - vw / 2} ${fy - vh / 2} ${vw} ${vh}`;

  const gateColor = state.gate === "pass" ? t.ok : state.gate === "fail" ? t.fail : state.gate === "pending" ? t.signal : t.dim;
  const rackLeds = [[0.6, 0.6], [1.9, 0.6], [3.2, 0.6]] as const;

  const cam = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 70, damping: 20 };
  return (
    <div ref={box} role="group" aria-label={label} data-mascot={state.mascot} data-gate={state.gate} data-waiting={state.waiting} className={`relative h-full w-full ${still ? "pointer-events-none" : ""}`} style={{ background: t.bg }}
      {...(still ? { inert: true } : {})}>
    <motion.svg viewBox={viewBox} animate={{ viewBox }} transition={cam} className="h-full w-full" shapeRendering="crispEdges">
      {/* ground plate */}
      <polygon points={pts([P(-1, -1), P(16, -1), P(16, 16), P(-1, 16)])} fill={t.ground} />
      {/* corridor */}
      <polygon points={pts([P(6, -0.5), P(9, -0.5), P(9, 15.5), P(6, 15.5)])} fill={t.corridor} />
      <polygon points={pts([P(-0.5, 6), P(15.5, 6), P(15.5, 9), P(-0.5, 9)])} fill={t.corridor} />

      <Room id="server" theme={theme} onOpen={onOpen} active={open === "server"}>
        {rackLeds.map(([x, y], i) => (
          <g key={i}>
            <Box x={x} y={y} w={1} h={2.6} d={1} top={t.rackTop} left={t.rackL} right={t.rackR} />
          </g>
        ))}
        <Box x={2.4} y={3} w={1.4} d={1.4} h={1} top={state.served ? t.signal : t.rackTop} left={t.rackL} right={t.rackR} />
      </Room>

      <Room id="review" theme={theme} onOpen={onOpen} active={open === "review"}>
        <Box x={10.2} y={1.6} w={3} d={1.3} h={0.9} top={t.wood} left={t.woodL} right={t.woodR} />
        <Box x={10.6} y={1.9} w={0.9} d={0.6} h={0.12} z={0.9} top={t.paper} left={t.paper} right={t.paper} />
        <Person at={P(11.8, 1.1, 0)} theme={theme} />
        {/* approval lamp: amber while a person is needed */}
        <Box x={12.6} y={1.9} w={0.3} d={0.3} h={0.6} z={0.9} top={state.waiting ? t.warn : t.dim} left={t.rackL} right={t.rackR} />
      </Room>

      <Room id="intake" theme={theme} onOpen={onOpen} active={open === "intake"}>
        <Box x={0.6} y={10.4} w={5} d={1} h={0.45} top={t.belt} left={t.rackL} right={t.rackR} />
        {Array.from({ length: Math.min(state.tickets, 4) }).map((_, i) => (
          <Box key={i} x={1 + i * 1.2} y={10.6} z={0.45} w={0.7} d={0.6} h={0.5} top={t.ticket} left={t.ticketL} right={t.ticketR} />
        ))}
        <Box x={0} y={13.2} w={0.2} d={1.6} h={2.2} top={t.wallA} left={t.door} right={t.door} />
      </Room>

      <Room id="library" theme={theme} onOpen={onOpen} active={open === "library"}>
        <Box x={9.6} y={9.4} w={4.6} d={0.9} h={2.4} top={t.wood} left={t.woodL} right={t.woodR} />
        {Array.from({ length: 6 }).map((_, i) => {
          const filled = i < state.stored, drafted = !filled && i < state.stored + state.drafted;
          return <Box key={i} x={13.4 - i * 0.72} y={9.55} z={2.4} w={0.5} d={0.6} h={0.55}
            top={filled ? t.ok : drafted ? t.warn : t.slot} left={filled ? t.okL : drafted ? t.warnL : t.slotL} right={filled ? t.okR : drafted ? t.warnR : t.slotL} />;
        })}
      </Room>

      {/* independent check: a gate at the crossroads every change passes through */}
      <g role="button" tabIndex={0} aria-label={`${DEPTS.gate.name}. Show what happens here`} className="world-dept cursor-pointer outline-none"
        onClick={() => onOpen("gate")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen("gate"); } }}>
        {/* hit area: the whole gate, not only its floor tile */}
        <rect x={P(6.6, 8.4)[0]} y={P(6.6, 6.6, 2.9)[1]} width={P(8.4, 6.6)[0] - P(6.6, 8.4)[0]} height={P(8.4, 8.4)[1] - P(6.6, 6.6, 2.9)[1]} fill="transparent" />
        <polygon className="world-dept-ring" points={pts([P(6.6, 6.6), P(8.4, 6.6), P(8.4, 8.4), P(6.6, 8.4)])} fill={t.gateFloor} stroke={open === "gate" ? t.focus : "transparent"} strokeWidth={1.5} />
        <Box x={6.7} y={7.3} w={0.35} d={0.35} h={2.4} top={t.rackTop} left={t.rackL} right={t.rackR} />
        <Box x={7.95} y={7.3} w={0.35} d={0.35} h={2.4} top={t.rackTop} left={t.rackL} right={t.rackR} />
        <Box x={6.7} y={7.3} z={2.4} w={1.6} d={0.35} h={0.35} top={gateColor} left={gateColor} right={gateColor} />
        <g transform={`translate(${P(4.4, 7.6)[0]} ${P(4.4, 7.6)[1] + 4})`}>
          <rect x={-48} y={-10} width={96} height={14} fill={t.sign} rx={1} />
          <text x={0} y={0} textAnchor="middle" fontSize={9} fontFamily="JetBrains Mono Variable, monospace" fill={t.signText}>Independent check</text>
        </g>
        <title>{DEPTS.gate.name}</title>
      </g>

    </motion.svg>
    {/* OVERLAY: everything that moves. Separate SVG, same camera: a sprite frame or LED blink repaints only this layer */}
    <motion.svg viewBox={viewBox} animate={{ viewBox }} transition={cam} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" shapeRendering="crispEdges">
      {rackLeds.map(([x, y], i) => [0.6, 1.1, 1.6, 2.1].map((z, k) => (
        <Led key={`${i}-${k}`} at={P(x + 0.3 + (k % 2) * 0.4, y + 1, z)} color={k % 3 ? t.signal : t.ok} delay={(i * 7 + k * 13) * 97 % 1900} live={animate} />
      )))}
      {state.waiting ? <circle cx={P(12.75, 2.05, 1.6)[0]} cy={P(12.75, 2.05, 1.6)[1]} r={6} fill={t.warn} opacity={0.35} className={animate ? "world-pulse" : ""} /> : null}
      {/* the companion, walking the corridor between departments */}
      <motion.g initial={false} animate={{ x: path.x, y: path.y }} transition={reduce ? { duration: 0 } : { duration: 1.1, ease: "easeInOut", times: [0, 0.5, 1] }}>
        <ellipse cx={0} cy={0} rx={16} ry={6} fill="#000" opacity={0.18} />
        <MascotSprite state={state.mascot} x={0} y={2} px={2.1} still={!animate} />
      </motion.g>
    </motion.svg>
    </div>
  );
}
