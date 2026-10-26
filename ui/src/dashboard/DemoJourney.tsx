import { ArrowUpRight, Check, ChevronRight, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { Mascot } from "../world/Mascot";
import type { MascotState } from "../world/sprites";
import record from "./gb10-record.display.json";

interface Node { id: string; label: string; x: number; y: number; text: string }
interface Props {
  phase: number | null; playing: boolean; ember: MascotState; activeNode: string | null;
  selected: string | null; nodes: Node[]; live: boolean; connected: boolean;
  name: string; detail: string; onSelect: (id: string | null) => void;
  onStart: () => void; onToggle: () => void; onAdvance: (phase: number) => void;
  onProof: () => void; onTasks: () => void;
}
const STEPS = ["Investigate", "Review & verify", "Remember", "Reuse"];
const POSITIONS: Record<string, [number, number]> = {
  sources: [21, 24], investigate: [69, 17], review: [83, 48], verify: [72, 78], skills: [24, 79], runtime: [14, 51],
};

export default function DemoJourney(props: Props) {
  const { phase, playing, ember, selected, nodes, activeNode, live, connected, name, detail, onSelect, onStart, onToggle, onAdvance, onProof, onTasks } = props;
  const current = phase === null ? -1 : phase < 2 ? 0 : phase < 4 ? 1 : phase === 4 ? 2 : 3;
  const node = nodes.find((n) => n.id === selected);
  const hidden = record.verification.hidden;
  return <>
    <div className="ed-demo-stage">
      <section className="ed-video-map" aria-label="Ember workspace map" data-state={ember}>
        <div className="ed-video-top"><span className="ed-video-label">{live ? connected ? "Local workspace" : "Local system offline" : "Interactive demo"}</span><span>Ember’s living system</span></div>
        <div className="ed-video-graph">
          <svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden>
            <defs><radialGradient id="video-ember-glow"><stop stopColor="#00e2a0" stopOpacity=".25" /><stop offset="1" stopColor="#00e2a0" stopOpacity="0" /></radialGradient></defs>
            <ellipse cx="480" cy="300" rx="340" ry="270" fill="url(#video-ember-glow)" />
            <ellipse className="ed-video-orbit" cx="480" cy="300" rx="345" ry="217" />
            {nodes.map((n) => { const [x, y] = POSITIONS[n.id]; return <path className={activeNode === n.id ? "is-active" : ""} key={n.id} d={`M 480 300 L ${x * 10} ${y * 6}`} />; })}
          </svg>
          {nodes.map((n) => { const [x, y] = POSITIONS[n.id]; return <button key={n.id} className={`ed-video-node ${activeNode === n.id ? "is-active" : ""} ${selected === n.id ? "is-selected" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} aria-pressed={selected === n.id} onClick={() => onSelect(selected === n.id ? null : n.id)}><span className="ed-video-node-ring"><i /></span><span>{n.label}</span></button>; })}
          <div className="ed-video-ember"><Mascot state={ember} px={6} title={`Ember: ${name}`} /><strong>Ember</strong><span>{name}</span></div>
        </div>
        <div className="ed-video-insight"><span className="ed-video-spark">✧</span><p><strong>{node?.label ?? "One verified fix. A lasting capability."}</strong><span>{node?.text ?? "Ember finds the path. You stay in control."}</span></p>{selected ? <button aria-label="Focus Ember" onClick={() => onSelect(null)}>Reset</button> : null}</div>
      </section>
      <aside className="ed-demo-guide" aria-label="Demo progress">
        <div className="ed-demo-guide-top"><span>{live ? "Your workspace" : phase === null ? "Meet your agent" : `Step ${current + 1} of 4`}</span>{!live && phase !== null ? <button aria-label="Restart demo" onClick={onStart}><RotateCcw size={15} /></button> : null}</div>
        <div className="ed-demo-guide-mark">{ember === "waiting" ? <ShieldCheck size={25} /> : <span>✧</span>}</div>
        <h2>{name}</h2><p>{detail}</p>
        {!live && phase === 2 ? <div className="ed-demo-proposal"><span>Example proposal</span><div><span>Concurrent sequences</span><strong><s>1024</s><ChevronRight size={12} />128</strong></div><small>Revert the configuration change.<br />A person reviews before anything is applied.</small></div> : null}
        {!live && (phase === 4 || phase === 6) ? <div className="ed-demo-result"><Check size={17} /><span>{phase === 4 ? "Reusable skill created in the example" : "Compatible example handled without a new model call"}</span></div> : null}
        {!live && phase === 7 ? <div className="ed-demo-refused"><ShieldCheck size={17} /><span>Different fingerprint. No change applied.</span></div> : null}
        {!live ? <div className="ed-demo-actions">
          {phase === null ? <button className="ed-button ed-button-primary ed-full" onClick={onStart}><Play size={15} />Start demo</button>
            : phase === 2 ? <button className="ed-button ed-button-primary ed-full" onClick={() => onAdvance(3)}>Continue demo<ChevronRight size={15} /></button>
            : phase === 4 ? <button className="ed-button ed-button-primary ed-full" onClick={() => onAdvance(5)}>Try skill reuse<ChevronRight size={15} /></button>
            : phase === 6 ? <button className="ed-button ed-button-primary ed-full" onClick={() => onAdvance(7)}>Test a lookalike<ChevronRight size={15} /></button>
            : phase === 7 ? <button className="ed-button ed-button-primary ed-full" onClick={onProof}>Inspect the proof<ArrowUpRight size={15} /></button>
            : <button className="ed-button ed-button-subtle ed-full" onClick={onToggle}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "Pause demo" : "Resume demo"}</button>}
        </div> : <div className="ed-demo-actions"><button className="ed-button ed-button-primary ed-full" onClick={onTasks}>View tasks<ChevronRight size={15} /></button></div>}
        <ol className="ed-demo-steps">{STEPS.map((step, i) => <li key={step} aria-current={i === current ? "step" : undefined} data-state={i < current ? "done" : i === current ? "current" : "next"}><span>{i < current ? <Check size={12} /> : i + 1}</span>{step}</li>)}</ol>
      </aside>
    </div>
    <section className="ed-proof-strip" aria-label="Recorded GB10 evidence"><div><ShieldCheck size={15} /><span>From the recorded GB10 run</span></div><button onClick={onProof}><strong>{hidden.filter((t) => t.pass).length}/{hidden.length}</strong><span>hidden checks passed</span></button><button onClick={onProof}><strong>{record.reuse.model_calls}</strong><span>model calls on reuse</span></button><button onClick={onProof}><strong>Refused</strong><span>the incompatible lookalike</span></button><button className="ed-proof-link" onClick={onProof}>See proof<ArrowUpRight size={14} /></button></section>
  </>;
}
