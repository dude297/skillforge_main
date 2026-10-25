// EXPERIMENT (exp/bootstrap-lite): functional onboarding in front of the unchanged Daylight World. Five steps over the
// REAL read-only manifest (`python -m experiments.bootstrap_lite`, GET only, operator session). Every item carries
// exactly one state assigned by the backend from evidence; this page never upgrades one, and never fills a gap with
// example data: without the backend it says so and shows nothing. Nothing here connects, grants, promotes or writes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FOCUS, P, Scene } from "./Scene";
import { DEPTS, sceneState, type Dept } from "./events";
import { THEMES, type ThemeName } from "./theme";
import { SourceTag } from "./World";
import { CopyCommand } from "../components/CopyCommand";
import { PREVIEW } from "../lib/preview";
import { live, type LiteDiscovery, type LiteItem, type LiteState, type LiteWorkspace } from "../data/live";

const STEPS = ["Choose a workspace", "Read-only discovery", "Roles and capabilities", "Workflows and permissions", "Your office"] as const;
const EMPTY = sceneState([]);
const VIEW = "-320 -72 640 400"; // Scene's whole-office framing (focus=null): overlay chips share its coordinates
const ROOMS = Object.keys(DEPTS) as Dept[];

/** Plain words first: a reviewer who has never seen SkillForge must be able to tell what works now. */
export const STATE_INFO: Record<LiteState, { label: string; meaning: string }> = {
  active: { label: "Active", meaning: "working now on this machine" },
  approved: { label: "Approved, not in use here", meaning: "a person approved it, but it does not apply to this workspace" },
  configured: { label: "Set up, not working", meaning: "set up on this machine, but not answering or not in use" },
  discovered: { label: "Found only", meaning: "seen in your files; nothing is set up" },
  unavailable: { label: "Unavailable", meaning: "not set up, not reachable, or not built" },
  illustrative: { label: "Example only", meaning: "an illustration, not your workspace" },
};
const ORDER: LiteState[] = ["active", "approved", "configured", "discovered", "unavailable", "illustrative"];

/** shape carries the state; colour only repeats it */
function Glyph({ state }: { state: LiteState }) {
  const ink = "#14203A", t = THEMES.daylight;
  const g: Record<LiteState, ReactNode> = {
    active: <circle r={4.5} fill={t.signal} stroke={ink} strokeWidth={1.4} />,
    approved: <path d="M0 -5 L5 0 L0 5 L-5 0 Z" fill="#fff" stroke={ink} strokeWidth={1.4} />,
    configured: <g><circle r={4.5} fill="#fff" stroke={ink} strokeWidth={1.4} /><path d="M0 -4.5 A4.5 4.5 0 0 1 0 4.5 Z" fill={t.warn} /></g>,
    discovered: <circle r={4.5} fill="#fff" stroke={ink} strokeWidth={1.4} />,
    unavailable: <path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke={ink} strokeWidth={2} />,
    illustrative: <rect x={-4.5} y={-4.5} width={9} height={9} fill="none" stroke={ink} strokeWidth={1.2} strokeDasharray="2 1.6" />,
  };
  return <svg aria-hidden viewBox="-6 -6 12 12" className="size-3.5 shrink-0">{g[state]}</svg>;
}

export function StateBadge({ state }: { state: LiteState }) {
  return (
    <span data-state={state} className={`world-chip inline-flex items-center gap-1.5 font-semibold ${state === "active" ? "!text-[#14203A]" : ""}`}>
      <Glyph state={state} />{STATE_INFO[state].label}
    </span>
  );
}

function Legend() {
  return (
    <dl className="world-key grid gap-x-5 gap-y-1.5 text-meta sm:grid-cols-2" aria-label="What each state means">
      {ORDER.map((s) => (
        <div key={s} className="flex items-baseline gap-2"><dt><StateBadge state={s} /></dt><dd className="world-muted">{STATE_INFO[s].meaning}</dd></div>
      ))}
    </dl>
  );
}

/** the answer to "what actually works?", in one sentence, on every result step */
function ActiveNow({ d }: { d: LiteDiscovery }) {
  const a = d.summary.active;
  return (
    <p className="world-card p-3 font-semibold" aria-live="polite" data-testid="active-now">
      Active now: {a.length ? a.join("; ") : "nothing. Everything below is found, set up, or an example, but not working yet."}
    </p>
  );
}

