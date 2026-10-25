// Skip, play/pause, replay and the progress rail. The rail is the trace motif: one luminous hairline that follows the film
// (and, later, the work in the product). Each segment is a real button so the film is navigable by keyboard and touch.
import { Pause, Play, RotateCcw, SkipForward, StepBack, StepForward } from "lucide-react";
import { BEAT_ORDER } from "../contract";
import type { Clock, ClockStatus } from "../timeline/clock";
import { BEAT_MS, BEAT_START, BEAT_TITLE } from "../timeline/sequence";

export type Trace = "signal" | "warn" | "fail";

export function Controls({ clock, status, traces, skipLabel }: { clock: Clock; status: ClockStatus; traces: Trace[]; skipLabel: string }) {
  const { playing, ended, stepped, beatIndex } = status;
  const atStart = beatIndex === 0;
  return (
    <>
      {!ended ? (
        <button type="button" className="forge-btn forge-skip" onClick={() => clock.skip()} aria-keyshortcuts="Escape" title="Skip (Esc)">
          <SkipForward size={16} aria-hidden="true" />
          {skipLabel}
        </button>
      ) : null}

      <div className="forge-bar" role="group" aria-label="Playback">
        {stepped ? (
          <>
            <button type="button" className="forge-btn" onClick={() => clock.jump(-1)} disabled={atStart} aria-keyshortcuts="ArrowLeft"><StepBack size={16} aria-hidden="true" />Back</button>
            <button type="button" className="forge-btn" onClick={() => clock.jump(1)} disabled={ended} aria-keyshortcuts="ArrowRight"><StepForward size={16} aria-hidden="true" />Next</button>
          </>
        ) : !ended ? (
          <button type="button" className="forge-btn" onClick={() => clock.toggle()} aria-keyshortcuts="Space" title={playing ? "Pause (Space)" : "Play (Space)"}>
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {playing ? "Pause" : "Play"}
          </button>
        ) : null}
        <button type="button" className="forge-btn" onClick={() => clock.replay()}>
          <RotateCcw size={16} aria-hidden="true" />
          Replay
        </button>
        <span className="forge-beat-label" aria-hidden="true">{BEAT_TITLE[BEAT_ORDER[beatIndex]]}</span>
      </div>

      <div className="forge-rail" role="group" aria-label="Sequence">
        {BEAT_ORDER.map((b, i) => (
          <button
            key={b}
            type="button"
            className="forge-seg"
            data-trace={traces[i]}
            tabIndex={i === beatIndex ? 0 : -1}
            onClick={() => clock.goto(i)}
            aria-label={`${BEAT_TITLE[b]}, ${i + 1} of ${BEAT_ORDER.length}`}
            aria-current={i === beatIndex ? "step" : undefined}
            style={{ ["--w" as string]: BEAT_MS[b], ["--s" as string]: BEAT_START[b], ["--d" as string]: BEAT_MS[b] }}
          >
            <span className="forge-seg-fill" />
            <span className="forge-seg-head" />
          </button>
        ))}
      </div>
    </>
  );
}
