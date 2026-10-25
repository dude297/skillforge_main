// The film's clock: play / pause / seek / skip / replay. Time lives here as a plain number so nothing re-renders per frame.
// Subscribers: `onFrame` (every tick and every seek; imperative: CSS variables, invalidate()) and `subscribe` (discrete
// changes only: beat, told events, playing, ended; this is what React reads).
import { endOfBeat, locate, startOfBeat, LAST, TOTAL_MS } from "./sequence";
import { frameAt } from "./frame";

export interface ClockStatus {
  playing: boolean;
  ended: boolean;
  beatIndex: number;
  /** told events in total / in the current beat */
  count: number;
  here: number;
  /** stepped = no running time; the visitor advances beat by beat (reduced motion, poster) */
  stepped: boolean;
}

type FrameFn = (t: number) => void;

export class Clock {
  t = 0;
  private want = false; // the visitor's intent: play
  private ended = false;
  private stepped = false;
  private holds = new Set<string>(); // automatic pauses: tab hidden, scrolled away
  private raf = 0;
  private last = 0;
  private frameFns = new Set<FrameFn>();
  private statusFns = new Set<() => void>();
  private snap: ClockStatus = { playing: false, ended: false, beatIndex: 0, count: 0, here: 0, stepped: false };

  constructor(stepped = false) { if (stepped) this.setStepped(true); }

  get status(): ClockStatus { return this.snap; }
  get playing(): boolean { return this.want && !this.ended && !this.stepped; }

  readonly subscribe = (fn: () => void): (() => void) => { this.statusFns.add(fn); return () => { this.statusFns.delete(fn); }; };
  readonly getStatus = (): ClockStatus => this.snap;
  onFrame(fn: FrameFn): () => void { this.frameFns.add(fn); return () => { this.frameFns.delete(fn); }; }

  setStepped(on: boolean): void {
    if (this.stepped === on) return;
    this.stepped = on;
    if (on) { this.want = false; this.t = endOfBeat(locate(this.t).index); this.ended = this.t >= TOTAL_MS; }
    this.sync();
    this.emitFrame();
  }

  play(): void {
    if (this.stepped) return;
    if (this.ended) { this.replay(); return; }
    this.want = true;
    this.sync();
  }
  pause(): void { this.want = false; this.sync(); }
  toggle(): void { if (this.playing) this.pause(); else this.play(); }

  seek(ms: number): void {
    this.t = Math.max(0, Math.min(TOTAL_MS, ms));
    this.ended = this.t >= TOTAL_MS;
    this.sync();
    this.emitFrame();
  }
  /** Jump to the finished state (the last beat, told). Stays there. */
  skip(): void { this.want = false; this.seek(TOTAL_MS); }
  replay(): void {
    this.ended = false;
    this.t = 0;
    this.want = !this.stepped;
    if (this.stepped) this.t = endOfBeat(0);
    this.sync();
    this.emitFrame();
  }
  /** Beat navigation. Running: to the start of the neighbouring beat. Stepped: to the told end of it. */
  jump(dir: 1 | -1): void {
    const i = locate(this.t).index;
    if (this.stepped) { this.seek(endOfBeat(Math.max(0, Math.min(LAST, i + dir)))); return; }
    // running: go back to the start of this beat first if we are well into it
    const target = dir === 1 ? i + 1 : this.t - startOfBeat(i) > 400 ? i : i - 1;
    this.seek(startOfBeat(Math.max(0, Math.min(LAST, target))));
  }
  goto(i: number): void { this.seek(this.stepped ? endOfBeat(i) : startOfBeat(i)); }

  hold(reason: string, on: boolean): void {
    const had = this.holds.size > 0;
    if (on) this.holds.add(reason); else this.holds.delete(reason);
    if (had !== this.holds.size > 0) this.sync();
  }

  /** Recompute the discrete snapshot, start/stop the loop. */
  private sync(): void {
    const running = this.playing && this.holds.size === 0;
    if (running && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
    if (!running && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    const f = frameAt(this.t);
    const s = this.snap;
    const playing = this.playing;
    if (s.playing !== playing || s.ended !== this.ended || s.beatIndex !== f.index || s.count !== f.count || s.here !== f.here || s.stepped !== this.stepped) {
      this.snap = { playing, ended: this.ended, beatIndex: f.index, count: f.count, here: f.here, stepped: this.stepped };
      for (const fn of this.statusFns) fn();
    }
  }

  private emitFrame(): void { for (const fn of this.frameFns) fn(this.t); }

  private tick = (now: number): void => {
    // `raf` stays set while this callback runs, so sync() neither double-schedules nor resets `last`
    const dt = Math.min(100, now - this.last); // a stalled tab or a slow software renderer never skips the film
    this.last = now;
    this.t = Math.min(TOTAL_MS, this.t + dt);
    if (this.t >= TOTAL_MS) { this.ended = true; this.want = false; }
    this.sync(); // clears `raf` itself when we are no longer running
    this.emitFrame();
    if (this.raf) this.raf = requestAnimationFrame(this.tick);
  };

  dispose(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.frameFns.clear(); this.statusFns.clear(); }
}
