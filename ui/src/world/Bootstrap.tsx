// EXPERIMENT (exp/bootstrap): the Bootstrap prelude to the Daylight World. AN ILLUSTRATION, not an onboarding wizard:
// nothing here connects to anything. Appliance -> Connect -> Discover -> Permissions -> the existing office.
// One stage, one scroll progress `p` (0..1). Scrubbing uses the story's pattern (sticky stage + native scroll, no
// hijacking); mobile and reduced motion render each scene's settled frame instead. The office at the end IS the
// world's <Scene>, not a copy, and every Bootstrap element lands in the room that does its job.
import { useRef, useState, type ReactNode } from "react";
import { motion, motionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { Box, FOCUS, P, Scene } from "./Scene";
import { MascotSprite } from "./Mascot";
import { DEPTS, sceneState, type Dept } from "./events";
import { MANIFEST, RIGHTS, SCENES, STATUS, SYSTEMS, type Status } from "./bootstrap-data";
import { THEMES, type ThemeName } from "./theme";
import { SourceTag } from "./World";

const VIEW = "-320 -72 640 400"; // the office's whole-company framing (Scene, focus=null): shared coordinates
const AT: Record<Dept, [number, number]> = Object.fromEntries(
  (Object.keys(FOCUS) as Dept[]).map((d) => [d, P(...FOCUS[d])])) as Record<Dept, [number, number]>;
/** each scene's settled progress: what static rendering shows, and where the scroll centres each copy block */
const SETTLED = [0, 0.25, 0.5, 0.75, 1];
const EMPTY = sceneState([]);

/** translate+scale in viewBox units (elements are drawn centred on 0,0), as an SVG transform ATTRIBUTE: CSS
 *  transform origins on SVG groups are not the local origin, so this stays exact at every size */
function useMove(p: MotionValue<number>, input: number[], xs: number[], ys: number[], ss: number[]) {
  const x = useTransform(p, input, xs), y = useTransform(p, input, ys), s = useTransform(p, input, ss);
  return useTransform([x, y, s], ([a, b, c]) => `translate(${a} ${b}) scale(${c})`);
}

/** a group positioned by a motion value: the attribute is written directly on change, no React render per frame */
function Moved({ move, opacity, children, hidden }: { move: MotionValue<string>; opacity: MotionValue<number>; children: ReactNode; hidden?: boolean }) {
  const ref = useRef<SVGGElement>(null);
  useMotionValueEvent(move, "change", (v) => ref.current?.setAttribute("transform", v));
  return <motion.g ref={ref} transform={move.get()} style={{ opacity }} aria-hidden={hidden}>{children}</motion.g>;
}

const STROKE: Record<Status, { dash?: string; color: (t: Record<string, string>) => string }> = {
  supported: { color: (t) => t.signal },
  configured: { dash: "2 4", color: () => "#14203A" },
  awaiting: { dash: "7 5", color: (t) => t.warnR },
  unavailable: { dash: "1 7", color: (t) => t.dim },
};

/** status glyph: shape carries the meaning, colour only repeats it */
function Glyph({ status, t }: { status: Status; t: Record<string, string> }) {
  if (status === "supported") return <circle r={4} fill={t.signal} stroke="#14203A" strokeWidth={1.2} />;
  if (status === "configured") return <circle r={4} fill="#fff" stroke="#14203A" strokeWidth={1.2} />;
  if (status === "awaiting") return <g><circle r={4} fill="#fff" stroke="#14203A" strokeWidth={1.2} /><path d="M0 -4 A4 4 0 0 1 0 4 Z" fill={t.warn} stroke="#14203A" strokeWidth={0.8} /></g>;
  return <path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" stroke={t.dim} strokeWidth={1.8} />;
}

function Appliance({ p, t }: { p: MotionValue<number>; t: Record<string, string> }) {
  // a generic local workstation in the office's own isometric language; centred on its footprint
  const move = useMove(p, [0, 0.16, 0.25, 0.62, 0.72, 0.82, 0.94], [0, 0, 0, 0, 0, 0, AT.server[0]], [150, 150, 140, 140, 128, 128, AT.server[1] + 6],
    [2.1, 2.1, 1.25, 1.25, 0.8, 0.8, 0.45]);
  const fade = useTransform(p, [0, 0.6, 0.7, 0.86, 0.96], [1, 1, 0.35, 0.35, 0]);
  const power = useTransform(p, [0.05, 0.14], [0, 1]);
  const [cx, cy] = P(2, 2, 0);
  return (
    <Moved move={move} opacity={fade}>
      <g transform={`translate(${-cx} ${-cy})`}>
        <polygon points={[P(-0.6, -0.6), P(4.6, -0.6), P(4.6, 4.6), P(-0.6, 4.6)].map((q) => q.join(",")).join(" ")} fill={t.ground} opacity={0.9} />
        <Box x={0} y={0} w={4} d={4} h={1.9} top="#F2F6FA" left="#B9CFE3" right="#A3BED6" stroke="#14203A" />
        <Box x={0.5} y={0.5} z={1.9} w={3} d={3} h={0.08} top="#DDE7F0" left="#C3D2E0" right="#C3D2E0" />
        {/* front vents (left face) and a status light strip (right face) */}
        {[0.5, 0.8, 1.1].map((z) => <line key={z} x1={P(0.6, 4, z)[0]} y1={P(0.6, 4, z)[1]} x2={P(2.6, 4, z)[0]} y2={P(2.6, 4, z)[1]} stroke="#7D93AE" strokeWidth={1.2} />)}
        <motion.line style={{ opacity: power }} x1={P(4, 0.8, 1.3)[0]} y1={P(4, 0.8, 1.3)[1]} x2={P(4, 3.2, 1.3)[0]} y2={P(4, 3.2, 1.3)[1]} stroke={t.signal} strokeWidth={2.2} />
      </g>
    </Moved>
  );
}

function Cable({ i, p, t }: { i: number; p: MotionValue<number>; t: Record<string, string> }) {
  const s = SYSTEMS[i];
  const a = 0.08 + i * 0.03; // each connection draws on its own, one after another
  const draw = useTransform(p, [a, a + 0.06], [0, 1]);
  const o = useTransform(p, [a, a + 0.01, 0.6, 0.7], [0, 1, 1, 0]);
  const st = STROKE[s.status];
  const [x, y] = s.at;
  return (
    <motion.path d={`M0 128 C ${x * 0.5} 128, ${x * 0.5} ${y}, ${x} ${y}`} fill="none" stroke={st.color(t)} strokeWidth={s.status === "supported" ? 2.4 : 1.8}
      strokeDasharray={st.dash} style={{ pathLength: st.dash ? 1 : draw, opacity: o }} />
  );
}

function Node({ i, p, t }: { i: number; p: MotionValue<number>; t: Record<string, string> }) {
  const s = SYSTEMS[i];
  const a = 0.08 + i * 0.03;
  const [x, y] = s.at;
  // systems with a place in the office fly to their room (side by side, above it); unavailable ones simply leave
  const dest = s.dept ? [AT[s.dept][0] + (i % 2 ? 30 : -30), AT[s.dept][1] - 34] : s.at;
  const move = useMove(p, [a, a + 0.06, 0.6, 0.72, 0.82, 0.92], [x, x, x, x, x, dest[0]], [y + 10, y, y, y, y, dest[1]], [0.9, 1, 1, 0.82, 0.82, 0.42]);
  const opacity = useTransform(p, s.dept ? [a, a + 0.05, 0.6, 0.7, 0.82, 0.88, 0.94] : [a, a + 0.05, 0.6, 0.7, 0.8],
    s.dept ? [0, 1, 1, 0.3, 0.3, 0.85, 0] : [0, 1, 1, 0.3, 0]);
  const found = useTransform(p, [0.36 + i * 0.03, 0.4 + i * 0.03, 0.6, 0.66], [0, 1, 1, 0]);
  return (
    <Moved move={move} opacity={opacity} hidden>
      <rect x={-64} y={-19} width={128} height={38} rx={3} fill="#14203A" transform="translate(3 3)" />
      <rect x={-64} y={-19} width={128} height={38} rx={3} fill="#fff" stroke="#14203A" strokeWidth={2} />
      <text x={-55} y={-4} fontSize={11} fontWeight={650} fill="#14203A">{s.name}</text>
      <g transform="translate(-50 9)"><Glyph status={s.status} t={t} /></g>
      <text x={-42} y={12.5} fontSize={9.5} fill="#4A5A70">{STATUS[s.status].text}</text>
      <motion.g style={{ opacity: found }}>
        <rect x={-64} y={23} width={128} height={18} rx={3} fill={t.paper} stroke="#14203A" strokeWidth={1} strokeDasharray={s.status === "supported" ? undefined : "3 3"} />
        <text x={0} y={35.5} textAnchor="middle" fontSize={9.5} fill="#14203A">{s.found}</text>
      </motion.g>
    </Moved>
  );
}

function Ember({ p, still }: { p: MotionValue<number>; still: boolean }) {
  // steps out of the appliance and visits each reachable system (read-only), then goes back to work
  const stops = [[0, 128], [0, 170], [-120, 60], [-120, 200], [120, 60], [0, 182], [0, 182]];
  const input = [0.3, 0.34, 0.39, 0.45, 0.51, 0.58, 0.68];
  const move = useMove(p, input, stops.map((q) => q[0]), stops.map((q) => q[1]), stops.map(() => 1));
  const opacity = useTransform(p, [0.3, 0.33, 0.62, 0.7], [0, 1, 1, 0]);
  return (
    <Moved move={move} opacity={opacity}>
      <ellipse cx={0} cy={0} rx={14} ry={5} fill="#000" opacity={0.18} />
      <MascotSprite state="investigating" x={0} y={2} px={2.2} still={still} />
    </Moved>
  );
}

function Right({ i, p, t }: { i: number; p: MotionValue<number>; t: Record<string, string> }) {
  const r = RIGHTS[i];
  const a = 0.6 + i * 0.03;
  const row: [number, number] = [0, 70 + i * 34];
  const dest = AT[r.dept];
  const move = useMove(p, [a, a + 0.05, 0.8, 0.93], [row[0], row[0], row[0], dest[0]], [row[1] + 8, row[1], row[1], dest[1] + 8], [1, 1, 1, 0.5]);
  const opacity = useTransform(p, [a, a + 0.04, 0.93, 0.98], [0, 1, 1, 0]);
  return (
    <Moved move={move} opacity={opacity} hidden>
      <rect x={-150} y={-14} width={300} height={28} rx={3} fill="#fff" stroke="#14203A" strokeWidth={1.5} />
      <text x={-140} y={4} fontSize={10.5} fill="#14203A">{r.text}</text>
      <rect x={52} y={-9} width={92} height={18} rx={2} fill={r.person ? t.warn : t.paper} stroke="#14203A" strokeWidth={1} />
      <text x={98} y={4} textAnchor="middle" fontSize={9} fontWeight={650} fill="#14203A">{r.rule}</text>
    </Moved>
  );
}

function ManifestFrame({ p }: { p: MotionValue<number> }) {
  const opacity = useTransform(p, [0.58, 0.63, 0.8, 0.86], [0, 1, 1, 0]);
  return (
    <motion.g style={{ opacity }} aria-hidden>
      <rect x={-166} y={18} width={338} height={186} rx={4} fill="#14203A" />
      <rect x={-169} y={15} width={338} height={186} rx={4} fill="#FFF4D6" stroke="#14203A" strokeWidth={2} />
      <text x={-155} y={38} fontSize={12} fontWeight={700} fill="#14203A">Environment manifest</text>
      <text x={155} y={38} textAnchor="end" fontSize={9} fontFamily="JetBrains Mono Variable, monospace" fill="#4A5A70">example, nothing granted</text>
    </motion.g>
  );
}

/** The stage. Only motion values change while scrolling: no React re-render per frame. */
export function Stage({ p, theme, still, label }: { p: MotionValue<number>; theme: ThemeName; still: boolean; label: string }) {
  const t = THEMES[theme];
  const office = useTransform(p, [0.8, 0.95], [0, 1]);
  const officeScale = useTransform(p, [0.8, 0.98], [1.06, 1]);
  return (
    <div role="img" aria-label={label} className="relative h-full w-full overflow-hidden" style={{ background: t.bg }}>
      <motion.div className="absolute inset-0" style={{ opacity: office, scale: officeScale }} aria-hidden>
        <Scene state={EMPTY} theme={theme} focus={null} onOpen={() => {}} open={null} label="The office" still />
      </motion.div>
      <svg viewBox={VIEW} className="absolute inset-0 h-full w-full" fontFamily="Schibsted Grotesk Variable, system-ui, sans-serif" aria-hidden>
        {SYSTEMS.map((_, i) => <Cable key={i} i={i} p={p} t={t} />)}
        <Appliance p={p} t={t} />
        {SYSTEMS.map((_, i) => <Node key={i} i={i} p={p} t={t} />)}
        <Ember p={p} still={still} />
        <ManifestFrame p={p} />
        {RIGHTS.map((_, i) => <Right key={i} i={i} p={p} t={t} />)}
      </svg>
    </div>
  );
}

// ---- copy ---------------------------------------------------------------------------------------------------------

function StatusList() {
  return (
    <ul className="space-y-2" aria-label="Connections in this illustration">
      {SYSTEMS.map((s) => (
        <li key={s.id} className="flex items-baseline gap-3">
          <svg aria-hidden viewBox="-6 -6 12 12" className="size-3.5 shrink-0 translate-y-0.5"><Glyph status={s.status} t={THEMES.daylight} /></svg>
          <span><span className="font-semibold">{s.name}</span> <span className="world-muted">({s.via}): {STATUS[s.status].text.toLowerCase()}, {STATUS[s.status].meaning}.</span></span>
        </li>
      ))}
    </ul>
  );
}

function Discovered() {
  const rows: [string, string][] = [
    ["Systems inventoried", `${SYSTEMS.filter((s) => s.status === "supported").length} readable of ${SYSTEMS.length}`],
    ["Schemas found", [...MANIFEST.environment.record_kinds, ...MANIFEST.environment.evidence_sources.map((e) => e.split(":")[0])].join(", ")],
    ["Tools identified", `${MANIFEST.tool_inventory.slice(0, 3).join(", ")} and ${MANIFEST.tool_inventory.length - 3} more`],
    ["Workflows proposed", MANIFEST.missing_skill_opportunities.join(", ")],
  ];
  return (
    <dl className="world-card grid gap-x-4 gap-y-2 p-4 text-meta sm:grid-cols-[auto_1fr]" aria-label="Example discovery results">
      {rows.map(([k, v]) => (
        <div key={k} className="contents"><dt className="font-semibold">{k}</dt><dd className="world-muted [overflow-wrap:anywhere]">{v}</dd></div>
      ))}
    </dl>
  );
}

function Rights() {
  return (
    <ul className="space-y-2" aria-label="Example manifest">
      {RIGHTS.map((r) => (
        <li key={r.text} className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold">{r.text}:</span>
          <span className={r.person ? "world-warn font-semibold" : "world-muted"}>{r.rule}</span>
          <span className="world-muted">({DEPTS[r.dept].name})</span></li>
      ))}
    </ul>
  );
}

const COPY: { heading: ReactNode; body: ReactNode; extra?: ReactNode; h1?: boolean }[] = [
  { h1: true, heading: "Your company. Your AI. Your rules.",
    body: "SkillForge runs on a workstation in your own office. The model, your data and every decision stay on that machine." },
  { heading: "Connect what you already use, one system at a time",
    body: "Each connection is added on its own, and only after someone allowed to grant it says yes. What SkillForge supports today (this page checks nothing; real status is in the console):",
    extra: <StatusList /> },
  { heading: "Ember looks around and changes nothing",
    body: "Discovery is read-only. Ember lists the systems it can reach, the shape of their data, the tools it may use, and the work that looks repeatable. Example output:",
    extra: <Discovered /> },
  { heading: "Nothing runs until a person says so",
    body: "What Ember found becomes a manifest: what it may read, what it may propose, and who has to approve. Every change waits for a person and is re-checked by code Ember doesn't control.",
    extra: <Rights /> },
  { heading: "This is your company now",
    body: "The manifest becomes the office. Requests arrive at operations intake, Ember works in the local AI room, people decide at the review desk, every change passes the independent check, and proven skills go on the library shelf.",
    extra: (
      <div className="flex flex-wrap gap-3 pt-1">
        <a href="#/world/onboard" className="world-btn world-btn-primary">Set up a real workspace (read-only)</a>
        <a href="#story" onClick={(e) => { e.preventDefault(); document.getElementById("story")?.scrollIntoView(); }} className="world-btn">Follow one problem</a>
      </div>
    ) },
];

function Copy({ i }: { i: number }) {
  const c = COPY[i];
  const H = c.h1 ? "h1" : "h2";
  return (
    <div className="space-y-4">
      <H className={`${c.h1 ? "world-h1" : "world-h2"} text-balance`}>{c.heading}</H>
      <p className={c.h1 ? "world-lead max-w-[34rem]" : "world-body max-w-[36rem]"}>{c.body}</p>
      {c.extra ? <div className="world-body max-w-[36rem]">{c.extra}</div> : null}
    </div>
  );
}

/** Truth bar: always on screen with the scenes. Says what this is and where the real thing is. */
function Truth() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-meta">
      <SourceTag source="story" />
      <span className="world-muted">An illustration: nothing on this page connects to anything.</span>
      <a className="world-link" href="#/world/onboard">Try the read-only version on a real workspace</a>
      <a className="world-link" href="#story" onClick={(e) => { e.preventDefault(); document.getElementById("story")?.scrollIntoView(); }}>Skip to the office</a>
      <a className="world-link" href="#/console">Open the console</a>
    </div>
  );
}

