import { ShieldAlert } from "lucide-react";
import { CopyCommand } from "../components/CopyCommand";
import type { ProposedFix, Source } from "../data/types";
import { approveCommand } from "../data/live";

/** A person decides here. In the synthetic preview the buttons drive the script and say so. Against a real
 * system the browser cannot approve anything: the trusted path is the host CLI command shown below. */
export function ApprovalPanel({ fix, source, onDecide, by = "agent" }: { fix: ProposedFix; source: Source; onDecide?: (approve: boolean) => void;
  /** who proposed it: a deterministic run has no agent, so the panel must not say one was involved */
  by?: "agent" | "skill" }) {
  return (
    <section aria-labelledby="approval-h" className="space-y-5">
      <header className="flex items-start gap-3">
        <ShieldAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-warn" />
        <div>
          <h2 id="approval-h" className="text-lead font-semibold text-text">Approve this change?</h2>
          <p className="text-text-2">Nothing changes until a person approves. {by === "skill" ? "An approved skill proposed it without a model or agent, and it cannot approve its own proposal." : "The agent cannot approve its own work."}</p>
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-line p-4">
        <dt className="text-text-3">Record</dt>
        <dd className="font-medium">{fix.record}</dd>
        <dt className="text-text-3">{fix.field}</dt>
        <dd className="tnum">
          <span className="text-text-2 line-through decoration-text-3">{fix.from}</span>
          <span className="px-2 text-text-3">to</span>
          <span className="font-semibold text-text">{fix.to}</span>
        </dd>
        <dt className="text-text-3">Why</dt>
        <dd className="text-text-2">{fix.reason}</dd>
      </dl>

      <div>
        <h3 className="mb-2 font-medium text-text">Evidence the {by} used</h3>
        <ul className="space-y-2">
          {fix.evidence.map((e) => (
            <li key={e.source} className="flex gap-3 text-meta">
              <span className={`mt-1 size-1.5 shrink-0 rounded-full ${e.trusted ? "bg-verified" : "bg-text-3"}`} aria-hidden />
              <span>
                <span className="font-mono text-text-2">{e.source}</span>{" "}
                <span className="text-text-3">{e.trusted ? "trusted" : "untrusted"}</span>
                <span className="block text-text-2">{e.summary}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {source === "synthetic" && onDecide ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" data-autofocus className="btn btn-primary" onClick={() => onDecide(true)}>Approve change</button>
            <button type="button" className="btn btn-quiet" onClick={() => onDecide(false)}>Reject</button>
          </div>
          <p className="text-meta text-text-3">Preview only: these buttons advance the scripted run.</p>
        </div>
      ) : null}

      <CopyCommand label={source === "live" ? "Approve on the host:" : "On a real system, approve on the host:"} cmd={approveCommand(fix.actionId, undefined, fix.fingerprint ? [fix.fingerprint] : undefined)} />
    </section>
  );
}
