import { motion } from "motion/react";
import type { Compare } from "../data/types";
import { SourceBadge } from "../components/SourceBadge";
import { useT } from "../lib/motion";

const fmt = (v: number | null, unit = "") => (v == null ? "not measured" : `${v}${unit}`);

/** Before/after. Bars only for measured values; null never renders as zero. */
export function MetricCompare({ compare }: { compare: Compare }) {
  const tr = useT("major");
  const maxCalls = Math.max(1, ...compare.rows.map((r) => r.model_calls ?? 0));
  const maxSec = Math.max(0.001, ...compare.rows.map((r) => r.seconds ?? 0));
  return (
    <section aria-labelledby="cmp-h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cmp-h" className="text-lead font-semibold">Same task, before and after</h2>
        <SourceBadge source={compare.source} />
      </div>
      <p className="text-meta text-text-2">{compare.label}</p>
      {(["model_calls", "seconds"] as const).map((metric) => (
        <div key={metric} className="space-y-2">
          <p className="text-meta text-text-3">{metric === "model_calls" ? "Model calls" : compare.secondsLabel ?? "Automated time"}</p>
          {compare.rows.map((r) => {
            const v = r[metric];
            const pct = v == null ? 0 : (v / (metric === "model_calls" ? maxCalls : maxSec)) * 100;
            return (
              <div key={r.mode} className="grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-3">
                <span className="truncate text-meta text-text-2">{r.title}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  {v != null ? (
                    <motion.span
                      className={`block h-full origin-left rounded-full ${r.mode === "C" ? "bg-verified" : "bg-text-3"}`}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: pct / 100 }} /* a zero is drawn as zero, never as a token stub */
                      transition={tr}
                    />
                  ) : null}
                </span>
                <span className="tnum text-right text-meta font-medium text-text">{fmt(v, metric === "seconds" ? " s" : "")}</span>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
