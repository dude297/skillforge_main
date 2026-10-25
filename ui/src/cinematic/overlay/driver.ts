// Imperative bridge from the clock to the DOM. The overlay never re-renders per frame: this writes a handful of CSS custom
// properties on the root element (about 30 times a second) and the stylesheet (forge.css) turns them into clip-path
// wipes and the progress rail. Every value is a pure function of the timeline moment, so seeking, pausing and stepping
// all land on exactly the same picture as playing through.
import { BEAT_END, BEAT_MS, BEAT_START, TOTAL_MS } from "../timeline/sequence";
import { BEAT_ORDER } from "../contract";
import { ease, ramp } from "../timeline/ease";
import type { Clock } from "../timeline/clock";
import { frameAt } from "../timeline/frame";

const S = BEAT_START, E = BEAT_END;
const IN = 640, OUT = 340, STAGGER = 130;

/** [startMs, durMs] windows on the timeline. Placed against the beats: A's line lands as the push-in settles, D's as the artifact travels to the library. */
const W = {
  a: { at: S.awaken + 660, out: E.awaken + 140 },
  d: { at: S.forge + 0.46 * BEAT_MS.forge, out: E.forge + 300 },
  enter: { at: S.enter + 160 },
};

export function attachDriver(clock: Clock, el: HTMLElement): () => void {
  let lastT = -1e9, lastWrite = 0;
  const set = (k: string, v: number) => el.style.setProperty(k, v.toFixed(4));
  const write = (t: number) => {
    set("--t", t);
    set("--a1-in", ramp(t, W.a.at, IN));
    set("--a2-in", ramp(t, W.a.at + STAGGER, IN));
    set("--a-out", ramp(t, W.a.out, OUT, ease.standard));
    set("--d1-in", ramp(t, W.d.at, IN));
    set("--d2-in", ramp(t, W.d.at + STAGGER, IN));
    set("--d-out", ramp(t, W.d.out, OUT, ease.standard));
    set("--en-title", ramp(t, W.enter.at, IN));
    set("--en-1", ramp(t, W.enter.at + 360, 520));
    set("--en-2", ramp(t, W.enter.at + 360 + STAGGER, 520));
    set("--en-3", ramp(t, W.enter.at + 360 + 2 * STAGGER, 520));
    // The newest caption wipes in when its event begins. When a beat has told nothing yet, the previous caption wipes out
    // over its first moments (and stays gone); the note wipes in once per beat.
    const f = frameAt(t);
    set("--cap-in", f.here > 0 ? ramp(t, f.eventT0 + 40, 460) : 1);
    set("--cap-out", f.here > 0 ? 0 : ramp(t, S[BEAT_ORDER[f.index]], 300, ease.standard));
    set("--note-in", ramp(t, S[BEAT_ORDER[f.index]] + 360, 520));
  };
  const on = (t: number) => {
    const now = performance.now();
    if (Math.abs(t - lastT) < 120 && now - lastWrite < 32 && t < TOTAL_MS) return; // throttle the steady stream; always write seeks and the last frame
    lastT = t; lastWrite = now;
    write(t);
  };
  write(clock.t);
  return clock.onFrame(on);
}
