import { motion } from "motion/react";
import type { Geom } from "./layout";
import { StatusGlyph } from "./GraphNode";
import { STATE_TEXT, type MoonshotEdge, type NodeState } from "./types";

const DASHED = new Set<NodeState>(["proposed", "discovered", "unknown", "unavailable", "stale", "refused", "failed", "tested", "approved_simulated"]);
const BEAM = new Set<NodeState>(["tested", "active", "approved", "approved_simulated", "configured"]);

export interface EdgeProps {
  edge: MoonshotEdge; state: NodeState; label: string | null; geom: Geom; fromName: string; toName: string;
  selected: boolean; fresh: boolean; justNow: boolean; reduce: boolean;
  onSelect: (id: string) => void; onHover: (id: string | null, el: Element | null) => void;
}

export function GraphEdge({ edge, state, label, geom, fromName, toName, selected, fresh, justNow, reduce, onSelect, onHover }: EdgeProps) {
  const text = label ?? STATE_TEXT[state];
  const dashed = DASHED.has(state) || edge.kind === "proposed";
  const grow = !reduce && fresh && !dashed;
  return (
    <motion.g
      initial={reduce || !fresh ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
      className="ms-edge" data-id={edge.id} data-kind={edge.kind} data-state={state} data-primary={edge.primary ? "true" : undefined}
      role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`Connection: ${fromName} to ${toName}. ${edge.relation}. Status: ${text}. Source: ${edge.provenance.kind}.`}
      onClick={(e) => { e.stopPropagation(); onSelect(edge.id); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(edge.id); } }}
      onPointerEnter={(e) => onHover(edge.id, e.currentTarget)} onPointerLeave={() => onHover(null, null)}
      onFocus={(e) => onHover(edge.id, e.currentTarget)} onBlur={() => onHover(null, null)}
    >
      <title>{`${fromName} to ${toName}: ${text}`}</title>
      <path className="ms-edge-hit" d={geom.d} />
      {grow ? <motion.path className="ms-edge-line" d={geom.d} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeOut" }} /> : <path className="ms-edge-line" d={geom.d} />}
      {!reduce && justNow && BEAM.has(state) ? <circle className="ms-beam" r={3.5}><animateMotion dur="2.2s" repeatCount="indefinite" path={geom.d} /></circle> : null}
      <g transform={`translate(${geom.mid.x} ${geom.mid.y})`}>
        <circle className="ms-mk-bg" r={11} />
        <StatusGlyph state={state} r={6} />
        {edge.label || selected ? <text className="ms-elabel" x={16} y={4}>{text.length > 34 ? `${text.slice(0, 33)}…` : text}</text> : null}
      </g>
    </motion.g>
  );
}
