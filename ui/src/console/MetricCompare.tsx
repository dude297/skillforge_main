import { motion } from "motion/react";
import type { Compare } from "../data/types";
import { SourceBadge } from "../components/SourceBadge";
import { useT } from "../lib/motion";

type Row = Compare["rows"][number];
type Metric = "model_calls" | "tool_calls" | "seconds";

const fmt = (v: number | null, unit = "") => (v == null ? "not measured" : `${v}${unit}`);
const SUB: Record<string, string> = { A: "the agent decides each step", C: "the approved skill runs as fixed code" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One honest sentence from the rows themselves; says "not measured" instead of comparing against a missing number. */
function takeaway(rows: Row[]): { text: string; good: boolean } | null {
  const a = rows.find((r) => r.mode === "A"), c = rows.find((r) => r.mode === "C");
  if (!a || !c) return null;
  if (a.model_calls == null || c.model_calls == null) return { text: "Model calls were not measured in this run, so no model-call comparison is drawn.", good: false };
  return { text: `Handled by the learned skill: ${plural(c.model_calls, "model call")}. The agent with a model used ${a.model_calls}.`, good: c.model_calls < a.model_calls };
}

/** Before/after. Bars only for measured values; null never renders as zero, and a measured zero is drawn as zero. */
export function MetricCompare({ compare }: { compare: Compare }) {
  const tr = useT("major");
  const metrics: { key: Metric; title: string; unit: string }[] = [
    { key: "model_calls", title: "Model calls", unit: "" },
    { key: "tool_calls", title: "Tool calls", unit: "" },
    { key: "seconds", title: compare.secondsLabel ?? "Automated time", unit: " s" },
  ];
  const shown = metrics.filter((m) => m.key !== "tool_calls" || compare.rows.some((r) => r.tool_calls != null));
  const t = takeaway(compare.rows);
  return (
    <section aria-labelledby="cmp-h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cmp-h" className="text-lead font-semibold">Same task, before and after</h2>
        <SourceBadge source={compare.source} />
      </div>
      {t ? <p className={`font-medium ${t.good ? "text-verified" : "text-text-2"}`}>{t.text}</p> : null}
      <p className="text-meta text-text-2">{compare.label}</p>
      {shown.map(({ key, title, unit }) => {
        const max = Math.max(0.001, ...compare.rows.map((r) => r[key] ?? 0));
        return (
          <div key={key} className="space-y-2.5">
            <p className="text-meta font-medium text-text-3">{title}</p>
            {compare.rows.map((r) => {
              const v = r[key];
              return (
                <div key={r.mode} className="space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-text">{r.title}{SUB[r.mode] ? <span className="block text-meta text-text-3">{SUB[r.mode]}</span> : null}</p>
                    <p className={`tnum shrink-0 font-semibold ${v == null ? "text-meta font-normal text-text-3 italic" : r.mode === "C" ? "text-verified" : "text-text"}`}>{fmt(v, unit)}</p>
                  </div>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
                    {v != null ? (
                      <motion.span
                        className={`block h-full origin-left rounded-full ${r.mode === "C" ? "bg-verified" : "bg-text-3"}`}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: v / max }} /* a zero is drawn as zero, never as a token stub */
                        transition={tr}
                      />
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      {compare.source === "synthetic" ? <p className="text-meta text-text-3">Example values only. They do not claim a speed-up: in the recorded mock benchmark, reuse was slower than the agent.</p> : null}
    </section>
  );
}
