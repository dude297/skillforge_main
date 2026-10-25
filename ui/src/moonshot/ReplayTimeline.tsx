import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { beatIndex, type BeatId, type MoonshotGraph } from "./types";

interface Props { graph: MoonshotGraph; beat: BeatId; playing: boolean; stopped: boolean; onBeat: (b: BeatId) => void; onPlay: () => void; onPause: () => void; onReplay: () => void }

/** Bootstrap -> Explore -> Propose -> Test -> Await approval -> Reuse / Refuse. Every beat is selectable, steppable and replayable, and says where it comes from. */
export function ReplayTimeline({ graph, beat, playing, stopped, onBeat, onPlay, onPause, onReplay }: Props) {
  const i = beatIndex(beat);
  const info = graph.beats[i];
  const step = (d: number) => { const nx = graph.beats[i + d]; if (nx?.unlocked) onBeat(nx.id); };
  const prev = graph.beats[i - 1], next = graph.beats[i + 1];
  return (
    <nav className="ms-timeline" aria-label="Replay timeline" data-testid="ms-timeline">
      <ol className="ms-beats">
        {graph.beats.map((b, k) => (
          <li key={b.id}>
            <button type="button" className="ms-beat" data-beat={b.id} data-gate={b.gate ? "true" : undefined} aria-current={b.id === beat ? "step" : undefined} aria-disabled={!b.unlocked}
              title={b.lockedReason ?? b.caption} onClick={() => { if (b.unlocked) onBeat(b.id); }}>
              <span className="ms-meta" aria-hidden>{k + 1}</span>{b.title}{b.gate ? " (needs a person)" : ""}
            </button>
          </li>
        ))}
      </ol>
      <div className="ms-ctl">
        <button type="button" className="ms-btn" onClick={() => step(-1)} disabled={!prev?.unlocked}><ChevronLeft size={16} aria-hidden /> Back</button>
        {playing ? <button type="button" className="ms-btn" onClick={onPause}><Pause size={16} aria-hidden /> Pause</button>
          : <button type="button" className="ms-btn" onClick={onPlay} disabled={stopped || !next?.unlocked} title={stopped ? "Autoplay stops at a pending approval" : undefined}><Play size={16} aria-hidden /> Play</button>}
        <button type="button" className="ms-btn" onClick={() => step(1)} disabled={!next?.unlocked}>{stopped ? "Continue replay (not an approval)" : "Next"} <ChevronRight size={16} aria-hidden /></button>
        <button type="button" className="ms-btn" onClick={onReplay}><RotateCcw size={16} aria-hidden /> Replay</button>
        <span className="ms-chip" data-mode={graph.modeLabel} data-testid="ms-chip-timeline">{graph.modeLabel}</span>
      </div>
      <p className="ms-cap" role="status" data-testid="ms-caption">
        <b>{info?.title}.</b> {info?.caption}
        {stopped ? <> <b data-testid="ms-stopped">Autoplay stopped: a pending approval needs a person on the host. Stepping forward only replays the recording.</b></> : null}
      </p>
      <p className="ms-src">Beat source: {info?.source}{next && !next.unlocked ? ` · next beat ${next.lockedReason ?? "locked"}` : ""}</p>
    </nav>
  );
}
