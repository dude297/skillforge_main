import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner } from "../components/Banner";
import { LayoutGrid, Search, Boxes, History as HistoryIcon, Gauge, ServerCog, Unplug, KeyRound } from "lucide-react";
import type { ProductConfig } from "../config/product";
import type { Source } from "../data/types";
import { SYNTHETIC_STATUS, useSyntheticRun } from "../data/synthetic";
import type { Recorded } from "../data/recorded";
import { live, type LiveEvent } from "../data/live";
import type { Step } from "../data/types";
import { useLive } from "../data/useLive";
import { toStep } from "../data/events";
import { HISTORY, SKILLS } from "../data/registry";
import { historyRuns, skillEntries } from "../data/liveMap";
import { StatusBar } from "./StatusBar";
import { Overview } from "./sections/Overview";
import { Investigations } from "./sections/Investigations";
import { LiveInvestigations } from "./live/LiveInvestigations";
import { Skills } from "./sections/Skills";
import { History } from "./sections/History";
import { Benchmarks } from "./sections/Benchmarks";
import { System } from "./sections/System";
import { IncidentView } from "./sections/IncidentView";
import { PREVIEW } from "../lib/preview";

export type SyntheticRun = ReturnType<typeof useSyntheticRun>;
export type Section = "overview" | "investigations" | "skills" | "history" | "benchmarks" | "system";

const NAV: { key: Section; label: (p: ProductConfig) => string; Icon: typeof LayoutGrid }[] = [
  { key: "overview", label: () => "Overview", Icon: LayoutGrid },
  { key: "investigations", label: (p) => p.terms.tasks, Icon: Search },
  { key: "skills", label: () => "Skills", Icon: Boxes },
  { key: "history", label: () => "History", Icon: HistoryIcon },
  { key: "benchmarks", label: () => "Benchmarks", Icon: Gauge },
  { key: "system", label: () => "System", Icon: ServerCog },
];

/** Which sections can show each data source. Anything else gets an explicit "not available" state. */
const SUPPORTS: Record<Source, Section[]> = {
  // Benchmarks reads a file the operator loads, which is itself the "recorded" source: available in every mode.
  synthetic: ["overview", "investigations", "skills", "history", "benchmarks", "system"],
  recorded: ["benchmarks", "history"],
  live: ["overview", "investigations", "skills", "history", "benchmarks", "system"],
};

const initialSource = (): Source => {
  const q = new URLSearchParams(window.location.search).get("source");
  if (PREVIEW) return q === "recorded" ? q : "synthetic"; // hosted preview: never live
  return q === "live" || q === "recorded" || q === "synthetic" ? q : "synthetic";
};

function Unavailable({ source, liveError, unauthorized }: { source: Source; liveError: string | null; unauthorized?: boolean }) {
  if (unauthorized)
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-8">
        <h1 className="flex items-center gap-2 text-lead font-semibold text-warn"><KeyRound aria-hidden size={18} />Sign in to this system's console</h1>
        <p className="text-text-2">The operator API is running but this browser has no session. Open the one-time URL that <code className="font-mono">python3 -m app ui</code> printed on the host; it sets a session cookie for this machine only.</p>
        <p className="text-meta text-text-3">Nothing is shown until then, and nothing here can change the system: the console is read-only.</p>
      </div>
    );
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-8">
      <h1 className="flex items-center gap-2 text-lead font-semibold text-warn"><Unplug aria-hidden size={18} />
        {source === "live" ? "Not connected to a live system" : "Nothing recorded for this view"}
      </h1>
      {source === "live" ? (
        <>
          <p className="text-text-2">Live data comes from the read-only operator API on this machine ({live.base}). It isn't answering, so nothing is shown rather than guessed.</p>
          {liveError ? <p className="text-meta text-text-3">{liveError}</p> : null}
          <p className="text-meta text-text-3">Start it on the host with <code className="font-mono text-text-2">python3 -m app ui</code> and open the URL it prints. The console retries on its own.</p>
        </>
      ) : (
        <p className="text-text-2">Recorded mode shows real files: a benchmark result or an audit export. Open Benchmarks or History to load one, or switch to Preview to explore the workflow.</p>
      )}
    </div>
  );
}

