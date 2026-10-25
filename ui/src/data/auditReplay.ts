// RECORDED replay: turns a real audit export (`python3 -m app audit > run.json`) into timeline steps.
import type { Step } from "./types";
import { toStep, type AuditEvent } from "./events";

export function parseAudit(text: string): Step[] {
  const j = JSON.parse(text) as { events?: AuditEvent[] };
  if (!Array.isArray(j.events)) throw new Error("not an audit export (expected {events: [...]} from `python3 -m app audit`)");
  return j.events.map(toStep);
}
