// The OnCall run in the console: the same master-detail proof as the guided demo, under its own mode banner.
import { useOnCall } from "../../data/useOnCall";
import { runMode } from "../../data/oncall";
import { ModeBanner, modeSentence } from "../../components/ModeBanner";
import { RunInspector } from "../../components/RunInspector";

export function IncidentView() {
  const load = useOnCall();
  if (load.state === "loading") return <p className="p-8 text-text-2" aria-busy="true">Loading the OnCall run…</p>;
  const run = load.state === "ok" ? load.run : null;
  const mode = runMode(run);
  return (
    <div>
      <ModeBanner mode={mode} sentence={modeSentence(mode, run, load.state === "ok" ? load.origin : null, load.state === "missing" ? load.detail : undefined)} />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-h3 font-semibold tracking-tight">{run?.incident?.title ?? "No OnCall run loaded"}</h1>
          <a href="#/demo" className="text-meta text-text-2 underline-offset-4 hover:text-text hover:underline">Walk through it in the guided demo</a>
        </div>
        {run ? <RunInspector run={run} /> : <p className="text-text-2">Nothing is shown rather than guessed. Serve the UI from the host or ship demo/oncall-run.recorded.json with the build.</p>}
      </div>
    </div>
  );
}
