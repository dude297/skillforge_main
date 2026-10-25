import { Hand, ShieldCheck, TriangleAlert } from "lucide-react";
import { CopyCommand } from "../components/CopyCommand";
import type { ProposedFix, Source } from "../data/types";
import { approveCommand } from "../data/live";

/** A person decides here, and nothing on this panel can decide for them.
 * Against a real system the browser cannot approve anything: the trusted path is the host CLI command below.
 * In the synthetic preview the buttons drive the script only, and the panel says so right beside them. */
export function ApprovalPanel({ fix, source, onDecide, by = "agent" }: { fix: ProposedFix; source: Source; onDecide?: (approve: boolean) => void;
  /** who proposed it: a deterministic run has no agent, so the panel must not say one was involved */
  by?: "agent" | "skill" }) {
  const preview = source === "synthetic" && onDecide;
  return (
    <section aria-labelledby="approval-h" className="space-y-5 rounded-[var(--radius-panel)] border border-warn/55 bg-warn/[0.06] p-4 sm:p-5">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border border-warn/55 bg-warn/10 px-2 py-0.5 text-meta font-semibold text-warn">
          <Hand aria-hidden size={14} />A person is needed
        </p>
        <h2 id="approval-h" className="text-lead font-semibold text-text">Approve this change?</h2>
        <p className="text-text-2">Nothing changes until a person approves. {by === "skill" ? "An approved skill proposed it without a model or agent, and it cannot approve its own proposal." : "The agent cannot approve its own work."}</p>
      </header>

      <div className="space-y-3 rounded-lg border border-line bg-canvas p-4">
        <p className="text-meta text-text-3">What changes</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt className="text-text-3">Record</dt>
          <dd className="font-medium [overflow-wrap:anywhere]">{fix.record}</dd>
          <dt className="text-text-3">Field</dt>
          <dd className="[overflow-wrap:anywhere]">{fix.field}</dd>
          <dt className="text-text-3">Value</dt>
          <dd className="tnum flex flex-wrap items-baseline gap-x-2">
            <span className="text-text-2 line-through decoration-text-3">{fix.from}</span>
            <span className="text-text-3">becomes</span>
            <span className="text-lead font-semibold text-text">{fix.to}</span>
          </dd>
          <dt className="text-text-3">Why</dt>
          <dd className="text-text-2">{fix.reason}</dd>
        </dl>
      </div>

      <div>
        <h3 className="mb-2 font-medium text-text">Evidence the {by} used</h3>
        <ul className="space-y-2.5">
          {fix.evidence.map((e) => (
            <li key={e.source} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 text-meta">
              {e.trusted
                ? <ShieldCheck aria-hidden size={15} className="mt-0.5 text-text-2" />
                : <TriangleAlert aria-hidden size={15} className="mt-0.5 text-warn" />}
              <span className="min-w-0">
                <span className="font-mono text-text">{e.source}</span>{" "}
                <span className={e.trusted ? "text-text-2" : "font-medium text-warn"}>{e.trusted ? "trusted source" : "untrusted source"}</span>
                <span className="block text-text-2 [overflow-wrap:anywhere]">{e.summary}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {preview ? (
        <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-3">
          <p className="text-meta text-text-2"><span className="font-medium text-text">Synthetic preview.</span> These buttons advance the scripted run. They approve nothing real.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-autofocus className="btn btn-primary min-h-11" onClick={() => onDecide(true)}>Simulate approval</button>
            <button type="button" className="btn btn-quiet min-h-11" onClick={() => onDecide(false)}>Simulate rejection</button>
          </div>
        </div>
      ) : null}

      <CopyCommand label={source === "live" ? "A person approves this on the host. The browser cannot." : "On a real system, approve on the host:"} cmd={approveCommand(fix.actionId, undefined, fix.fingerprint ? [fix.fingerprint] : undefined)} />
    </section>
  );
}
