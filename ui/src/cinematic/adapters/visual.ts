// SceneState (world/events.ts fold) -> CineVisual. Pure. Every status field below is read from the fold; this file
// decides how to DRAW what the fold says, never what is true.
//
// Rules this file enforces (tests: e2e/cinematic-truth.spec.ts):
//   review   "waiting" only while fold.waiting (a person is needed: a change awaiting approval or a skill awaiting promotion)
//   verify   straight from fold.gate. "passed" only when nothing applied is unverified or failed (the fold's own rule)
//   library  drafted / stored come from the skill effects, nothing else
//   route    "short" only for a library ticket_out with success === true, "refused" for success === false (never the
//            other way round); "full" only while a ticket is between intake and the gates via the AI room
//   artifact "stored" only after a skill_stored effect; "awaiting_person" while drafted; hash is passed through from ctx
//            and is null for an illustration, whatever ctx says. A hash is never synthesised here.
import type { Beat, CineProvenance, CineVisual, SceneState, VizEvent } from "../contract";
import { normalize, sceneState } from "../../world/events";

export interface VisualCtx {
  beat: Beat;
  /** 0..1: how far the transition into the current state has played (see actors/Actors.tsx) */
  progress: number;
  provenance: CineProvenance;
  /** only what the data actually has. Illustration: omit (a hash is never invented). */
  hash?: { value: string | null; kind: "illustration" | "recorded_reference" | "live" };
  /**
   * The events folded into `scene` (optional but recommended: use `visualAt`). With them, state that spans several
   * events stays correct: a skill still being tested keeps `condensing`, and a short-path or refused item keeps its
   * route while its approval and verification play out. Without them only the current event is known.
   */
  events?: VizEvent[];
  /** false when the data records that no model ran (a recorded simulation): the GB10 is then not drawn as "working" */
  modelRan?: boolean;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const has = (e: VizEvent | null | undefined, fx: NonNullable<VizEvent["effects"]>[number]) => !!e?.effects?.includes(fx);
/** the model/agent is writing a skill (no action id) as opposed to proposing a change (always has an action id) */
const isSkillWriting = (e: VizEvent) => e.dept === "server" && e.mascot === "building" && e.action == null;

/** events of the current ticket: everything after the last ticket_in */
function sinceTicketIn(evs: VizEvent[]): VizEvent[] {
  for (let i = evs.length - 1; i >= 0; i--) if (has(evs[i], "ticket_in")) return evs.slice(i + 1);
  return evs;
}

function routeOf(s: SceneState, ctx: VisualCtx, evs: VizEvent[] | undefined): CineVisual["route"] {
  const cur = s.current;
  // 1. a settled library outcome for the current ticket (the item keeps its route while approval/verification play out)
  const closing = evs ? findLibraryOutcome(evs) : cur && has(cur, "ticket_out") && cur.dept === "library" ? cur : null;
  if (closing) {
    const progress = closing === cur ? clamp01(ctx.progress) : 1;
    if (closing.success === true) return { kind: "short", progress };
    if (closing.success === false) return { kind: "refused", progress };
    return null; // an unreported outcome is neither success nor refusal
  }
  // 2. in flight through the AI room (or about to be, when no skill exists to take the short path)
  if (s.tickets > 0 && cur) {
    if (cur.dept === "server" || cur.dept === "review" || cur.dept === "gate") return { kind: "full", progress: clamp01(ctx.progress) };
    if (cur.dept === "intake" && s.stored + s.drafted === 0) return { kind: "full", progress: clamp01(ctx.progress) };
  }
  return null;
}

/** the last library ticket_out of the current ticket, or null if a newer ticket_in came after it / none exists */
function findLibraryOutcome(evs: VizEvent[]): VizEvent | null {
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (has(e, "ticket_in")) return null;
    if (has(e, "ticket_out") && e.dept === "library") return e;
  }
  return null;
}

function converge(s: SceneState, evs: VizEvent[] | undefined): number {
  const cur = s.current;
  if (!cur || s.tickets === 0 || cur.dept === "intake") return 0;
  if (evs) {
    const mine = sinceTicketIn(evs);
    if (mine.some((e) => e.dept === "server" && e.mascot === "building")) return 1; // a fix or a skill is taking shape
    if (mine.some((e) => e.dept === "server" && e.mascot === "investigating")) return 0.5;
    return 0;
  }
  if (cur.dept === "server") return cur.mascot === "investigating" ? 0.5 : 1;
  if (cur.dept === "review" || cur.dept === "gate") return 1;
  return 0;
}

function artifactOf(s: SceneState, ctx: VisualCtx, evs: VizEvent[] | undefined): CineVisual["artifact"] {
  const cur = s.current;
  // an illustration never carries a hash, even if a caller passes one
  const hash = ctx.provenance === "illustration" || ctx.hash?.kind === "illustration" ? null : ctx.hash?.value ?? null;
  const hashKind = ctx.provenance === "illustration" ? "illustration" : ctx.hash?.kind ?? "illustration";
  let writing = !!cur && isSkillWriting(cur);
  if (evs) { // being written or tested persists until the skill is drafted, stored, dropped or fails
    writing = false;
    for (const e of evs) {
      if (isSkillWriting(e)) writing = true;
      if (has(e, "ticket_in") || has(e, "skill_drafted") || has(e, "skill_stored") || has(e, "skill_dropped") || has(e, "reset") || has(e, "verify_failed")) writing = false;
    }
  }
  const phase: "condensing" | "awaiting_person" | "stored" | null =
    s.drafted > 0 ? (cur?.dept === "gate" && cur.mascot === "verifying" ? "condensing" : "awaiting_person")
      : writing ? "condensing"
      : s.stored > 0 ? "stored"
      : null;
  return phase ? { phase, hash, hashKind } : null;
}

export function toVisual(s: SceneState, ctx: VisualCtx): CineVisual {
  const cur = s.current;
  const evs = ctx.events ? normalize(ctx.events) : undefined;
  return {
    provenance: ctx.provenance,
    beat: ctx.beat,
    progress: clamp01(ctx.progress),
    machine: {
      power: ctx.beat === "awaken" ? clamp01(ctx.progress) : 1,
      working: ctx.modelRan !== false && cur?.dept === "server" && (s.mascot === "investigating" || s.mascot === "building"),
    },
    ember: s.mascot,
    intake: { tickets: s.tickets, flowing: has(cur, "ticket_in"), converge: converge(s, evs) },
    review: s.waiting ? "waiting" : has(cur, "approval_done") || has(cur, "skill_stored") || has(cur, "skill_dropped") ? "decided" : "idle",
    verify: s.gate === "pass" ? "passed" : s.gate === "fail" ? "failed" : s.gate === "pending" ? "checking" : "idle",
    library: { drafted: s.drafted, stored: s.stored },
    artifact: artifactOf(s, ctx, evs),
    route: routeOf(s, ctx, evs),
    caption: cur ? { title: cur.title, detail: cur.detail } : null,
  };
}

/** Fold `events` with the authoritative fold and project the result. The usual entry point for callers that hold events. */
export function visualAt(events: VizEvent[], ctx: Omit<VisualCtx, "events">, pendingApprovals = 0): CineVisual {
  return toVisual(sceneState(events, pendingApprovals), { ...ctx, events });
}
