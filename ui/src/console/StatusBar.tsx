import type { Source, SystemStatus } from "../data/types";
import { HealthPill } from "../components/HealthPill";
import { SourceBadge } from "../components/SourceBadge";

const SOURCES: { key: Source; label: string; hint: string }[] = [
  { key: "synthetic", label: "Preview", hint: "scripted sample data" },
  { key: "recorded", label: "Recorded", hint: "a real run, replayed from a file" },
  { key: "live", label: "Live", hint: "the GB10, right now" },
];
const UNKNOWN = { ok: null, detail: "no data source connected" };

/** connected=false: the chosen source has nothing to show yet (Live not reachable, no Recorded file loaded). */
export function StatusBar({ source, onSource, status, connected, sources }: { source: Source; onSource: (s: Source) => void; status: SystemStatus | null; connected: boolean; sources?: Source[] }) {
  return (
    <section aria-label="System status" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-2.5 text-meta lg:px-6">
      <SourceBadge source={source} connected={connected} />
      <fieldset className="flex rounded-md border border-line p-0.5">
        <legend className="sr-only">Data source</legend>
        {SOURCES.filter((s) => !sources || sources.includes(s.key)).map((s) => (
          <label key={s.key} title={s.hint}
            className={`inline-flex min-h-11 cursor-pointer items-center rounded px-2.5 py-1 transition-colors md:min-h-0 duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal ${source === s.key ? "bg-surface-2 text-text" : "text-text-3 hover:text-text-2"}`}>
            <input type="radio" name="data-source" value={s.key} checked={source === s.key} onChange={() => onSource(s.key)} className="sr-only" />
            {s.label}<span className="sr-only">: {s.hint}</span>
          </label>
        ))}
      </fieldset>
      <p className="hidden text-text-3 xl:block">Preview is scripted sample data. Recorded replays a real run. Live reads this machine.</p>
      <div className="hidden min-w-0 flex-wrap items-center gap-x-5 gap-y-1 md:flex">
        <HealthPill label="Model" health={status?.inference ?? UNKNOWN} value={status?.inference.model ?? null} />
        <HealthPill label="Sandbox" health={status?.sandbox ?? UNKNOWN} />
        <HealthPill label="Host service" health={status?.host_service ?? UNKNOWN} />
      </div>
    </section>
  );
}
