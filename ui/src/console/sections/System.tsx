import type { Source, SystemStatus } from "../../data/types";
import { MODEL_REGISTRY } from "../../data/registry";
import { HealthPill } from "../../components/HealthPill";

const RECOVERY = [
  { when: "The model stops answering", what: "New investigations are escalated to a person. Approved skills keep working.", cmd: "python3 -m app fastpath" },
  { when: "The primary model is unusable", what: "Switch to a staged local model; it is probed and rolled back if it fails.", cmd: "bash scripts/switch_model.sh <new-profile> <current-profile>" },
  { when: "A process crashed mid-run", what: "See what is stuck, then verify interrupted changes. Nothing is re-applied.", cmd: "python3 -m app status && python3 -m app recover" },
  { when: "The sandbox can't reach the host", what: "Follow the network decision tree in the runbook (D1 to D10).", cmd: "openshell logs my-assistant --tail --source sandbox" },
];

/** Health, the local model registry (real data/models.json) and what to do when something fails. */
export function System({ status, source }: { status: SystemStatus | null; source: Source }) {
  const unknown = { ok: null, detail: "no data source connected" };
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-10 p-6">
      <section aria-labelledby="sys-h" className="space-y-4">
        <h1 id="sys-h" className="text-h2 font-semibold tracking-tight">System</h1>
        <div className="panel grid gap-3 p-5 sm:grid-cols-2">
          <HealthPill label="Model" health={status?.inference ?? unknown} value={status?.inference.model ?? null} />
          <HealthPill label="Sandbox" health={status?.sandbox ?? unknown} />
          <HealthPill label="Host service" health={status?.host_service ?? unknown} />
          <HealthPill label="Database" health={status ? { ok: status.db.quick_check === "ok", detail: status.db.quick_check } : unknown} />
        </div>
        {source === "synthetic" ? <p className="text-meta text-text-3">Preview values. Live health comes from <code className="font-mono">python3 -m app status</code>.</p> : null}
        {source === "live" && status ? (
          <div className="space-y-2">
            <h2 className="font-semibold">What the host says to do next</h2>
            <ul className="list-disc space-y-1 pl-5 text-text-2">{status.next_actions.map((a) => <li key={a} className="[overflow-wrap:anywhere]">{a}</li>)}</ul>
            <p className="text-meta text-text-3">From <code className="font-mono">python3 -m app status</code> on the host, refreshed every 10 s. Unknown means not checked, never assumed healthy.</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="reg-h" className="space-y-3">
        <h2 id="reg-h" className="text-h3 font-semibold tracking-tight">Local models</h2>
        <p className="max-w-prose text-text-2">
          From <code className="font-mono text-text">data/models.json</code> in the repository. A model may write skills only after it passes the capability probe: {MODEL_REGISTRY.required_for_learning.join(", ").replaceAll("_", " ")}.
        </p>
        <div className="panel overflow-x-auto" tabIndex={0} role="region" aria-label="Local models table">
          <table className="w-full text-left text-meta">
            <thead className="text-text-3"><tr>{["Model", "Role", "Tool parser", "Context", "Download", "Validated on GB10"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {MODEL_REGISTRY.models.map((m) => (
                <tr key={m.id} className="border-t border-line align-top">
                  <td className="px-3 py-2.5"><span className="block font-medium text-text">{m.id.split("/").pop()}</span><span className="block font-mono text-text-3">{m.nemoclaw_profile}</span></td>
                  <td className="px-3 py-2.5 text-text-2">{m.role}</td>
                  <td className="px-3 py-2.5 font-mono text-text-2">{m.tool_parser}</td>
                  <td className="tnum px-3 py-2.5 text-text-2">{m.max_model_len.toLocaleString()}</td>
                  <td className="tnum px-3 py-2.5 text-text-2">{m.storage_gb} GB</td>
                  <td className={`px-3 py-2.5 ${m.validation.status === "unverified" ? "text-warn" : "text-verified"}`}>{m.validation.status === "unverified" ? "Not yet" : m.validation.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="rec-h" className="space-y-3">
        <h2 id="rec-h" className="text-h3 font-semibold tracking-tight">When something fails</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {RECOVERY.map((r) => (
            <li key={r.when} className="panel min-w-0 space-y-2 p-4">
              <p className="font-semibold">{r.when}</p>
              <p className="text-text-2">{r.what}</p>
              <code className="block font-mono text-[0.8125rem] [overflow-wrap:anywhere] text-text-2">{r.cmd}</code>
            </li>
          ))}
        </ul>
        <p className="text-meta text-text-3">No step falls back to a cloud model.</p>
      </section>
    </div>
  );
}
