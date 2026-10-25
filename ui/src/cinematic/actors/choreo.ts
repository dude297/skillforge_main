// The actors' shared state machine. It turns a CineVisual (discrete truth from the fold) plus the transition progress
// into the continuous quantities the actors draw: where each work item is, how formed, which colour. It owns no truth:
// every status colour is selected here from `visual` and nowhere else.
//
//   amber  <- visual.review === "waiting"          green <- visual.verify === "passed" | artifact phase "stored"
//   rose   <- visual.verify === "failed" | route "refused"        cyan <- everything else the agent does
//
// Time model: discrete state changes are eased with real-time tweens (so any caller can jump between states and the
// picture stays continuous); `visual.progress` scrubs the few motions that belong to one state (the evidence stream,
// the crystal condensing, the packet's journey). Nothing allocates after construction. update() runs once per frame.
import { Color, Vector3 } from "three";
import type { CineVisual } from "../contract";
import { COL, HOVER, Tween, clamp01, damp, easeInOut, easeOut, lerp, smooth } from "./util";
import { ROUTES, routeAt, type RouteId } from "./routes";

export type Phase = "condensing" | "awaiting_person" | "stored";
const ROUTE_IDS: RouteId[] = ["full", "short", "refused", "skill"];

/** per-route hairline state */
export interface TraceState { head: number; tail: number; alpha: number; color: Color }

export class Choreo {
  /** jump to end states: reduced motion, and deterministic frame capture */
  reduced = false;
  now = 0;
  dt = 0;
  v: CineVisual | null = null;
  // `visual` is one object mutated in place by the timeline, so edges are detected against copied primitives
  private pv: { tickets: number; flowing: boolean; verify: CineVisual["verify"] } | null = null;
  private started = false;

  routeId: RouteId = "full";

  // ---- the evidence storm
  stormAlpha = 0;
  stream = new Tween(0); // 0..1 how far the evidence has travelled from intake to the machine
  collapse = new Tween(0); // 0..1 evidence converging into the proposal (or the skill)
  collapseToCrystal = false;
  scan = 0; // 0..1 intensity of the investigation scan
  orbitClock = 0;

  // ---- the proposal lattice (a change, or the skill's proposal on the short path)
  latActive = false;
  latAlpha = 0;
  latRoute: RouteId = "full";
  latU = new Tween(0);
  latForm = 0;
  amber = 0;
  green = 0;
  rose = 0;
  unres = 1;
  private latResolveAt = -1;
  private latDone = false; // this ticket's proposal has been verified and has dissolved: do not draw another for it
  latPos = new Vector3();

  // ---- the short-path / refused packet
  pkActive = false;
  pkAlpha = 0;
  pkU = new Tween(0);
  shatter = new Tween(0);
  pkPos = new Vector3();
  private pkTraveled = false;
  private pkMerged = false; // short path: the packet reached the skill and became its proposal
  pkHeld = false; // waiting at intake, route not decided yet

  // ---- the skill artifact
  phase: Phase | null = null;
  cryAlpha = 0;
  cryForm = 0;
  private cryMaxP = 0;
  cryU = new Tween(0);
  cryScale = new Tween(0.85);
  seal = new Tween(0);
  cryAwait = 0;
  cryGreen = 0;
  cryPos = new Vector3();
  probe = 0;
  private cryArriveAt = -10;

  // ---- marks on the set (review desk glow, verification scan / pass / fail)
  reviewGlow = 0;
  verifyScan = 0; // 0..1 while checking
  verifyPass = 0; // a pulse that decays
  verifyFail = 0;

  // ---- hairline
  trace: Record<RouteId, TraceState> = {
    full: { head: 0, tail: 0, alpha: 0, color: COL.signal.clone() },
    short: { head: 0, tail: 0, alpha: 0, color: COL.signal.clone() },
    refused: { head: 0, tail: 0, alpha: 0, color: COL.signal.clone() },
    skill: { head: 0, tail: 0, alpha: 0, color: COL.signal.clone() },
  };
  private fullHead = 0; // furthest point the full path has been lit
  private implode = new Tween(0); // 0..1 the lit path collapsing into the forming skill

  // ---- the light that comes from the work
  focusPos = new Vector3();
  focusColor = new Color();
  focusLevel = 0;

  private resetItems(now: number) {
    this.stream.set(0); this.collapse.set(0); this.collapseToCrystal = false;
    this.latActive = false; this.latDone = false; this.latAlpha = 0; this.latResolveAt = -1; this.latU.set(0); this.latForm = 0;
    this.amber = 0; this.green = 0; this.rose = 0; this.unres = 1;
    this.pkU.set(0); this.shatter.set(0); this.pkTraveled = false; this.pkMerged = false; this.pkAlpha = 0;
    this.fullHead = 0; this.implode.set(0);
    void now;
  }

