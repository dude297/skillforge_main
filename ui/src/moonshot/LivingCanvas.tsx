import { animate, useMotionValue } from "motion/react";
import { Crosshair, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MascotState } from "../world/sprites";
import { EmberCore } from "./EmberCore";
import { GraphEdge } from "./GraphEdge";
import { GraphNode, StatusGlyph } from "./GraphNode";
import { beatCam, edgeGeom, EMBER_CAM, FIT, INTRO_CAM, pos, type Cam } from "./layout";
import { resolveAt, stateText } from "./projection";
import { STATE_TEXT, type BeatId, type MoonshotGraph, type NodeState } from "./types";

const LEGEND: [NodeState, string][] = [["discovered", "Discovered"], ["proposed", "Suggested only"], ["tested", "Tests passed"], ["awaiting_approval", "Awaiting host approval"], ["approved_simulated", "Approved (SIMULATED)"], ["refused", "Refused"]];
const clampCam = (c: Cam): Cam => ({ x: Math.min(1200, Math.max(0, c.x)), y: Math.min(800, Math.max(0, c.y)), z: Math.min(3.4, Math.max(0.45, c.z)) });

export interface CanvasProps {
  graph: MoonshotGraph; beat: BeatId; selected: string | null; onSelect: (id: string | null) => void;
  ember: MascotState; narrow: boolean; reduce: boolean; intro: boolean;
}