/** desktop: sticky stage left (where the world's story keeps it), copy blocks scroll on the right */
function Scrubbed({ theme }: { theme: ThemeName }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [at, setAt] = useState(0);
  useMotionValueEvent(p, "change", (v) => {
    const k = SETTLED.reduce((best, s, i) => (Math.abs(v - s) < Math.abs(v - SETTLED[best]) ? i : best), 0);
    if (k !== at) setAt(k);
  });
  const go = (i: number) => document.getElementById(SCENES[i].id)?.scrollIntoView({ block: "center" });
  return (
    <section ref={ref} aria-labelledby="bs-h" className="relative mx-auto grid max-w-[88rem] gap-x-8 px-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <h2 id="bs-h" className="sr-only">Bootstrap: from a new machine to your company (illustration)</h2>
      {/* 768-1023: the stage stays landscape on top and the copy scrolls beneath it; from 1024 it sits on the left */}
      <div className="sticky top-14 z-10 h-[56dvh] py-3 lg:top-16 lg:h-[calc(100dvh-5rem)] lg:py-4" style={{ background: THEMES[theme].bg }}>
        <div className="world-scene-frame relative h-full overflow-hidden">
          <Stage p={p} theme={theme} still={false} label={`Illustration, scene ${at + 1} of ${SCENES.length}: ${SCENES[at].short}`} />
          <div className="absolute top-3 left-3"><SourceTag source="story" /></div>
          <nav aria-label="Bootstrap scenes" className="absolute inset-x-3 bottom-3 flex justify-center">
            <ol className="world-key flex flex-wrap gap-1 p-1">
              {SCENES.map((s, i) => (
                <li key={s.id}><button type="button" onClick={() => go(i)} aria-current={at === i ? "step" : undefined}
                  className={`world-seg-item text-meta ${at === i ? "is-on" : ""}`}>{s.short}</button></li>
              ))}
            </ol>
          </nav>
        </div>
      </div>
      <div>
        <div className="pt-6"><Truth /></div>
        {COPY.map((_, i) => (
          <div key={i} id={SCENES[i].id} className="flex min-h-[44dvh] items-center py-8 lg:min-h-[calc(100dvh-5rem)] lg:py-0"><Copy i={i} /></div>
        ))}
      </div>
    </section>
  );
}

/** mobile and reduced motion: each scene is a card with its settled frame; nothing moves with scroll */
function Settled({ theme, cards }: { theme: ThemeName; cards: boolean }) {
  const frames = SETTLED.map((v) => motionValue(v));
  return (
    <section aria-labelledby="bs-h-s" className={`mx-auto max-w-[60rem] space-y-6 ${cards ? "px-4" : "px-6"} pt-6`}>
      <h2 id="bs-h-s" className="sr-only">Bootstrap: from a new machine to your company (illustration)</h2>
      <Truth />
      <ol className="space-y-8">
        {COPY.map((_, i) => (
          <li key={i} id={SCENES[i].id} className="world-card space-y-4 p-4">
            <div className={`world-scene-frame overflow-hidden ${cards ? "h-56" : "h-80"}`}>
              <Stage p={frames[i]} theme={theme} still label={`Illustration, scene ${i + 1} of ${SCENES.length}: ${SCENES[i].short}`} />
            </div>
            <Copy i={i} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Bootstrap({ theme, desktop }: { theme: ThemeName; desktop: boolean }) {
  const reduce = useReducedMotion();
  return desktop && !reduce ? <Scrubbed theme={theme} /> : <Settled theme={theme} cards={!desktop} />;
}
