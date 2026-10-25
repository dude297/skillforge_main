import { motion } from "motion/react";
import { Ban, Boxes, Cpu, FileText, GitBranch, Hand, Network, Route, ShieldCheck, Siren, Sparkles } from "lucide-react";
import type { ComponentType } from "react";
import { NODE_H, NODE_W } from "./layout";
import { STATE_TEXT, type MoonshotNode, type NodeKind, type NodeState } from "./types";

const ICON: Record<NodeKind, ComponentType<{ size?: number; x?: number; y?: number; className?: string }>> = {
  ember: Sparkles, bootstrap: Cpu, source: FileText, service: Network, incident: Siren, workflow: Route, skill: Boxes,
  verifier: ShieldCheck, human_gate: Hand, router: GitBranch, refusal: Ban,
};

/** A shape for every state, so status is never colour alone. Drawn around (0,0) at radius r. */
export function StatusGlyph({ state, r = 7 }: { state: NodeState; r?: number }) {
  const s = r * 0.55;
  switch (state) {
    case "discovered": return <circle r={r} fill="none" stroke="currentColor" strokeWidth={1.6} />;
    case "configured": return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.6} /><path d={`M0 ${-r} A${r} ${r} 0 0 1 0 ${r} Z`} fill="currentColor" /></g>;
    case "active": return <circle r={r} fill="currentColor" />;
    case "proposed": return <path d={`M0 ${-r - 1} L${r + 1} 0 L0 ${r + 1} L${-r - 1} 0 Z`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="3 2" />;
    case "testing": return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.6} /><circle r={2.2} fill="currentColor" /></g>;
    case "tested": case "verified": return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.8} /><path d={`M${-s} 0 L${-s / 3} ${s * 0.8} L${s} ${-s * 0.7}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></g>;
    case "approved": return <g><circle r={r} fill="currentColor" /><path d={`M${-s} 0 L${-s / 3} ${s * 0.8} L${s} ${-s * 0.7}`} fill="none" stroke="#06101f" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></g>;
    case "approved_simulated": return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.8} strokeDasharray="3 2" /><path d={`M${-s} 0 L${-s / 3} ${s * 0.8} L${s} ${-s * 0.7}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></g>;
    case "awaiting_approval": return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.8} /><rect x={-3} y={-3.5} width={2.2} height={7} fill="currentColor" /><rect x={0.9} y={-3.5} width={2.2} height={7} fill="currentColor" /></g>;
    case "refused": case "failed": return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.8} /><path d={`M${-s * 0.8} ${-s * 0.8} L${s * 0.8} ${s * 0.8} M${s * 0.8} ${-s * 0.8} L${-s * 0.8} ${s * 0.8}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></g>;
    case "applied_unverified": return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.6} /><path d={`M0 ${-s} V0 L${s * 0.8} ${s * 0.6}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" /></g>;
    default: return <g><circle r={r} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="2 2" /><path d={`M${-s} ${s} L${s} ${-s}`} stroke="currentColor" strokeWidth={1.6} /></g>;
  }
}

export interface NodeProps {
  node: MoonshotNode; state: NodeState; label: string | null; x: number; y: number; selected: boolean; fresh: boolean; reduce: boolean;
  onSelect: (id: string) => void; onHover: (id: string | null, el: Element | null) => void;
}

export function GraphNode({ node, state, label, x, y, selected, fresh, reduce, onSelect, onHover }: NodeProps) {
  const Icon = ICON[node.kind];
  const text = label ?? STATE_TEXT[state];
  const name = node.label;
  return (
    <g transform={`translate(${x} ${y})`}>
      <motion.g
        initial={reduce || !fresh ? false : { opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="ms-node" data-id={node.id} data-kind={node.kind} data-state={state} role="button" tabIndex={0} aria-pressed={selected}
        aria-label={`${name}${node.sublabel ? `, ${node.sublabel}` : ""}. Status: ${text}. Source: ${node.provenance.kind}.`}
        onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(node.id); } }}
        onPointerEnter={(e) => onHover(node.id, e.currentTarget)} onPointerLeave={() => onHover(null, null)}
        onFocus={(e) => onHover(node.id, e.currentTarget)} onBlur={() => onHover(null, null)}
      >
        <title>{`${name}: ${text}`}</title>
        <rect className="ms-box" x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx={12} />
        <Icon size={16} x={-NODE_W / 2 + 9} y={-NODE_H / 2 + 7} className="ms-icon" />
        <text className="ms-name" x={-NODE_W / 2 + 30} y={-NODE_H / 2 + 20}>{name.length > 19 ? `${name.slice(0, 18)}…` : name}</text>
        {node.sublabel ? <text className="ms-sub" x={-NODE_W / 2 + 30} y={-NODE_H / 2 + 31}>{node.sublabel.length > 24 ? `${node.sublabel.slice(0, 23)}…` : node.sublabel}</text> : null}
        <g transform={`translate(${NODE_W / 2 - 13} ${-NODE_H / 2 + 13})`}><StatusGlyph state={state} r={6} /></g>
        <text className="ms-st" x={-NODE_W / 2 + 10} y={NODE_H / 2 + 14}>{text.length > 26 ? `${text.slice(0, 25)}…` : text}</text>
      </motion.g>
    </g>
  );
}
