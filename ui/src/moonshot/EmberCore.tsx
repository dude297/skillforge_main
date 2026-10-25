import { MascotSprite } from "../world/Mascot";
import type { MascotState } from "../world/sprites";
import { pos } from "./layout";

const TONE: Record<MascotState, string> = { idle: "azure", investigating: "azure", building: "gold", verifying: "mint", verified: "mint", waiting: "amber", error: "coral" };
const SPOKEN: Record<MascotState, string> = { idle: "idle", investigating: "investigating", building: "building", verifying: "verifying", verified: "verified", waiting: "waiting for a person", error: "error" };

/** The existing Ember sprite (unmodified) at the central hub, in a halo. The halo tone follows the replay state; Ember is not an authority. */
export function EmberCore({ state, reduce, selected, onSelect, onHover }: { state: MascotState; reduce: boolean; selected: boolean; onSelect: () => void; onHover: (on: boolean, el: Element | null) => void }) {
  const { x, y } = pos("ember");
  return (
    <g className="ms-ember" data-id="ember" data-tone={TONE[state]} data-mascot={state} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`Ember, the SkillForge agent: ${SPOKEN[state]}. Open what I am doing.`}
      onClick={(e) => { e.stopPropagation(); onSelect(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      onPointerEnter={(e) => onHover(true, e.currentTarget)} onPointerLeave={() => onHover(false, null)} onFocus={(e) => onHover(true, e.currentTarget)} onBlur={() => onHover(false, null)}>
      <title>{`Ember: ${SPOKEN[state]}`}</title>
      <defs>
        <radialGradient id="ms-orb" cx="50%" cy="45%" r="60%"><stop offset="0%" stopColor="#1b3a63" stopOpacity="0.95" /><stop offset="70%" stopColor="#0b1a33" stopOpacity="0.9" /><stop offset="100%" stopColor="#060b16" stopOpacity="0.2" /></radialGradient>
      </defs>
      {!reduce ? <circle className="ms-halo-pulse" r={64} /> : null}
      <circle r={74} fill="url(#ms-orb)" />
      <circle className="ms-halo-ring" r={78} />
      <circle className="ms-orb-edge" r={62} fill="none" stroke="#5ccbff" strokeWidth={1.5} strokeOpacity={0.8} />
      {!reduce ? <g className="ms-orbit">{[0, 120, 240].map((a) => <circle key={a} className="ms-particle" r={2.6} cx={Math.cos((a * Math.PI) / 180) * 86} cy={Math.sin((a * Math.PI) / 180) * 86} />)}</g> : null}
      <MascotSprite state={state} x={0} y={34} px={2.6} still={reduce} />
    </g>
  );
}
