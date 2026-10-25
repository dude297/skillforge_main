import { Hand, CheckCircle2 } from "lucide-react";
import type { ProductConfig } from "../../config/product";
import type { SyntheticRun } from "../ConsoleShell";
import type { Recorded } from "../../data/recorded";
import type { LiveData } from "../../data/useLive";
import { SKILLS, HISTORY } from "../../data/registry";
import { PHASE_LABEL } from "./Investigations";
import { fromAudit } from "../../world/events";

const WAITING = new Set(["awaiting_approval", "awaiting_promotion", "reuse_approval"]);

interface Summary {
  headline: string; waiting: boolean; cta: string;
  activeSkills: number; pendingSkills: number; bySkill: number; runs: number; runsNote: string;
  compare: { big: string; text: string } | null; footnote: string;
}

function fromSynthetic(run: SyntheticRun, product: ProductConfig, recorded: Recorded | null): Summary {
  const { phase } = run.state;
  const waiting = WAITING.has(phase);
  return {
    headline: waiting ? "One decision is waiting for you." : phase === "idle" ? `No open ${product.terms.tasks.toLowerCase()}.` : `${PHASE_LABEL[phase]}.`,
    waiting, cta: waiting ? "Review it" : phase === "idle" ? `Start an ${product.terms.task.toLowerCase()}` : "Open the current run",
    activeSkills: SKILLS.filter((s) => s.versions.some((v) => v.active)).length,
    pendingSkills: SKILLS.filter((s) => s.versions.some((v) => v.status === "tested")).length,
    bySkill: HISTORY.filter((h) => h.path === "skill").length, runs: HISTORY.length, runsNote: "recent runs handled by a skill instead of the model",
    compare: recorded?.compare ? {
      big: `${recorded.compare.rows[1]?.model_calls ?? "n/a"} vs ${recorded.compare.rows[0]?.model_calls ?? "n/a"}`,
      text: `model calls, skill vs agent (${recorded.realModel ? "measured" : "mock run"})`,
    } : null,
    footnote: "Counts on this page come from the synthetic preview data.",
  };
}

function fromLive(d: LiveData, product: ProductConfig): Summary {
  const open = d.tasks.find((t) => t.status === "open");
  const tested = d.skills.filter((s) => s.status === "tested");
  const n = d.approvals.length + tested.length;
  const reuse = d.tasks.find((t) => t.status === "closed" && t.skills_used.length);
  const skill = reuse && d.skills.find((s) => reuse.skills_used.includes(`${s.name}@v${s.version}`));
  const agent = skill ? d.tasks.find((t) => t.id === skill.source_task) : undefined;
  const mock = reuse?.mode === "mock" || agent?.mode === "mock";
  return {
    headline: n ? `${n === 1 ? "One decision is" : `${n} decisions are`} waiting for you.`
      : open ? `${open.mode === "deterministic" ? "An approved skill is handling" : "The agent is working on"} ${open.label}.` : d.tasks.length ? `No open ${product.terms.tasks.toLowerCase()}.` : "Nothing has run on this system yet.",
    waiting: n > 0, cta: n ? "Review it" : open ? "Watch it" : `See the ${product.terms.tasks.toLowerCase()}`,
    activeSkills: d.skills.filter((s) => s.active).length, pendingSkills: tested.length,
    bySkill: d.tasks.filter((t) => t.skills_used.length).length, runs: d.tasks.length,
    runsNote: `of the ${d.tasks.length === 50 ? "last 50" : ""} runs on this system${d.tasks.some((t) => t.mode === "mock") ? ` (${d.tasks.filter((t) => t.mode === "mock").length} by the mock agent)` : ""} were handled by a skill`.replace("the  runs", "the runs"),
    compare: reuse && agent ? {
      big: mock ? `${reuse.tool_calls ?? "n/a"} vs ${agent.tool_calls ?? "n/a"}` : `${reuse.model_calls ?? "n/a"} vs ${agent.model_calls ?? "n/a"}`,
      text: mock ? "tool calls, skill vs agent (mock agent: model calls not measured)" : "model calls, skill vs agent, measured on this system",
    } : null,
    footnote: "Counts on this page come from this system's database, read-only.",
  };
}