  update(v: CineVisual, now: number, dtRaw: number) {
    const fresh = !this.started;
    const prev = this.pv;
    const snap = this.reduced || fresh;
    const dt = Math.min(Math.max(dtRaw, 0), 0.1);
    this.v = v; this.now = now; this.dt = dt;

    const hasArt = !!v.artifact;
    const phase: Phase | null = v.artifact?.phase ?? null;
    const rk = v.route?.kind === "short" || v.route?.kind === "refused" ? v.route.kind : null; // the two routes that skip the AI room
    const p = clamp01(v.progress);
    const inCycle = v.intake.tickets > 0;

    // ---- edges: a new ticket restarts the items; the route is remembered until the next one
    if ((prev && (v.intake.tickets > prev.tickets || (v.intake.flowing && !prev.flowing))) || (fresh && v.intake.flowing)) {
      this.resetItems(now);
      this.routeId = "full";
    }
    if (rk) this.routeId = rk;
    this.phase = phase;

    // ---- the evidence storm
    const heldAtIntake = inCycle && v.intake.flowing && !rk && (v.library.stored > 0 || v.library.drafted > 0);
    const inAI = inCycle && this.routeId === "full" && !rk && (v.intake.converge > 0 || (v.intake.flowing && !heldAtIntake));
    this.stormAlpha = damp(this.stormAlpha, inAI ? 1 : 0, 7, dt);
    if (inAI) {
      if (this.reduced) this.stream.set(1);
      else if (v.intake.converge === 0) this.stream.set(Math.max(this.stream.v, p));
      else this.stream.go(1, now, 0.9, snap);
      this.stream.at(now, easeOut);
      if (v.intake.converge >= 1) this.collapse.go(1, now, 1.4, snap);
      else if (v.intake.converge < 1 && this.collapse.target > 0) this.collapse.go(0, now, 0.7, snap);
    } else if (this.reduced) { this.stream.set(1); }
    this.collapse.at(now, easeInOut);
    this.collapseToCrystal = hasArt && phase === "condensing";
    this.scan = damp(this.scan, inAI ? (v.intake.converge === 0.5 ? 1 : v.intake.converge === 0 ? 0.35 : 0.2) : 0, 4, dt);
    if (!this.reduced) this.orbitClock += dt * (0.55 + 0.9 * this.scan);

    // ---- the packet (short path / refusal)
    const R = ROUTES;
    this.pkHeld = heldAtIntake;
    if (rk === "short" || rk === "refused") {
      const stopU = rk === "short" ? R.short.a.library : R.refused.a.stop;
      this.pkU.go(stopU * easeInOut(this.reduced ? 1 : v.route!.progress), now, fresh || this.reduced ? 0 : 0.18, snap);
    }
    this.pkU.at(now, easeOut);
    if (this.routeId === "short") {
      if (this.pkU.v < R.short.a.library - 0.01) this.pkTraveled = true;
      if (fresh) this.pkMerged = true; // joined mid-cycle: the skill's proposal already exists
    }
    const atStop = this.routeId === "refused" && this.pkU.v >= R.refused.a.stop - 0.004;
    if (this.routeId === "refused") this.shatter.go(atStop ? 1 : 0, now, 1.5, snap);
    this.shatter.at(now, easeOut);
    const justMerged = this.routeId === "short" && !this.pkMerged && this.pkTraveled && this.pkU.v >= R.short.a.library - 0.004;
    if (justMerged) this.pkMerged = true;
    const pkWanted = heldAtIntake || this.routeId === "refused" || (this.routeId === "short" && !this.pkMerged);
    this.pkAlpha = snap ? (pkWanted ? 1 : 0) : damp(this.pkAlpha, pkWanted ? 1 : 0, pkWanted ? 10 : 7, dt);

    // ---- the proposal lattice
    const atReview = v.review === "waiting" || v.review === "decided";
    const gateBusy = v.verify === "checking" || v.verify === "failed";
    if (fresh && v.verify === "passed") this.latDone = true; // joined after a verified outcome: nothing to dissolve
    if (hasArt) { if (this.latActive) this.latActive = false; } // the skill took over the stage
    else if (!this.latDone) {
      const formedFull = this.routeId === "full" && v.intake.converge >= 1 && !rk;
      if (formedFull) this.activateLattice("full");
      else if (this.routeId === "short" && (justMerged || (this.pkMerged && (v.review === "waiting" || gateBusy)))) this.activateLattice("short");
      else if (v.review === "waiting" || gateBusy) this.activateLattice(this.routeId === "short" ? "short" : "full");
    }
    // a verified outcome: resolve, then let the proposal dissolve into the gate
    if (this.latActive && prev && prev.verify !== "passed" && v.verify === "passed") this.latResolveAt = now;
    if (this.latResolveAt >= 0 && now - this.latResolveAt > 1.6) { this.latActive = false; this.latDone = true; this.latResolveAt = -1; }
    const resolving = this.latActive && this.latResolveAt >= 0;
    this.latAlpha = snap ? (this.latActive ? 1 : 0) : damp(this.latAlpha, this.latActive ? (resolving && now - this.latResolveAt > 0.8 ? 0 : 1) : 0, this.latActive ? 5 : 4, dt);
    const sa = this.latRoute === "short" ? R.short.a : R.full.a;
    const latTarget = v.verify === "checking" || v.verify === "failed" || resolving ? sa.verify : atReview ? sa.review : this.latRoute === "short" ? R.short.a.library : R.full.a.machine;
    this.latU.go(latTarget, now, 1.9, snap);
    this.latU.at(now, easeInOut);
    this.latForm = this.latRoute === "full" && !this.reduced ? smooth(0.5, 1, this.collapse.v) : damp(this.latForm, this.latActive ? 1 : 0, 3, dt);
    if (snap && this.latActive) this.latForm = 1;
    this.amber = damp(this.amber, this.latActive && v.review === "waiting" ? 1 : 0, 4.5, dt);
    this.green = damp(this.green, resolving && v.verify === "passed" ? 1 : 0, 5, dt);
    this.rose = damp(this.rose, this.latActive && v.verify === "failed" ? 1 : 0, 5, dt);
    this.unres = damp(this.unres, v.verify === "failed" ? 1.6 : resolving ? 0 : 1, 3.5, dt);
    routeAt(R[this.latRoute], this.latU.v, this.latPos);
    routeAt(R[this.routeId === "refused" ? "refused" : "short"], this.pkU.v, this.pkPos);

    // ---- the skill artifact
    if (phase) {
      this.cryMaxP = phase === "condensing" ? Math.max(this.cryMaxP, p) : 1;
      const fTarget = this.reduced ? 1 : phase === "condensing" ? this.cryMaxP : 1;
      this.cryForm = snap ? fTarget : damp(this.cryForm, fTarget, 7, dt);
      if (fresh && phase !== "condensing") this.cryForm = 1;
    } else {
      this.cryMaxP = 0; this.cryForm = damp(this.cryForm, 0, 6, dt);
    }
    this.cryAlpha = damp(this.cryAlpha, phase ? 1 : 0, 6, dt);
    if (snap) this.cryAlpha = phase ? 1 : 0;
    const A = R.skill.a;
    const cu = phase === "stored" ? A.library : A.hero; // condenses and waits at the hero point; seats in the library once stored
    this.cryU.go(cu, now, 2.0, snap);
    this.cryU.at(now, easeInOut);
    if (phase === "stored" && this.cryU.v >= A.library - 0.004 && this.cryArriveAt < 0) this.cryArriveAt = now;
    if (phase !== "stored") this.cryArriveAt = -10;
    this.cryScale.go(phase === "stored" ? 0.62 : 0.85, now, 2.0, snap);
    this.cryScale.at(now, easeInOut);
    this.seal.go(phase === "stored" ? 1 : 0, now, 1.2, snap);
    this.seal.at(now, easeOut);
    this.cryAwait = damp(this.cryAwait, phase === "awaiting_person" && v.review === "waiting" ? 1 : 0, 5, dt);
    this.cryGreen = damp(this.cryGreen, phase === "stored" ? 1 : 0, 3.5, dt);
    if (snap) { this.cryAwait = phase === "awaiting_person" && v.review === "waiting" ? 1 : 0; this.cryGreen = phase === "stored" ? 1 : 0; }
    routeAt(R.skill, this.cryU.v, this.cryPos);
    this.probe = damp(this.probe, hasArt && phase === "condensing" && v.verify === "checking" ? 1 : 0, 6, dt);

    // ---- marks on the set
    this.reviewGlow = damp(this.reviewGlow, v.review === "waiting" ? 1 : 0, 4, dt);
    this.verifyScan = damp(this.verifyScan, v.verify === "checking" ? 1 : 0, 6, dt);
    if (prev && prev.verify !== "passed" && v.verify === "passed" && !this.reduced) this.verifyPass = 1;
    this.verifyPass = damp(this.verifyPass, 0, 1.1, dt);
    this.verifyFail = damp(this.verifyFail, v.verify === "failed" ? 1 : 0, 5, dt);

    // ---- the hairline: it follows whatever the work currently is
    this.updateTrace(v, dt, hasArt, phase);
    this.updateFocus(v);

    this.pv = { tickets: v.intake.tickets, flowing: v.intake.flowing, verify: v.verify };
    this.started = true;
  }

