// PREVIEW ONLY (VITE_PREVIEW=1): the Set up walkthrough as an ILLUSTRATION. The hosted preview has no host to read, so
// this never pretends to: every value comes from bootstrap-data.ts (example values, statuses that are the true state of
// SkillForge today), it performs no check and no request, and it says so at the top. The live version in
// BootstrapLite.tsx is unchanged and is what runs on the GB10.
import { useRef, useState, useEffect, type ReactNode } from "react";
import { Scene } from "./Scene";
import { DEPTS, sceneState, type Dept } from "./events";
import { MANIFEST, RIGHTS, STATUS, SYSTEMS, type Status } from "./bootstrap-data";
import type { ThemeName } from "./theme";
import { SourceTag } from "./World";

const STEPS = ["Choose a workspace", "Read-only discovery", "Roles and capabilities", "Workflows and permissions", "Your office"] as const;
const EMPTY = sceneState([]);
const ROOMS = Object.keys(DEPTS) as Dept[];

/** colour repeats the meaning in words: amber = a person or a check is still needed, grey = nothing to act on */
const TONE: Record<Status, string> = { supported: "", configured: "world-tag-story", awaiting: "world-tag-story", unavailable: "world-tag-stale" };
function StatusChip({ status }: { status: Status }) {
  return <span title={STATUS[status].meaning} className={`world-tag ${TONE[status]}`}>{STATUS[status].text}</span>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="world-card space-y-2 p-4"><h3 className="font-semibold">{title}</h3>{children}</div>;
}