// router decisions that open no task: deferred, handed to a person, refused, queued. Same words as the World page.
const RAN_NOTHING = new Set(["route_needs_human", "route_deferred", "route_refused", "route_queued_for_agent"]);

function RanNothing({ live }: { live: LiveData }) {
  const rows = live.events.filter((e) => RAN_NOTHING.has(e.event)).slice(-6).reverse();
  if (!rows.length) return null;
  return (
    <section aria-labelledby="ov-held" className="space-y-4 border-t border-line pt-8">
      <div>
        <h2 id="ov-held" className="text-lead font-semibold">Requests that stopped before anything ran</h2>
        <p className="text-text-2">Automation stopped on purpose: no task was opened, no model ran, and nothing was changed.</p>
      </div>
      <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line">
        {rows.map((e) => {
          const v = fromAudit(e);
          return (
            <li key={e.id} className="grid gap-1 p-4 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
              <p className="font-medium text-warn">{v.title}</p>
              <div className="min-w-0">
                <p className="text-text-2 [overflow-wrap:anywhere]">{v.detail}</p>
                <p className="tnum text-meta text-text-3 [overflow-wrap:anywhere]">{e.ts} UTC{typeof e.payload.event_id === "string" ? `, request ${e.payload.event_id}` : ""}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Leads with what needs a person, then what the system has learned. Sentences, not stat tiles. */
export function Overview({ run, product, recorded, live }: { run: SyntheticRun; product: ProductConfig; recorded: Recorded | null; live?: LiveData }) {
  const s = live ? fromLive(live, product) : fromSynthetic(run, product, recorded);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 p-6 lg:p-10">
      <section aria-labelledby="ov-h" className="space-y-5">
        <h1 id="ov-h" className="text-h2 leading-tight font-semibold tracking-[-0.03em] [overflow-wrap:anywhere] text-balance sm:text-h1">{s.headline}</h1>
        <a href={s.waiting && live && !live.approvals.length ? "#/console/skills" : "#/console/investigations"} className={`btn ${s.waiting ? "btn-primary" : "btn-quiet"}`}>
          {s.waiting ? <Hand aria-hidden size={16} /> : <CheckCircle2 aria-hidden size={16} />}
          {s.cta}
        </a>
      </section>

      <section aria-labelledby="ov-learn" className="grid gap-x-10 gap-y-6 border-t border-line pt-8 md:grid-cols-3">
        <h2 id="ov-learn" className="sr-only">What the system has learned</h2>
        <div>
          <p className="tnum text-h2 font-semibold">{s.activeSkills}</p>
          <p className="text-text-2">approved skill{s.activeSkills === 1 ? "" : "s"} in use, {s.pendingSkills} waiting to be promoted</p>
          <a className="mt-1 inline-flex min-h-11 items-center text-meta text-signal hover:underline md:min-h-0 md:mt-2" href="#/console/skills">Open the registry</a>
        </div>
        <div>
          <p className="tnum text-h2 font-semibold">{s.bySkill} of {s.runs}</p>
          <p className="text-text-2">{s.runsNote}</p>
          <a className="mt-1 inline-flex min-h-11 items-center text-meta text-signal hover:underline md:min-h-0 md:mt-2" href="#/console/history">See the history</a>
        </div>
        <div>
          {s.compare ? (
            <>
              <p className="tnum text-h2 font-semibold">{s.compare.big}</p>
              <p className="text-text-2">{s.compare.text}</p>
            </>
          ) : (
            <>
              <p className="text-h3 leading-[2.7rem] font-semibold text-text-3">Not measured yet</p>
              <p className="text-text-2">{live ? "Appears once a skill has handled a task the agent first solved." : "Load a benchmark result to compare the agent with its skills."}</p>
            </>
          )}
          <a className="mt-1 inline-flex min-h-11 items-center text-meta text-signal hover:underline md:min-h-0 md:mt-2" href="#/console/benchmarks">Benchmarks</a>
        </div>
      </section>
      {live ? <RanNothing live={live} /> : null}
      <p className="text-meta text-text-3">{s.footnote}</p>
    </div>
  );
}