export function LivingCanvas({ graph, beat, selected, onSelect, ember, narrow, reduce, intro }: CanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 640 });
  const vb = useMemo(() => { const w = narrow ? 600 : 1200; return { w, h: Math.round((w * size.h) / Math.max(size.w, 1)) }; }, [narrow, size]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setSize({ w: el.clientWidth || 1000, h: el.clientHeight || 640 });
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // camera: three motion values driven imperatively into one SVG transform, so a camera move never re-renders the graph
  const tx = useMotionValue(0), ty = useMotionValue(0), sc = useMotionValue(1);
  const camG = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const upd = () => camG.current?.setAttribute("transform", `translate(${tx.get()} ${ty.get()}) scale(${sc.get()})`);
    upd();
    const off = [tx, ty, sc].map((m) => m.on("change", upd));
    return () => off.forEach((f) => f());
  }, [tx, ty, sc]);
  const camRef = useRef<Cam>(FIT);
  const vbRef = useRef(vb);
  useLayoutEffect(() => { vbRef.current = vb; }, [vb]);
  const fitZ = useCallback(() => Math.min(vbRef.current.w / 1130, vbRef.current.h / 740), []);
  const absCam = useCallback((c: Cam): Cam => (narrow ? c : { ...c, z: c.z * fitZ() }), [narrow, fitZ]);
  const go = useCallback((c0: Cam, instant = false) => {
    const c = clampCam(c0);
    camRef.current = c;
    const v = vbRef.current, to = { x: v.w / 2 - c.x * c.z, y: v.h / 2 - c.y * c.z };
    if (instant || reduce) { tx.set(to.x); ty.set(to.y); sc.set(c.z); return; }
    const o = { duration: 1.05, ease: [0.22, 0.8, 0.2, 1] as [number, number, number, number] };
    animate(tx, to.x, o); animate(ty, to.y, o); animate(sc, c.z, o);
  }, [reduce, tx, ty, sc]);
  const fit = useCallback(() => go({ x: 615, y: 420, z: fitZ() }), [go, fitZ]);

  const firstCam = useRef(true);
  useEffect(() => { go(absCam(intro ? INTRO_CAM : beatCam(beat, narrow)), firstCam.current); firstCam.current = false; }, [beat, narrow, intro, go, absCam]);
  useEffect(() => { const v = vb; const c = camRef.current; const to = { x: v.w / 2 - c.x * c.z, y: v.h / 2 - c.y * c.z }; tx.set(to.x); ty.set(to.y); }, [vb, tx, ty]);

  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph]);
  useEffect(() => {
    if (!selected) return;
    const e = edgeById.get(selected);
    const p = e ? edgeGeom(e).mid : pos(selected);
    go({ x: p.x, y: p.y, z: Math.max(narrow ? 1.1 : 1.5 * fitZ(), Math.min(camRef.current.z, narrow ? 1.8 : 2 * fitZ())) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new selection moves the camera
  }, [selected]);


  const nodes = useMemo(() => graph.nodes.filter((n) => n.id !== "ember").map((n) => ({ n, r: resolveAt(n, beat) })).filter((x) => x.r !== null), [graph, beat]);
  const visible = useMemo(() => new Set(["ember", ...nodes.map((x) => x.n.id)]), [nodes]);
  const nodeName = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.label])), [graph]);
  // the primary edge is drawn last so its hit area wins where other edges cross it
  const edges = useMemo(() => graph.edges.map((e) => ({ e, r: resolveAt(e, beat) })).filter((x) => x.r !== null && visible.has(x.e.from) && visible.has(x.e.to)).sort((a, b) => +!!a.e.primary - +!!b.e.primary), [graph, beat, visible]);

  const drag = useRef<{ x: number; y: number; cam: Cam; moved: boolean } | null>(null);
  const setHoverFor = (id: string | null, el: Element | null) => {
    const host = box.current;
    if (!id || !el || !host) { setHover(null); return; }
    const a = el.getBoundingClientRect(), b = host.getBoundingClientRect();
    setHover({ id, x: Math.min(Math.max(a.left - b.left + a.width / 2, 135), Math.max(b.width - 135, 135)), y: a.bottom - b.top + 8 });
  };

  const hv = hover ? hoverInfo(hover.id) : null;
  function hoverInfo(id: string) {
    if (id === "ember") return { name: "Ember", state: `${ember}`, sum: "The SkillForge agent. Not an authority: click for what it is doing.", src: graph.modeLabel };
    const n = graph.nodes.find((x) => x.id === id);
    if (n) { const r = resolveAt(n, beat); return { name: n.label, state: r ? stateText(r) : "", sum: n.summary, src: n.provenance.kind === "illustration" ? "ILLUSTRATION" : graph.modeLabel }; }
    const e = edgeById.get(id);
    if (e) { const r = resolveAt(e, beat); return { name: `${nodeName.get(e.from)} to ${nodeName.get(e.to)}`, state: r ? stateText(r) : "", sum: e.relation, src: e.provenance.kind === "illustration" ? "ILLUSTRATION" : graph.modeLabel }; }
    return null;
  }

  return (
    <div className="ms-canvas" ref={box} data-testid="ms-canvas">
      <svg className="ms-svg" viewBox={`0 0 ${vb.w} ${vb.h}`} role="group" aria-label="Living System graph. Use the list below for a text version." data-beat={beat} data-ember={ember}>
        <rect className="ms-bg-rect" x={0} y={0} width={vb.w} height={vb.h}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, cam: { ...camRef.current }, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 5) return;
            d.moved = true;
            const k = vb.w / size.w / d.cam.z;
            go({ x: d.cam.x - dx * k, y: d.cam.y - dy * k, z: d.cam.z }, true);
          }}
          onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) onSelect(null); }} />
        <g ref={camG}>
          <ellipse className="ms-plinth-glow" cx={600} cy={745} rx={110} ry={22} />
          {edges.map(({ e, r }) => (
            <GraphEdge key={e.id} edge={e} state={r!.state} label={r!.label} geom={edgeGeom(e)} fromName={nodeName.get(e.from) ?? e.from} toName={nodeName.get(e.to) ?? e.to}
              selected={selected === e.id} fresh={e.steps[0].at === beat} justNow={r!.at === beat} reduce={reduce} onSelect={onSelect} onHover={setHoverFor} />
          ))}
          {nodes.map(({ n, r }) => { const p = pos(n.id); return (
            <GraphNode key={n.id} node={n} state={r!.state} label={r!.label} x={p.x} y={p.y} selected={selected === n.id} fresh={n.steps[0].at === beat} reduce={reduce} onSelect={onSelect} onHover={setHoverFor} />
          ); })}
          <EmberCore state={ember} reduce={reduce} selected={selected === "ember"} onSelect={() => onSelect("ember")} onHover={(on, el) => setHoverFor(on ? "ember" : null, el)} />
        </g>
      </svg>

      <div className="ms-tools" role="toolbar" aria-label="Camera">
        <button type="button" className="ms-btn" aria-label="Zoom in" onClick={() => go({ ...camRef.current, z: camRef.current.z * 1.25 })}><ZoomIn size={16} aria-hidden /></button>
        <button type="button" className="ms-btn" aria-label="Zoom out" onClick={() => go({ ...camRef.current, z: camRef.current.z / 1.25 })}><ZoomOut size={16} aria-hidden /></button>
        <button type="button" className="ms-btn" aria-label="Fit to graph" onClick={fit}><Maximize2 size={16} aria-hidden /></button>
        <button type="button" className="ms-btn" aria-label="Focus Ember" onClick={() => go(absCam(EMBER_CAM))}><Crosshair size={16} aria-hidden /></button>
      </div>

      <details className="ms-legend">
        <summary>Legend (shape + text)</summary>
        <ul>{LEGEND.map(([s, t]) => <li key={s}><svg width={18} height={18} viewBox="-10 -10 20 20" aria-hidden style={{ color: "var(--ms-mute)" }}><StatusGlyph state={s} r={6} /></svg>{t}</li>)}</ul>
      </details>

      {hv && hover ? (
        <div className="ms-pop" role="tooltip" data-testid="ms-pop" style={{ left: hover.x, top: hover.y, transform: "translateX(-50%)" }}>
          <b>{hv.name}</b>
          <span className="k">{hv.state || STATE_TEXT.unknown} · {hv.src}</span>
          <div>{hv.sum.length > 150 ? `${hv.sum.slice(0, 149)}…` : hv.sum}</div>
        </div>
      ) : null}
    </div>
  );
}