  private activateLattice(route: RouteId) {
    if (this.latActive) return;
    this.latActive = true; this.latRoute = route; this.latResolveAt = -1;
    this.latU.set(route === "short" ? ROUTES.short.a.library : ROUTES.full.a.machine);
  }

  private updateTrace(v: CineVisual, dt: number, hasArt: boolean, phase: Phase | null) {
    const T = this.trace, R = ROUTES;
    // full path: lit up to the evidence front, then the forming proposal, then the proposal itself
    if (this.routeId === "full") {
      const a = R.full.a;
      let h = lerp(0, a.approach, this.stream.v);
      h = lerp(h, a.machine, this.collapse.v);
      if (this.latActive && this.latRoute === "full") h = this.latU.v;
      this.fullHead = Math.max(this.fullHead, this.stormAlpha > 0.02 || this.latActive ? h : 0);
    }
    // once a skill is forming, the lit path collapses into it: head and tail meet at the machine
    this.implode.go(hasArt ? 1 : this.implode.target, this.now, 1.7, this.reduced);
    const k = this.implode.at(this.now, easeInOut);
    const full = T.full;
    full.head = this.routeId === "full" || this.fullHead > 0 ? lerp(this.fullHead, Math.min(this.fullHead, R.full.a.machine), k) : 0;
    full.tail = lerp(0, Math.min(this.fullHead, R.full.a.machine), k);

    const sh = T.short;
    sh.head = this.routeId === "short" ? (this.latActive && this.latRoute === "short" ? this.latU.v : this.pkU.v) : 0;
    sh.tail = 0;
    const rf = T.refused;
    rf.head = this.routeId === "refused" ? this.pkU.v : 0;
    rf.tail = 0;
    const sk = T.skill;
    sk.head = phase && phase !== "condensing" ? this.cryU.v : 0;
    sk.tail = 0;
    const skillLit = phase === "awaiting_person" || (phase === "stored" && (this.cryArriveAt < 0 || this.now - this.cryArriveAt < 2.2));

    const lit = (t: TraceState) => t.head - t.tail > 0.004;
    full.alpha = damp(full.alpha, lit(full) ? 1 : 0, 5, dt);
    sh.alpha = damp(sh.alpha, lit(sh) ? 1 : 0, 5, dt);
    rf.alpha = damp(rf.alpha, lit(rf) ? 1 : 0, 5, dt);
    sk.alpha = damp(sk.alpha, lit(sk) && skillLit ? 1 : 0, skillLit ? 5 : 1.6, dt);

    // head colours: only the semantic ones, each from its own fold field
    const waiting = v.review === "waiting";
    const lc = (d: Color, c: Color) => { d.r = damp(d.r, c.r, 6, dt); d.g = damp(d.g, c.g, 6, dt); d.b = damp(d.b, c.b, 6, dt); };
    const latCol = this.rose > 0.5 ? COL.fail : this.green > 0.5 ? COL.verified : waiting && this.latActive ? COL.warn : COL.signal;
    lc(full.color, this.latRoute === "full" ? latCol : COL.signal);
    lc(sh.color, this.latRoute === "short" && this.latActive ? latCol : COL.signal);
    lc(rf.color, COL.fail);
    lc(sk.color, phase === "stored" ? COL.verified : phase === "awaiting_person" && waiting ? COL.warn : COL.signal);
  }