export function BootstrapPreview({ theme, desktop }: { theme: ThemeName; desktop: boolean }) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => { if (moved.current) heading.current?.focus(); moved.current = true; }, [step]);
  const person = RIGHTS.filter((r) => r.person);

  return (
    <section aria-labelledby="bl-h" className={`mx-auto max-w-[60rem] space-y-6 ${desktop ? "px-6" : "px-4"} pt-8 pb-14`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-meta">
          <SourceTag source="story" />
          <span className="world-muted">An illustration: nothing on this page reads a workspace, connects, grants permissions or writes.</span>
        </div>
        <h1 className="world-h1">Set up SkillForge on your workspace</h1>
        <p className="world-lead max-w-[40rem]" data-testid="preview-note">On the GB10, this step reads your real workspace, read-only, and shows only what it finds. Below is the same walkthrough with example values.</p>
      </div>
      <nav aria-label="Onboarding steps">
        <ol className="world-key flex flex-wrap gap-1 p-1 max-sm:flex-nowrap">
          {STEPS.map((s, i) => (
            <li key={s} className="max-sm:flex-1"><button type="button" onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined}
              className={`world-seg-item text-meta max-sm:min-h-11 max-sm:w-full ${step === i ? "is-on" : ""}`}>{i + 1}<span className="max-sm:sr-only">. {s}</span></button></li>
          ))}
        </ol>
      </nav>

      <div className="space-y-5">
        <h2 id="bl-h" ref={heading} tabIndex={-1} className="world-h2 outline-none">Step {step + 1} of {STEPS.length}: {STEPS[step]}</h2>

        {step === 0 ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="world-body mb-2">On the GB10, only workspaces SkillForge can read are offered, and discovery opens them read-only.</legend>
              <label className="world-card flex items-start gap-3 p-3">
                <input type="radio" name="ws" checked readOnly className="mt-1 size-4" />
                <span className="min-w-0"><span className="font-semibold">Example company: freight purchase orders</span> <span className="world-muted text-meta">(an example, not a file on this machine)</span>
                  <span className="block text-meta world-muted">Record kinds: {MANIFEST.environment.record_kinds.join(", ")}. Evidence: {MANIFEST.environment.evidence_sources.join(", ")}.</span></span>
              </label>
              <label className="world-card flex items-start gap-3 p-3 opacity-70">
                <input type="radio" name="ws" disabled className="mt-1 size-4" />
                <span className="min-w-0"><span className="font-semibold">Your workspaces</span>
                  <span className="block text-meta world-muted">Listed here on the host. This hosted preview has no host to list.</span></span>
              </label>
            </fieldset>
            <button type="button" className="world-btn world-btn-primary" onClick={() => setStep(1)}>Show the example discovery</button>
          </>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <p className="world-body">What read-only discovery would list for the example company. This page ran no checks, so it never says &ldquo;connected&rdquo; or &ldquo;healthy&rdquo;; real health lives in the console&apos;s System view.</p>
            <ul aria-label="Systems in this illustration" className="space-y-3">
              {SYSTEMS.map((x) => (
                <li key={x.id} className="world-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
                  <span className="min-w-0"><span className="font-semibold">{x.name}</span> <span className="world-muted text-meta">({x.via})</span>
                    <span className="block text-meta world-muted">Discovery reports: {x.found}</span></span>
                  <StatusChip status={x.status} />
                </li>
              ))}
            </ul>
            <p className="text-meta world-muted">Writes performed: 0. Discovery only reads.</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Ember (the AI agent) may"><p className="text-meta world-muted">{MANIFEST.tool_inventory.join(", ")}</p></Card>
              <Card title="Only a person may">
                <ul className="list-disc space-y-1 pl-5 text-meta world-muted">{person.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
              </Card>
            </div>
            <Card title="Skills it could learn here">
              <p className="text-meta world-muted">{MANIFEST.missing_skill_opportunities.join(", ")}. Each would be proposed by Ember, then approved by a person before it is used.</p>
            </Card>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="world-card overflow-x-auto p-4">
            <table className="w-full text-left text-meta">
              <caption className="mb-2 text-left font-semibold">What Ember would be allowed to do, and who decides</caption>
              <thead><tr><th scope="col" className="pr-3 pb-1">Action</th><th scope="col" className="pr-3 pb-1">Who decides</th><th scope="col" className="pb-1">Room</th></tr></thead>
              <tbody>
                {RIGHTS.map((r) => (
                  <tr key={r.text} className="world-pop-item align-top">
                    <td className="py-1.5 pr-3 font-semibold">{r.text}</td>
                    <td className="py-1.5 pr-3">{r.rule}</td>
                    <td className="py-1.5">{DEPTS[r.dept].name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-meta world-muted">Nothing is granted by this page. On the host, a person grants each permission separately.</p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            <div className={`world-scene-frame relative overflow-hidden ${desktop ? "h-[26rem]" : "h-64"}`}>
              <Scene state={EMPTY} theme={theme} focus={null} onOpen={() => {}} open={null} label="Illustration: the office with nothing running yet" still />
            </div>
            <ul className="grid gap-3 md:grid-cols-2" aria-label="Rooms">
              {ROOMS.map((r) => {
                const rights = RIGHTS.filter((x) => x.dept === r);
                const systems = SYSTEMS.filter((x) => x.dept === r);
                return (
                  <li key={r} className="world-card space-y-2 p-3">
                    <h3 className="font-semibold">{DEPTS[r].name}</h3>
                    <ul className="space-y-1.5 text-meta">
                      {systems.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2"><span>{x.name}</span><StatusChip status={x.status} /></li>)}
                      {rights.map((x) => <li key={x.text} className="world-muted">{x.text}: {x.rule}</li>)}
                      {systems.length || rights.length ? null : <li className="world-muted">Nothing is set up here in this example.</li>}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <div className="world-card space-y-2 p-4" data-testid="what-next">
              <h3 className="font-semibold">What happens next</h3>
              <p className="world-body">Setting up switches nothing on. Work starts when a request arrives: a person approves each change on the host and the independent check verifies it.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="#story" onClick={(e) => { e.preventDefault(); document.getElementById("story")?.scrollIntoView(); }} className="world-btn world-btn-primary">Continue to the office</a>
              <a href="#/world/bootstrap" className="world-btn">See the scrolling illustration</a>
              <a href="#/console" className="world-btn">Open the console</a>
            </div>
          </div>
        ) : null}

        {step < 4 && step > 0 ? (
          <div className="flex flex-wrap gap-3">
            <button type="button" className="world-btn" onClick={() => setStep(step - 1)}>Back</button>
            <button type="button" className="world-btn world-btn-primary" onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1]}</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
