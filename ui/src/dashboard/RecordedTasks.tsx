import { ChevronRight, FileText, ShieldCheck, Zap } from "lucide-react";
import record from "./gb10-record.display.json";

export default function RecordedTasks({ query, onOpen }: { query: string; onOpen: () => void }) {
  const rows = [
    { id: record.incident.id, name: "Investigate the serving failure", detail: record.incident.title, result: "Checks passed", icon: FileText },
    { id: record.reuse.incident_id, name: "Reuse the learned fix", detail: "Compatible incident handled on the deterministic skill path", result: "0 model calls", icon: Zap },
    { id: record.refusal.incident_id, name: "Check a similar-looking incident", detail: "Different fingerprint detected; no incompatible fix applied", result: "Refused", icon: ShieldCheck },
  ].filter((r) => `${r.id} ${r.name} ${r.detail}`.toLowerCase().includes(query.toLowerCase()));
  if (!rows.length) return null;
  return <section className="ed-panel ed-recorded-tasks"><div className="ed-panel-heading"><h2>Work that became a skill</h2><span className="ed-tag">Recorded GB10 run</span></div>{rows.map(({ id, name, detail, result, icon: Icon }) => <button className="ed-task-row" key={id} onClick={onOpen}><span className="ed-row-icon"><Icon size={17} /></span><div><strong>{name}</strong><small>{id} · {detail}</small></div><span className="ed-tag">{result}</span><ChevronRight size={15} /></button>)}</section>;
}
