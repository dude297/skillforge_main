// The six beats as still frames, in plan view: the same words, the same colours, the same truth rules as the film.
// Used when WebGL is unavailable or fails, and (stepped by the visitor) under reduced motion when WebGL is absent.
// Every status colour comes from CineVisual, which comes from the sceneState() fold; nothing here decides what happened.
import { CINE_COLORS, LAYOUT, type CineVisual } from "../contract";
import { DEPTS } from "../../world/events";
import { frameAt, visualFor } from "../timeline/frame";
import { endOfBeat } from "../timeline/sequence";

const { signal: SIGNAL, verified: GREEN, warn: AMBER, fail: ROSE } = CINE_COLORS;
const DIM = "var(--color-line-strong)";
const sx = (x: number) => 520 + x * 40;
const sz = (z: number) => 400 + z * 38;
const P = {
  intake: [sx(LAYOUT.intake[0]), sz(LAYOUT.intake[2])] as const,
  machine: [sx(LAYOUT.machine[0]), sz(LAYOUT.machine[2])] as const,
  review: [sx(LAYOUT.review[0]), sz(LAYOUT.review[2])] as const,
  verify: [sx(LAYOUT.verify[0]), sz(LAYOUT.verify[2])] as const,
  library: [sx(LAYOUT.library[0]), sz(LAYOUT.library[2])] as const,
  stop: [sx(LAYOUT.refusalStop[0]), sz(LAYOUT.refusalStop[2])] as const,
  via1: [sx(LAYOUT.shortPathVia[0][0]), sz(LAYOUT.shortPathVia[0][2])] as const,
  via2: [sx(LAYOUT.shortPathVia[1][0]), sz(LAYOUT.shortPathVia[1][2])] as const,
};

/** What this beat's frames say, sampled across the beat (the end state alone can hide that a short path ran before a refusal). */
function sample(index: number) {
  const kinds = new Set<string>();
  let reach = visualFor(frameAt(endOfBeat(index)));
  for (let k = 0; k <= index; k++) {
    for (const p of [0.25, 0.5, 0.75, 1]) {
      const t = k === 0 ? endOfBeat(0) * p : endOfBeat(k - 1) + (endOfBeat(k) - endOfBeat(k - 1)) * p;
      const v = visualFor(frameAt(t));
      if (v.route) kinds.add(v.route.kind);
      if (k === index && p === 1) reach = v;
    }
  }
  return { visual: reach, kinds };
}

function Station({ at, w, h, label, short, lit, stroke, children }: { at: readonly [number, number]; w: number; h: number; label: string; short: string; lit: boolean; stroke: string; children?: React.ReactNode }) {
  const y = at[1] + h / 2 + 26;
  return (
    <g opacity={lit ? 1 : 0.4}>
      <rect x={at[0] - w / 2} y={at[1] - h / 2} width={w} height={h} rx={6} fill="var(--color-surface)" stroke={stroke} strokeWidth={1.25} />
      {children}
      <text className="forge-lbl forge-lbl-long" x={at[0]} y={y} textAnchor="middle">{label}</text>
      <text className="forge-lbl forge-lbl-short" x={at[0]} y={y} textAnchor="middle">{short}</text>
    </g>
  );
}

const line = (a: readonly [number, number], b: readonly [number, number], c: string, dash?: string) => (
  <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={c} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeDasharray={dash} />
);