function ItemList({ items, label }: { items: LiteItem[]; label: string }) {
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((c) => (
        <li key={c.id} data-item={c.id} className="world-card space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{c.name}</span><StateBadge state={c.state} />
          </div>
          <p className="text-meta world-muted [overflow-wrap:anywhere]">{c.evidence}</p>
          {c.next_step ? <CopyCommand label="Next step (a person runs this on the host; this page can't)" cmd={c.next_step} /> : null}
        </li>
      ))}
    </ul>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return <div role="alert" className="world-card space-y-2 p-4"><p className="font-semibold">{title}</p><div className="world-body">{children}</div></div>;
}

function Choose({ list, pick, setPick }: { list: LiteWorkspace[]; pick: string | null; setPick: (id: string) => void }) {
  return (
    <fieldset className="grid gap-2">{/* grid gap, not space-y: the per-item wrappers are display:contents */}
      <legend className="world-body mb-2">Only workspaces SkillForge can read are offered. Discovery opens them read-only.</legend>
      {/* company workspaces first; engineering test fixtures stay selectable under their own heading */}
      {[...list].sort((a, b) => Number(a.kind.includes("fixture")) - Number(b.kind.includes("fixture"))).map((w, i, all) => (
        <div key={w.id} className="contents">
        {w.kind.includes("fixture") && !all[i - 1]?.kind.includes("fixture")
          ? <p className="world-muted pt-3 text-meta font-semibold">Test fixtures (used by engineers to check edge cases)</p> : null}
        <label className={`world-card flex items-start gap-3 p-3 ${w.supported ? "cursor-pointer" : "opacity-70"}`}>
          <input type="radio" name="ws" value={w.id} checked={pick === w.id} disabled={!w.supported} onChange={() => setPick(w.id)} className="mt-1 size-4" />
          <span className="min-w-0">
            <span className="font-semibold [overflow-wrap:anywhere]">{w.name.untrusted_text}</span> <span className="world-muted text-meta">({w.kind})</span>
            <span className="block font-mono text-[0.75rem] world-muted [overflow-wrap:anywhere]">{w.file}</span>
            {w.supported ? null : <span className="block text-meta world-warn">Not supported: {w.why_not}</span>}
          </span>
        </label>
        </div>
      ))}
    </fieldset>
  );
}

function Discovery({ d }: { d: LiteDiscovery }) {
  const e = d.manifest.environment;
  const rows: [string, ReactNode][] = [
    ["Workspace (name from the file)", e.name.untrusted_text],
    ["What it says about itself", e.description.untrusted_text],
    ["Records read", `${e.records} (${e.record_kinds.join(", ")})`],
    ["Evidence sources", e.evidence_sources.join(", ")],
    ["Tools the agent would have", `${Object.keys(d.manifest.tool_inventory).length}: ${Object.keys(d.manifest.tool_inventory).join(", ")}`],
    ["Writes performed", String(d.writes_performed)],
    ["Health checked", d.status_checked_at ? new Date(d.status_checked_at * 1000).toLocaleTimeString() : "no answer (unknown, shown as unavailable)"],
  ];
  return (
    <div className="space-y-4">
      <dl className="world-card grid gap-x-4 gap-y-2 p-4 text-meta sm:grid-cols-[auto_1fr]" aria-label="Discovery results">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold">{k}</dt><dd className="world-muted [overflow-wrap:anywhere]">{v}</dd></div>)}
      </dl>
      <details className="world-card p-3 text-meta">
        <summary className="cursor-pointer font-semibold">What discovery could not establish ({d.manifest.unverified_assumptions.length})</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 world-muted">{d.manifest.unverified_assumptions.map((u) => <li key={u}>{u}</li>)}</ul>
      </details>
    </div>
  );
}

function Roles({ d }: { d: LiteDiscovery }) {
  const caps = d.capabilities.filter((c) => c.state !== "illustrative");
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="world-card space-y-2 p-4"><h3 className="font-semibold">Ember (the AI agent) may</h3>
          <p className="text-meta world-muted">{d.manifest.roles.agent.join(", ")}</p></div>
        <div className="world-card space-y-2 p-4"><h3 className="font-semibold">Only a person may</h3>
          <p className="text-meta world-muted">{d.manifest.roles.human_only.join(", ")}</p></div>
      </div>
      <ItemList items={caps} label="Capabilities in this workspace" />
      <h3 className="world-h3 pt-2">Examples, not part of this workspace</h3>
      <ItemList items={d.capabilities.filter((c) => c.state === "illustrative")} label="Illustrative examples" />
    </div>
  );
}

