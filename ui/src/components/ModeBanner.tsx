import { Bot, Clapperboard, Cog, Unplug } from "lucide-react";
import { modelWrote, type DemoMode, type OnCallOrigin, type OnCallRun } from "../data/oncall";

const TONE: Record<DemoMode, { cls: string; Icon: typeof Bot }> = {
  "LIVE REAL MODEL": { cls: "border-signal/50 text-signal", Icon: Bot },
  "RECORDED SCRIPTED SIMULATION": { cls: "border-warn/50 text-warn", Icon: Clapperboard },
  "DETERMINISTIC SKILL": { cls: "border-verified/50 text-verified", Icon: Cog },
  UNAVAILABLE: { cls: "border-line-strong text-text-3", Icon: Unplug },
};

/** One sentence that says exactly who did the work on screen and where the data came from. */
export function modeSentence(mode: DemoMode, run: OnCallRun | null, origin: OnCallOrigin | null, missing?: string): string {
  const from = origin === "endpoint" ? "read from this host's operator API" : `replayed from a recorded file${run?.generated_at ? ` captured ${run.generated_at}` : ""}`;
  if (mode === "UNAVAILABLE") return run ? "The reuse step did not run in this recording, so there is nothing deterministic to show." : `No OnCall run could be loaded, so nothing is shown${missing ? ` (${missing})` : ""}.`;
  if (mode === "DETERMINISTIC SKILL") return `The approved skill ran as fixed code: no model, no agent. ${from[0].toUpperCase()}${from.slice(1)}.`;
  if (mode === "LIVE REAL MODEL") return `The local model ${run?.model?.id ?? "(id not recorded)"} wrote the skill code; ${from}.`;
  return `No model ran. ${modelWrote(run) ? "" : "The skill code is a recorded reference, hand-written ahead of time, not model output; "}${from}.`;
}

export function ModeBanner({ mode, sentence }: { mode: DemoMode; sentence: string }) {
  const { cls, Icon } = TONE[mode];
  return (
    <div role="status" data-testid="mode-banner" data-mode={mode} className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-surface px-5 py-2.5 lg:px-10 ${cls}`}>
      <span className="inline-flex items-center gap-2 font-semibold tracking-wide"><Icon aria-hidden size={16} />{mode}</span>
      <span className="text-meta text-text-2">{sentence}</span>
    </div>
  );
}
