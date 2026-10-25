import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, CircleX, Hourglass, Ban, Hand, Workflow } from "lucide-react";
import type { RunState } from "../data/synthetic";
import type { ProductConfig } from "../config/product";
import { ApprovalPanel } from "./ApprovalPanel";
import { CopyCommand } from "../components/CopyCommand";
import { approveCommand, promoteCommand, rejectCommand } from "../data/live";
import { SkillPanel } from "./SkillPanel";
import { MetricCompare } from "./MetricCompare";
import { rise, useT } from "../lib/motion";

function Note({ icon: Icon, tone, title, children }: { icon: typeof CircleCheck; tone: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className={`flex items-center gap-2 text-lead font-semibold ${tone}`}>
        <Icon aria-hidden size={20} /> {title}
      </h2>
      <div className="space-y-2 text-text-2">{children}</div>
    </section>
  );
}

/** After a scripted decision: say it was one, and show the real thing it stands in for. The browser never approves. */
function Simulated({ what, cmd, label }: { what: string; cmd?: string; label?: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-3" data-testid="simulated-decision">
      <p className="text-meta text-text-2"><span className="font-medium text-text">Simulated {what}.</span> You pressed a scripted button in the synthetic preview. On a real system a person does this on the host, and the browser cannot.</p>
      {cmd ? <CopyCommand label={label} cmd={cmd} /> : null}
    </div>
  );
}

/** Right column: what needs attention for the current phase. One focus at a time. */
export function Inspector({ run, product, onDecide, onPromote, onApproveReuse }: {
  run: RunState; product: ProductConfig;
  onDecide: (approve: boolean) => void; onPromote: () => void; onApproveReuse: () => void;
}) {
  const tr = useT("panel");
  const { phase } = run;
  let body: React.ReactNode;
  if (phase === "awaiting_approval" && run.fix) body = <ApprovalPanel fix={run.fix} source="synthetic" onDecide={onDecide} />;
  else if (run.compare)
    body = (
      <div className="space-y-4">
        <Simulated what="approval of both fixes" />
        <MetricCompare compare={run.compare} />
      </div>
    );
  else if (run.skill && ["learning", "awaiting_promotion", "promoted"].includes(phase))
    body = (
      <div className="space-y-4">
        <SkillPanel skill={run.skill} onPromote={phase === "awaiting_promotion" ? onPromote : undefined} />
        {phase === "promoted" ? <Simulated what="promotion" label="On a real system, a person promotes on the host (runs the hidden tests first):" cmd={promoteCommand(run.skill.name, run.skill.version)} /> : null}
      </div>
    );
  else if (phase === "reuse_approval")
    body = (
      <section aria-labelledby="reuse-ap-h" className="space-y-4 rounded-[var(--radius-panel)] border border-warn/55 bg-warn/[0.06] p-4 sm:p-5">
        <p className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border border-warn/55 bg-warn/10 px-2 py-0.5 text-meta font-semibold text-warn"><Hand aria-hidden size={14} />A person is needed</p>
        <h2 id="reuse-ap-h" className="text-lead font-semibold">Approve 2 fixes from the skill?</h2>
        <p className="text-text-2">The skill matched the new data exactly, so no model was needed. The same approval and verifier still apply: it proposed the fixes, it cannot apply them.</p>
        <div className="space-y-2 rounded-lg border border-dashed border-line-strong p-3">
          <p className="text-meta text-text-2"><span className="font-medium text-text">Synthetic preview.</span> This button advances the scripted run. It approves nothing real.</p>
          <button type="button" data-autofocus className="btn btn-primary min-h-11" onClick={onApproveReuse}>Simulate approval of both fixes</button>
        </div>
        <p className="text-meta text-text-3">On a real system each proposed fix is approved on the host, with its own command.</p>
      </section>
    );
  else if (phase === "verified")
    body = (
      <Note icon={CircleCheck} tone="text-verified" title="Verified">
        <p>The {product.terms.fix} was applied once and checked against the database by code the agent does not control.</p>
        <p>This kind of {product.terms.fix} could happen again. Turn it into a skill so next time it doesn't need the model.</p>
        {run.fix ? <Simulated what="approval" label="On a real system, a person approved on the host:" cmd={approveCommand(run.fix.actionId)} /> : null}
      </Note>
    );
  else if (phase === "verify_failed")
    body = (
      <Note icon={CircleX} tone="text-fail" title="Needs review">
        <p>The {product.terms.fix} was applied, but the verifier found a different value afterwards. It is recorded and marked for a person to review; nothing is redone automatically.</p>
        {run.fix ? <Simulated what="approval" label="On a real system, a person approved on the host:" cmd={approveCommand(run.fix.actionId)} /> : null}
      </Note>
    );
  else if (phase === "rejected")
    body = <Note icon={Ban} tone="text-text" title="Rejected">
        <p>No change was made. The proposal is closed.</p>
        {run.fix ? <Simulated what="rejection" label="On a real system, a person rejects on the host:" cmd={rejectCommand(run.fix.actionId)} /> : null}
      </Note>;
  else if (phase === "escalated")
    body = (
      <Note icon={Hourglass} tone="text-warn" title="Escalated to a person">
        <p>Without the local model the agent can't investigate unfamiliar problems, and it never falls back to a cloud model.</p>
        <p>Approved skills keep working: anything that matches one exactly can still be handled.</p>
      </Note>
    );
  else if (phase === "investigating" || phase === "reusing")
    body = (
      <Note icon={Workflow} tone="text-signal" title={phase === "reusing" ? "A learned skill is handling the new data" : "The agent is investigating"}>
        <p>{phase === "reusing" ? "No model is involved: the approved skill runs as fixed code and proposes fixes." : "It reads the records and the evidence behind them."} Anything that would change data stops here for a person first.</p>
        <p className="text-meta text-text-3">Scripted preview: the steps on the left are played from a script, not produced by a model.</p>
      </Note>
    );
  else if (phase === "executing" || phase === "reconnecting")
    body = (
      <Note icon={Workflow} tone="text-signal" title={phase === "reconnecting" ? "Reconnecting to the host service" : "Applying the approved change"}>
        <p>{phase === "reconnecting" ? "The change is retried safely: a repeat finds it already applied and reports that instead of applying it twice." : "The change is applied once, then checked against the database by code the agent does not control."}</p>
        {run.fix ? <Simulated what="approval" label="On a real system, a person approves on the host:" cmd={approveCommand(run.fix.actionId)} /> : null}
      </Note>
    );
  else
    body = (
      <section className="space-y-3 text-text-2">
        <h2 className="text-lead font-semibold text-text">Nothing needs you yet</h2>
        <p>When the agent proposes a change, it appears here with its evidence. You decide; the agent can't.</p>
      </section>
    );
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={phase + (run.compare ? "c" : "")} {...rise} transition={tr} className="p-5">
        {body}
      </motion.div>
    </AnimatePresence>
  );
}
