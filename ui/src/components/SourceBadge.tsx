import { Radio, Film, FlaskConical } from "lucide-react";
import type { Source } from "../data/types";

const META: Record<Source, { label: string; hint: string; cls: string; Icon: typeof Radio }> = {
  live: { label: "Live", hint: "Read from the host service right now", cls: "text-verified border-verified/40", Icon: Radio },
  recorded: { label: "Recorded run", hint: "Loaded from a real result file; not live", cls: "text-signal border-signal/40", Icon: Film },
  synthetic: { label: "Synthetic preview", hint: "Scripted design preview. Not backend output, not a measurement", cls: "text-warn border-warn/45", Icon: FlaskConical },
};

/** Always visible wherever data is shown: where the numbers come from is never left to inference. */
export function SourceBadge({ source, connected = true }: { source: Source; connected?: boolean }) {
  const meta = META[source];
  const { Icon } = meta;
  // a source that has nothing to show must not look connected (e.g. Live with no reachable API)
  const label = connected ? meta.label : `${meta.label} (${source === "live" ? "not connected" : "no file loaded"})`;
  const hint = connected ? meta.hint : "Nothing from this source is on screen";
  const cls = connected ? meta.cls : "text-text-3 border-line-strong";
  return (
    <span title={hint} className={`inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border px-2 py-0.5 text-meta font-medium ${cls}`}>
      <Icon aria-hidden size={13} strokeWidth={2} />
      {label}
      <span className="sr-only">: {hint}</span>
    </span>
  );
}