export function ConsoleShell({ product, section, view = "" }: { product: ProductConfig; section: Section; view?: string }) {
  const [source, setSource] = useState<Source>(initialSource);
  const run = useSyntheticRun();
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [liveBench, setLiveBench] = useState<Recorded | null>(null);
  const liveData = useLive(source === "live");

  // Served by the operator API itself? Then this page IS the live console: start there, unless the URL chose a mode
  // or the person already picked one (their choice wins over a late health answer).
  const chosen = useRef(false);
  const choose = useCallback((s: Source) => { chosen.current = true; setSource(s); }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("source")) return;
    let alive = true;
    live.health().then((r) => { if (alive && r.ok && !chosen.current) setSource("live"); });
    return () => { alive = false; };
  }, []);

  // ?replay=world[&task=N]: the world page's recorded run (a real, sanitized operator-API export), replayed here as
  // Recorded. Provenance is kept: it opens only in Recorded mode and says what it is.
  const [worldReplay, setWorldReplay] = useState<{ steps: Step[]; title: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("replay") !== "world" || q.get("source") !== "recorded") return;
    let alive = true;
    import("../world/recorded-run.json").then((m) => {
      if (!alive) return;
      const task = Number(q.get("task"));
      let ev = m.default.events as LiveEvent[];
      const begin = ev.find((e) => e.event === "task_begin" && e.payload.task_id === task)?.id;
      const end = ev.find((e) => e.event === "task_end" && e.payload.task_id === task)?.id;
      if (begin != null) ev = ev.filter((e) => e.id >= begin && (end == null || e.id <= end));
      setWorldReplay({ steps: ev.map(toStep), title: `world recorded run${begin != null ? `, task ${task}` : ""} (mock agent)` });
    });
    return () => { alive = false; };
  }, []);

  const loadRun = useCallback(async (id: number) => {
    const r = await live.task(id);
    return r.ok ? { steps: r.data.events.map(toStep), title: r.data.task.label } : `${r.reason}: ${r.detail}`;
  }, []);
  const entries = useMemo(() => (source === "live" ? skillEntries(liveData.skills) : SKILLS), [source, liveData.skills]);
  const runs = useMemo(() => (source === "live" ? historyRuns(liveData.tasks) : HISTORY), [source, liveData.tasks]);

  const liveUp = liveData.lastOk != null; // has received real data at least once (may be stale now; the UI says so)
  // health is never shown from a lost connection: the last snapshot could say "Healthy" about a host that is down
  const status = source === "synthetic" ? SYNTHETIC_STATUS : source === "live" && liveData.conn === "connected" ? liveData.status : null;
  const stale = source === "live" && liveData.conn === "lost" && liveUp
    ? { tone: "warn" as const, text: `Lost the connection to the operator API (${liveData.error}). Showing what was last received at ${new Date(liveData.lastOk!).toLocaleTimeString()}; retrying.` }
    : null;
  const supported = SUPPORTS[source].includes(section) || (section === "investigations" && view === "incident");
  const waiting = source === "synthetic" ? ["awaiting_approval", "awaiting_promotion", "reuse_approval"].includes(run.state.phase)
    : source === "live" && liveData.approvals.length > 0;

  let body: React.ReactNode;
  if (!supported) body = <Unavailable source={source} liveError={null} />;
  else if (section === "investigations" && view === "incident") body = <IncidentView />;
  else if (source === "live" && liveData.conn === "unauthorized") body = <Unavailable source="live" liveError={liveData.error} unauthorized />;
  else if (source === "live" && !liveUp && section !== "benchmarks")
    body = liveData.conn === "connecting" ? <p className="p-8 text-text-2" aria-busy="true">Connecting to the operator API…</p> : <Unavailable source="live" liveError={liveData.error} />;
  else if (section === "overview") body = <Overview run={run} product={product} recorded={recorded} live={source === "live" ? liveData : undefined} />;
  else if (section === "investigations") body = source === "live" ? <LiveInvestigations data={liveData} product={product} /> : <Investigations run={run} product={product} />;
  else if (section === "skills") body = <Skills key={source} entries={entries} source={source} />;
  else if (section === "history") body = <History key={source + (worldReplay ? "-world" : "")} runs={source === "recorded" ? [] : runs} source={source}
    loadRun={source === "live" ? loadRun : undefined} initial={source === "recorded" ? worldReplay : null} />;
  else if (section === "benchmarks") body = <Benchmarks key={source} source={source} recorded={source === "live" ? liveBench : recorded} onLoad={source === "live" ? setLiveBench : setRecorded} />;
  else body = <System status={status} source={source} />;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <StatusBar source={source} onSource={choose} sources={PREVIEW ? ["synthetic", "recorded"] : undefined} status={status}
        connected={source === "synthetic" || (source === "live" ? liveData.conn === "connected" : !!recorded)} />
      <div className="flex flex-1 flex-col md:flex-row">
        <nav aria-label="Console" className="border-b border-line md:w-52 md:shrink-0 md:border-r md:border-b-0">
          <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col md:p-3">
            {NAV.map(({ key, label, Icon }) => (
              <li key={key}>
                <a href={`#/console/${key}`} aria-current={section === key ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 whitespace-nowrap md:min-h-0 transition-colors duration-150 ${section === key ? "bg-surface-2 text-text" : "text-text-2 hover:bg-surface hover:text-text"}`}>
                  <Icon aria-hidden size={16} className={section === key ? "text-signal" : "text-text-3"} />
                  {label(product)}
                  {key === "investigations" && waiting ? <span className="ml-auto size-2 rounded-full bg-warn" title="Waiting for you"><span className="sr-only">: waiting for you</span></span> : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1">
          {section === "investigations" ? (
            <nav aria-label="Investigation views" className="flex gap-1 border-b border-line px-4 pt-2 text-meta lg:px-6">
              {[["", "Workflow"], ["incident", "OnCall incident"]].map(([v, label]) => (
                <a key={v} href={`#/console/investigations${v ? `/${v}` : ""}`} aria-current={view === v ? "page" : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 ${view === v ? "border-signal text-text" : "border-transparent text-text-2 hover:text-text"}`}>{label}</a>
              ))}
            </nav>
          ) : null}
          {stale ? <div className="px-5 pt-4"><Banner banner={stale} /></div> : null}
          {body}
        </main>
      </div>
    </div>
  );
}