function Permissions({ d }: { d: LiteDiscovery }) {
  return (
    <div className="space-y-6">
      <ItemList items={d.workflows} label="Proposed workflows" />
      <div className="world-card overflow-x-auto p-4">
        <table className="w-full text-left text-meta">
          <caption className="mb-2 text-left font-semibold">Permissions this workspace would need (none are granted by onboarding)</caption>
          <thead><tr><th scope="col" className="pr-3">Permission</th><th scope="col" className="pr-3">Who decides</th><th scope="col" className="pr-3">Granted</th><th scope="col">How</th></tr></thead>
          <tbody>
            {d.permissions.map((p) => (
              <tr key={p.action} className="world-pop-item align-top">
                <td className="py-1.5 pr-3 font-semibold">{p.action}{p.fields.length ? ` (${p.fields.join(", ")})` : ""}</td>
                <td className="py-1.5 pr-3">{p.human_approval ? "a person, every time" : "policy"}</td>
                <td className="py-1.5 pr-3 world-warn font-semibold">{p.granted ? "Yes" : "No"}</td>
                <td className="py-1.5 font-mono text-[0.75rem] [overflow-wrap:anywhere]">{p.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Office({ d, theme, desktop }: { d: LiteDiscovery; theme: ThemeName; desktop: boolean }) {
  const items = [...d.capabilities, ...d.workflows].filter((c) => c.room);
  const at = (r: Dept) => P(...FOCUS[r]);
  return (
    <div className="space-y-4">
      <div className={`world-scene-frame relative overflow-hidden ${desktop ? "h-[26rem]" : "h-64"}`}>
        <Scene state={EMPTY} theme={theme} focus={null} onOpen={() => {}} open={null} label="Your office, with nothing running yet" still />
        <svg viewBox={VIEW} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden fontFamily="Schibsted Grotesk Variable, system-ui, sans-serif">
          {ROOMS.map((r) => {
            const here = items.filter((c) => c.room === r);
            const n = here.filter((c) => c.state === "active").length;
            const [x, y] = at(r);
            return (
              <g key={r} transform={`translate(${x} ${y + 30})`}>
                <rect x={-52} y={-11} width={104} height={22} rx={3} fill="#fff" stroke="#14203A" strokeWidth={1.5} />
                <text textAnchor="middle" y={4} fontSize={10} fontWeight={650} fill="#14203A">
                  {r === "review" && !here.length ? `${d.permissions.filter((p) => !p.granted).length} not granted` : `${n} active of ${here.length}`}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="grid gap-3 md:grid-cols-2" aria-label="Rooms">
        {ROOMS.map((r) => (
          <li key={r} className="world-card space-y-2 p-3">
            <h3 className="font-semibold">{DEPTS[r].name}</h3>
            <ul className="space-y-1.5 text-meta">
              {items.filter((c) => c.room === r).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2"><span>{c.name}</span><StateBadge state={c.state} /></li>
              ))}
              {r === "review" ? d.permissions.map((p) => (
                <li key={p.action} className="flex flex-wrap items-center justify-between gap-2"><span>A person decides: {p.action}</span>
                  <span className="world-chip world-warn font-semibold">{p.granted ? "Granted" : "Not granted"}</span></li>
              )) : null}
              {items.some((c) => c.room === r) || r === "review" ? null : <li className="world-muted">Nothing here yet.</li>}
            </ul>
          </li>
        ))}
      </ul>
      <div className="world-card space-y-2 p-4" data-testid="what-next">
        <h3 className="font-semibold">What happens next</h3>
        <p className="world-body">Onboarding switched nothing on. Work starts when an employee&apos;s request arrives: if an Active skill matches it exactly, the skill proposes changes without the model, a person approves each one on this host, and the independent check verifies it. Anything else is handed to a person, or waits for the local model.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {/* ponytail: selects the Live source of the office replay below by its radio; no shared state for one link */}
        <a href="#replay" onClick={(e) => { e.preventDefault(); document.querySelector<HTMLInputElement>("#replay input[value=live]")?.click(); document.getElementById("replay")?.scrollIntoView(); }} className="world-btn world-btn-primary">Watch this system live</a>
        <a href="#story" onClick={(e) => { e.preventDefault(); document.getElementById("story")?.scrollIntoView(); }} className="world-btn">Continue to the office</a>
        <a href="#/console" className="world-btn">Open the console</a>
      </div>
    </div>
  );
}

export function BootstrapLite({ theme, desktop }: { theme: ThemeName; desktop: boolean }) {
  const [step, setStep] = useState(0);
  const [list, setList] = useState<LiteWorkspace[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [d, setD] = useState<LiteDiscovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ reason: string; detail: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    live.workspaces().then((r) => {
      if (!r.ok) return setErr(r);
      setList(r.data.workspaces);
      setPick(r.data.workspaces.find((w) => w.supported)?.id ?? null);
    });
  }, []);
  useEffect(() => { if (moved.current) heading.current?.focus(); moved.current = true; }, [step]);

  const discover = async () => {
    if (!pick) return;
    setBusy(true); setErr(null); setD(null); setStep(1);
    const r = await live.discover(pick);
    setBusy(false);
    if (r.ok) setD(r.data); else setErr(r);
  };
  const reachable = (i: number) => i === 0 || (d !== null && !busy) || (i === 1 && busy);

  return (
    <section aria-labelledby="bl-h" className={`mx-auto max-w-[60rem] space-y-6 ${desktop ? "px-6" : "px-4"} pt-8 pb-14`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-meta">
          {list || d ? <SourceTag source="live" /> : null}
          <span className="world-muted">Read-only. Nothing on this page connects, grants permissions or writes.</span>
          <a className="world-link" href="#/world/bootstrap">See the illustrated version</a>
        </div>
        <h1 className="world-h1 text-balance">Set up SkillForge on your workspace</h1>
      </div>
      <nav aria-label="Onboarding steps">
        <ol className="world-key flex flex-wrap gap-1 p-1">
          {STEPS.map((s, i) => (
            <li key={s}><button type="button" disabled={!reachable(i)} onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined}
              className={`world-seg-item text-meta disabled:cursor-not-allowed disabled:opacity-50 ${step === i ? "is-on" : ""}`}>{i + 1}. {s}</button></li>
          ))}
        </ol>
      </nav>
      <div className="space-y-5" aria-busy={busy}>
        <h2 id="bl-h" ref={heading} tabIndex={-1} className="world-h2 outline-none">Step {step + 1} of {STEPS.length}: {STEPS[step]}</h2>
        {err ? (
          PREVIEW ? <Problem title="Not available in the read-only preview"><p>Onboarding reads a real workspace on the host. This hosted preview has no host, so nothing is shown rather than an example. <a className="world-link" href="#/world/bootstrap">See the illustrated version</a>.</p></Problem> :
          <Problem title={err.reason === "unauthorized" ? "Not signed in to this machine's console" : err.reason === "unreachable" ? "The Bootstrap Lite service isn't running" : "Discovery failed"}>
            <p>{err.detail}</p>
            <p className="mt-2">Start it on the host, then open the one-time link it prints:</p>
            <CopyCommand cmd="python3 -m experiments.bootstrap_lite" />
            <p className="mt-2 text-meta">This page never shows example data in place of a real answer.</p>
          </Problem>
        ) : null}
        {step === 0 ? (list ? (
          <>
            <Choose list={list} pick={pick} setPick={setPick} />
            <button type="button" className="world-btn world-btn-primary" disabled={!pick || busy} onClick={discover}>Run read-only discovery</button>
          </>
        ) : err ? null : <p className="world-body" role="status">Loading workspaces…</p>) : null}
        {step === 1 && busy ? <p className="world-body" role="status">Reading the workspace (read-only)…</p> : null}
        {d && step > 0 ? <ActiveNow d={d} /> : null}
        {d && step === 1 ? <Discovery d={d} /> : null}
        {d && step >= 2 ? <Legend /> : null}
        {d && step === 2 ? <Roles d={d} /> : null}
        {d && step === 3 ? <Permissions d={d} /> : null}
        {d && step === 4 ? <Office d={d} theme={theme} desktop={desktop} /> : null}
        {d && step < 4 ? (
          <div className="flex flex-wrap gap-3">
            {step > 0 ? <button type="button" className="world-btn" onClick={() => setStep(step - 1)}>Back</button> : null}
            {step > 0 ? <button type="button" className="world-btn world-btn-primary" onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1]}</button> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