  private updateFocus(v: CineVisual) {
    // the key light follows the most important thing on stage
    let level = 0;
    const set = (pos: Vector3, c: Color, l: number) => { this.focusPos.copy(pos); this.focusColor.copy(c); level = l; };
    if (this.cryAlpha > 0.3) set(this.cryPos, this.cryGreen > 0.5 ? COL.verified : this.cryAwait > 0.5 ? COL.warn : COL.signal, this.cryAlpha * (0.4 + 0.6 * this.cryForm));
    else if (this.latAlpha > 0.1) set(this.latPos, this.rose > 0.5 ? COL.fail : this.green > 0.5 ? COL.verified : this.amber > 0.5 ? COL.warn : COL.signal, this.latAlpha * this.latForm);
    else if (this.pkAlpha > 0.1 && this.routeId !== "full") set(this.pkPos, this.routeId === "refused" ? COL.fail : COL.signal, this.pkAlpha * 0.6);
    else if (this.stormAlpha > 0.1) set(HOVER.orbit, COL.signal, this.stormAlpha * 0.45);
    this.focusLevel = damp(this.focusLevel, level, 6, this.dt);
    void v;
  }
}

/** keep the lint happy about unused imports in tree-shaken builds */
export const ALL_ROUTES = ROUTE_IDS;
