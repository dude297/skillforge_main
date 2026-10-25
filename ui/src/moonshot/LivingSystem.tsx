import { useReducedMotion } from "motion/react";
import { Eye } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useOnCall } from "../data/useOnCall";
import { ConnectionInspector } from "./ConnectionInspector";
import { illustrationGraph } from "./fixtures";
import { LivingCanvas } from "./LivingCanvas";
import { emptyGraph, projectOnCallToGraph, resolveAt, stateText } from "./projection";
import { ReplayTimeline } from "./ReplayTimeline";
import { BEATS, beatIndex, type BeatId } from "./types";
import "./moonshot.css";

const DWELL_MS = 3200, INTRO_MS = 3400;
const mq = typeof window !== "undefined" ? window.matchMedia("(max-width: 760px)") : null;
const useNarrow = () => useSyncExternalStore((cb) => { mq?.addEventListener("change", cb); return () => mq?.removeEventListener("change", cb); }, () => mq?.matches ?? false, () => false);

/** Route #/world/moonshot. A read-only projection: GET-only data (the same loader the guided demo uses), no write path of any kind. */
export function LivingSystem() {
  const load = useOnCall();
  const reduce = !!useReducedMotion();
  const narrow = useNarrow();
  const [view, setView] = useState<"run" | "illustration">("run");
  const base = useMemo(() => (load.state === "ok" ? projectOnCallToGraph(load.run, load.origin) : load.state === "missing" ? projectOnCallToGraph(null, null) : emptyGraph("Loading the recorded run.")), [load]);
  const graph = useMemo(() => (view === "illustration" ? illustrationGraph() : base), [view, base]);

  const [introDone, setIntroDone] = useState(false);
  const [userBeat, setBeat] = useState<BeatId | null>(null);
  const [playingRaw, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const lastUnlocked = [...graph.beats].reverse().find((b) => b.unlocked)?.id ?? "bootstrap";
  const beat: BeatId = userBeat ?? (reduce && load.state !== "loading" ? lastUnlocked : "bootstrap");
  const intro = !reduce && !introDone;
  const info = graph.beats[beatIndex(beat)];
  const stopped = info.gate && beat === "approval"; // a pending approval stops autoplay; only a deliberate click continues
  const next = graph.beats[beatIndex(beat) + 1];
  const playing = playingRaw && !stopped && !!next?.unlocked && !intro;

  const endIntro = useCallback(() => { setIntroDone(true); if (!reduce && view === "run" && load.state === "ok") setPlaying(true); }, [reduce, view, load.state]);
  useEffect(() => { if (!intro || load.state === "loading") return; const t = window.setTimeout(endIntro, INTRO_MS); return () => window.clearTimeout(t); }, [intro, load.state, endIntro]);
  useEffect(() => {
    if (!playing || !next) return;
    const t = window.setTimeout(() => setBeat(next.id), DWELL_MS);
    return () => window.clearTimeout(t);
  }, [playing, next]);
  useEffect(() => { const h = () => { if (document.hidden) setPlaying(false); }; document.addEventListener("visibilitychange", h); return () => document.removeEventListener("visibilitychange", h); }, []);

  const closeInspector = useCallback(() => {
    setSelected((s) => { if (s) window.setTimeout(() => document.querySelector<HTMLElement>(`.ms-svg [data-id="${s}"]`)?.focus(), 0); return null; });
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (intro) endIntro(); else if (selected) closeInspector();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [intro, selected, closeInspector, endIntro]);

  const pickFromList = (id: string) => { setSelected(id); if (narrow) document.querySelector(".ms-canvas")?.scrollIntoView({ block: "start" }); };
  const pickBeat =(b: BeatId) => { setPlaying(false); setBeat(b); setIntroDone(true); };
  const replay = () => { setSelected(null); setBeat("bootstrap"); setIntroDone(true); setPlaying(!reduce); };
  const toggleView = () => { setView((v) => (v === "run" ? "illustration" : "run")); setBeat("bootstrap"); setSelected(null); setPlaying(false); setIntroDone(true); };

  const emberState = graph.emberByBeat[beat];
  const listNodes = graph.nodes.map((n) => ({ n, r: resolveAt(n, beat) })).filter((x) => x.r);
  const byId = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const listEdges = graph.edges.map((e) => ({ e, r: resolveAt(e, beat) })).filter((x) => x.r && listNodes.some((y) => y.n.id === x.e.from) && listNodes.some((y) => y.n.id === x.e.to));

  return (
    <main id="main" tabIndex={-1} className="ms-root" data-testid="ms-root" data-mode={graph.mode} data-beat={beat} data-view={view} data-intro={intro ? "true" : "false"}>
      <div className="ms-top">
        <h1 className="ms-title">SkillForge <span>/ Living System</span></h1>
        <span className="ms-chip" data-mode={graph.modeLabel} data-testid="ms-chip" title="Where the data on this page comes from">{graph.modeLabel}</span>
        <span className="ms-meta" data-testid="ms-updated">{graph.lastUpdated ? `Recorded ${graph.lastUpdated} (not live)` : "Last updated: Not measured"}</span>
        <span className="ms-spacer" />
        <button type="button" className="ms-btn" aria-pressed={view === "illustration"} onClick={toggleView} data-testid="ms-illustration-toggle"><Eye size={16} aria-hidden /> {view === "illustration" ? "Back to the recorded run" : "Show example connections (ILLUSTRATION)"}</button>
      </div>
      <p className="ms-banner" role="note" data-testid="ms-banner"><strong>{graph.modeLabel}.</strong> {graph.banner}</p>

      <div className="ms-stage" data-open={selected ? "true" : "false"}>
        <div style={{ position: "relative", minWidth: 0 }}>
          {load.state === "loading" ? <p className="ms-sr" aria-busy="true">Loading the recorded run.</p> : null}
          <LivingCanvas graph={graph} beat={beat} selected={selected} onSelect={setSelected} ember={emberState} narrow={narrow} reduce={reduce} intro={intro} />
          {intro ? (
            <div className="ms-intro" data-testid="ms-intro">
              <h2>Your workspace, mapped locally.</h2>
              <p>{graph.modeLabel}: {graph.mode === "recorded" ? "a recorded run, not a live system." : graph.banner}</p>
              <button type="button" className="ms-btn" onClick={endIntro}>Skip intro</button>
            </div>
          ) : null}
        </div>
        {selected ? <ConnectionInspector graph={graph} beat={beat} selected={selected} onClose={closeInspector} onSelect={setSelected} ember={emberState} /> : null}
      </div>

      <ReplayTimeline graph={graph} beat={beat} playing={playing} stopped={stopped} onBeat={pickBeat} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onReplay={replay} />

      <details className="ms-list" open={narrow}>
        <summary>Nodes and connections as a list ({listNodes.length} nodes, {listEdges.length} connections)</summary>
        <ul aria-label="Nodes">
          {listNodes.map(({ n, r }) => <li key={n.id}><button type="button" data-list={n.id} onClick={() => pickFromList(n.id)}>{n.label}: {stateText(r!)}</button></li>)}
        </ul>
        <ul aria-label="Connections">
          {listEdges.map(({ e, r }) => <li key={e.id}><button type="button" data-list={e.id} onClick={() => pickFromList(e.id)}>{byId.get(e.from)} to {byId.get(e.to)}: {stateText(r!)}</button></li>)}
        </ul>
        <p className="ms-meta">Beats: {BEATS.join(" → ")}. Ember is always at the centre.</p>
      </details>
    </main>
  );
}
