import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CircleX, RefreshCw } from "lucide-react";
import { useT } from "../lib/motion";

const TONES = {
  warn: { cls: "border-warn/40 text-warn", Icon: AlertTriangle },
  fail: { cls: "border-fail/45 text-fail", Icon: CircleX },
  signal: { cls: "border-signal/40 text-signal", Icon: RefreshCw },
} as const;

/** Degraded-state message: says what happened and what still works, in the interface's voice. */
export function Banner({ banner }: { banner: { tone: keyof typeof TONES; text: string } | null }) {
  const tr = useT("panel");
  return (
    <AnimatePresence initial={false}>
      {banner ? (
        <motion.div
          key={banner.text}
          role={banner.tone === "fail" ? "alert" : "status"}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={tr}
          className={`flex items-start gap-3 rounded-[var(--radius-panel)] border bg-surface px-4 py-3 ${TONES[banner.tone].cls}`}
        >
          {(() => {
            const Icon = TONES[banner.tone].Icon;
            return <Icon aria-hidden size={18} className="mt-0.5 shrink-0" />;
          })()}
          <p className="text-text">{banner.text}</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
