import type { Health } from "../data/types";

const TONE = {
  ok: { dot: "bg-text-2", text: "Healthy" }, // green is reserved for verifier results
  down: { dot: "bg-fail", text: "Down" },
  unknown: { dot: "bg-text-3", text: "Not connected" },
} as const;

export function HealthPill({ label, health, value }: { label: string; health: Health; value?: string | null }) {
  const tone = health.ok === true ? TONE.ok : health.ok === false ? TONE.down : TONE.unknown;
  // the host reports "unknown: <why>" when it didn't check (e.g. no LLM_BASE_URL): say that, not "not connected"
  const text = health.ok == null && health.detail.startsWith("unknown") ? "Not checked" : tone.text;
  return (
    <div className="flex min-w-0 items-center gap-2" title={health.detail}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
      <span className="text-text-3">{label}</span>
      <span className="truncate text-text-2">{value ?? text}</span>
      <span className="sr-only">{text}. {health.detail}</span>
    </div>
  );
}
