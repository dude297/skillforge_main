import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, CircleX, Hourglass, Ban } from "lucide-react";
import type { RunState } from "../data/synthetic";
import type { ProductConfig } from "../config/product";
import { ApprovalPanel } from "./ApprovalPanel";
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

/** Right column: what needs attention for the current phase. One focus at a time. */
export function Inspector({ run, product, onDecide, onPromote, onApproveReuse }: {
  run: RunState; product: ProductConfig;
  onDecide: (approve: boolean) => void; onPromote: () => void; onApproveReuse: () => void;
}) {
  const tr = useT("panel");
  const { phase } = run;
  let body: React.ReactNode;
  if (phase === "awaiting_approval" && run.fix) body = <ApprovalPanel fix={run.fix} source="synthetic" onDecide={onDecide} />;
  else if (run.compare) body = <MetricCompare compare={run.compare} />;
  else if (run.skill && ["learning", "awaiting_promotion", "promoted"].includes(phase))
    body = <SkillPanel skill={run.skill} onPromote={phase === "awaiting_promotion" ? onPromote : undefined} />;
  else if (phase === "reuse_approval")
    body = (
      <Note icon={Hourglass} tone="text-warn" title="Approve 2 fixes from the skill?">
        <p>The skill matched the new data exactly, so no model was needed. The same approval and verifier still apply.</p>
        <button type="button" data-autofocus className="btn btn-primary mt-2" onClick={onApproveReuse}>Approve both fixes</button>
        <p className="text-meta text-text-3">Preview only: advances the scripted run.</p>
      </Note>
    );
  else if (phase === "verified")
    body = (
      <Note icon={CircleCheck} tone="text-verified" title="Verified">
        <p>The {product.terms.fix} was applied once and checked against the database by code the agent does not control.</p>
        <p>This kind of {product.terms.fix} could happen again. Turn it into a skill so next time it doesn't need the model.</p>
      </Note>
    );
  else if (phase === "verify_failed")
    body = (
      <Note icon={CircleX} tone="text-fail" title="Needs review">
        <p>The {product.terms.fix} was applied, but the verifier found a different value afterwards. It is recorded and marked for a person to review; nothing is redone automatically.</p>
      </Note>
    );
  else if (phase === "rejected")
    body = <Note icon={Ban} tone="text-text" title="Rejected"><p>No change was made. The proposal is closed.</p></Note>;
  else if (phase === "escalated")
    body = (
      <Note icon={Hourglass} tone="text-warn" title="Escalated to a person">
        <p>Without the local model the agent can't investigate unfamiliar problems, and it never falls back to a cloud model.</p>
        <p>Approved skills keep working: anything that matches one exactly can still be handled.</p>
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