export function PosterScene({ index }: { index: number }) {
  const { visual: v, kinds } = sample(index);
  const waiting = v.review === "waiting";
  const stored = v.artifact?.phase === "stored";
  const showFull = index >= 1;
  const toReview = index >= 2;
  const toVerify = index >= 3 || v.verify !== "idle";
  const verifyColour = v.verify === "passed" ? GREEN : v.verify === "failed" ? ROSE : v.verify === "checking" ? SIGNAL : DIM;
  const shortSeen = index >= 4 && kinds.has("short");
  const refused = index >= 4 && kinds.has("refused");
  const libStroke = stored ? GREEN : v.artifact ? SIGNAL : DIM;
  return (
    <svg className="forge-poster-svg" viewBox="40 52 920 430" role="img" aria-label={`Plan view of the SkillForge office at this moment of the story: ${DEPTS.intake.name}, ${DEPTS.server.name}, ${DEPTS.review.name}, ${DEPTS.gate.name} and ${DEPTS.library.name}.`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="forge-grid" width="40" height="38" patternUnits="userSpaceOnUse"><path d="M40 0H0V38" fill="none" stroke="var(--color-line)" strokeOpacity={0.5} strokeWidth={1} /></pattern>
      </defs>
      <rect x={40} y={52} width={920} height={430} fill="url(#forge-grid)" opacity={0.55} />
      {/* the trace: one hairline that follows the work */}
      {showFull ? line(P.intake, P.machine, SIGNAL) : null}
      {toReview ? line(P.machine, P.review, waiting ? AMBER : SIGNAL, waiting ? "4 6" : undefined) : null}
      {toVerify ? line(P.review, P.verify, verifyColour) : null}
      {index >= 3 && v.artifact ? <path d={`M${P.verify[0]} ${P.verify[1] - 24}Q${P.verify[0]} ${P.library[1]} ${P.library[0] + 58} ${P.library[1]}`} stroke={stored ? GREEN : SIGNAL} strokeWidth={1.5} fill="none" /> : null}
      {shortSeen || refused ? <path d={`M${P.intake[0]} ${P.intake[1]}C${P.via1[0]} ${P.via1[1] + 60} ${P.via1[0]} ${P.via1[1]} ${P.via2[0]} ${P.via2[1]}`} stroke={refused && !shortSeen ? ROSE : SIGNAL} strokeWidth={1.5} fill="none" /> : null}
      {shortSeen ? <path d={`M${P.via2[0]} ${P.via2[1]}C${P.via2[0] + 90} ${P.via2[1] - 14} ${P.library[0]} ${P.library[1] - 70} ${P.library[0]} ${P.library[1] - 30}`} stroke={SIGNAL} strokeWidth={1.5} fill="none" /> : null}
      {refused ? (
        <g>
          <path d={`M${P.via2[0]} ${P.via2[1]}C${P.via2[0] + 30} ${P.via2[1]} ${P.stop[0] - 10} ${P.stop[1] - 30} ${P.stop[0]} ${P.stop[1] - 20}`} stroke={ROSE} strokeWidth={1.5} fill="none" />
          <path d={`M${P.stop[0] - 12} ${P.stop[1] - 8}h24M${P.stop[0]} ${P.stop[1] - 20}v24`} stroke={ROSE} strokeWidth={1.5} strokeLinecap="round" transform={`rotate(45 ${P.stop[0]} ${P.stop[1] - 4})`} />
          <text className="forge-lbl forge-lbl-refused" x={P.stop[0]} y={P.stop[1] + 32} textAnchor="middle">Refused</text>
        </g>
      ) : null}

      <Station at={P.intake} w={64} h={48} label={DEPTS.intake.name} short="Intake" lit={index >= 1} stroke={index >= 1 ? SIGNAL : DIM}>
        {[0, 1, 2].map((i) => <path key={i} d={`M${P.intake[0] - 20} ${P.intake[1] - 12 + i * 12}h40`} stroke={i < Math.max(1, v.intake.tickets) && index >= 1 ? SIGNAL : DIM} strokeWidth={1.25} strokeLinecap="round" />)}
      </Station>
      <Station at={P.machine} w={112} h={64} label="Local AI room (GB10)" short="GB10" lit stroke={v.machine.power > 0.5 ? SIGNAL : DIM}>
        {[-26, -14].map((dx) => <path key={dx} d={`M${P.machine[0] + dx - 14} ${P.machine[1] - 14}v28`} stroke={DIM} strokeWidth={1.25} strokeLinecap="round" />)}
        <circle cx={P.machine[0] + 22} cy={P.machine[1]} r={9} fill={v.machine.power > 0.5 ? SIGNAL : "none"} stroke={v.machine.power > 0.5 ? SIGNAL : DIM} strokeWidth={1.25} fillOpacity={v.machine.working ? 1 : 0.55} />
      </Station>
      <Station at={P.review} w={84} h={48} label={DEPTS.review.name} short="Review" lit={index >= 2} stroke={waiting ? AMBER : index >= 2 ? "var(--color-text-3)" : DIM}>
        <circle cx={P.review[0]} cy={P.review[1]} r={7} fill={waiting ? AMBER : "none"} stroke={waiting ? AMBER : DIM} strokeWidth={1.25} />
      </Station>
      <Station at={P.verify} w={68} h={48} label={DEPTS.gate.name} short="Check" lit={toVerify} stroke={verifyColour}>
        {v.verify === "passed" ? <path d={`M${P.verify[0] - 10} ${P.verify[1]}l7 7 14 -15`} stroke={GREEN} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {v.verify === "failed" ? <path d={`M${P.verify[0] - 9} ${P.verify[1] - 9}l18 18m0 -18l-18 18`} stroke={ROSE} strokeWidth={2} strokeLinecap="round" /> : null}
        {v.verify === "checking" ? <circle cx={P.verify[0]} cy={P.verify[1]} r={8} fill="none" stroke={SIGNAL} strokeWidth={1.25} strokeDasharray="3 4" /> : null}
      </Station>
      <Station at={P.library} w={116} h={60} label={DEPTS.library.name} short="Library" lit={index >= 3} stroke={libStroke}>
        {[-30, 0, 30].map((dx, i) => <rect key={dx} x={P.library[0] + dx - 11} y={P.library[1] - 16} width={22} height={32} rx={3} fill={i === 1 && stored ? GREEN : "none"} fillOpacity={0.9} stroke={i === 1 && v.artifact ? (stored ? GREEN : SIGNAL) : DIM} strokeWidth={1.25} strokeDasharray={i === 1 && v.artifact && !stored ? "3 3" : undefined} />)}
      </Station>
      {index >= 3 && v.artifact ? (
        <text className="forge-lbl forge-lbl-note" x={P.library[0]} y={P.library[1] + 84} textAnchor="middle">Version pinned at promotion</text>
      ) : null}
    </svg>
  );
}

export function posterVisual(index: number): CineVisual { return visualFor(frameAt(endOfBeat(index))); }
