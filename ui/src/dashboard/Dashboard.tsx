import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Blocks, Check, ChevronRight, CircleHelp, FileText, Flame, FolderOpen, GitBranch, History, House, Layers3, ListTodo, Play, Plus, Search, Settings2, ShieldCheck, Sparkles, X, type LucideIcon } from "lucide-react";
import { Mascot } from "../world/Mascot";
import type { MascotState } from "../world/sprites";
import { useLive } from "../data/useLive";
import { PREVIEW } from "../lib/preview";
import RecordedTasks from "./RecordedTasks";
import archivedRun from "./gb10-record.display.json";
import DemoJourney from "./DemoJourney";
import DraftEditor from "./DraftEditor";
import "./dashboard.css";
import "./demo-journey.css";

const RunEvidence = lazy(() => import("./RunEvidence"));
type Tab = "overview" | "tasks" | "skills" | "activity" | "evidence" | "settings";
type Draft = { id: string; text: string; createdAt: string };
type NodeKey = "sources" | "investigate" | "review" | "verify" | "skills" | "runtime";
const NAV: { id: Tab; label: string; icon: LucideIcon }[] = [{ id: "overview", label: "Overview", icon: House }, { id: "tasks", label: "Tasks", icon: ListTodo }, { id: "skills", label: "Skill library", icon: Blocks }, { id: "activity", label: "Activity", icon: History }, { id: "evidence", label: "Proof", icon: ShieldCheck }];
const NODES: { id: NodeKey; label: string; sub: string; icon: LucideIcon; x: number; y: number; text: string }[] = [
  { id: "sources", label: "Your sources", sub: "Where work begins", icon: FolderOpen, x: 17, y: 27, text: "Source records and incident evidence enter here. Connections appear only after your local system reports them." },
  { id: "investigate", label: "Investigation", sub: "Understand the problem", icon: Search, x: 49, y: 13, text: "Ember reads the available evidence and drafts a bounded proposal. The model does not approve its own work." },
  { id: "review", label: "Your review", sub: "You stay in control", icon: ShieldCheck, x: 82, y: 29, text: "Inspect the proposed change and supporting evidence. Live approval takes place on your host through the existing console workflow." },
  { id: "verify", label: "Verification", sub: "Check the work", icon: GitBranch, x: 83, y: 73, text: "Independent checks validate the result. A failed check stops progress; an animation never determines whether a test passed." },
  { id: "skills", label: "Skill library", sub: "Learn once. Use again.", icon: Blocks, x: 49, y: 87, text: "Verified, human-approved skills are retained with a pinned version. Compatible future work can reuse that code without a new model call." },
  { id: "runtime", label: "Local engine", sub: "Built to run on your machine", icon: Layers3, x: 16, y: 73, text: "The existing local runtime handles model inference and tools. Connect it in workspace settings to see actual tasks, checks, and skills." },
];
const PHASES: { name: string; detail: string; state: MascotState; node: NodeKey }[] = [
  { name: "Reading the evidence", detail: "Ember checks the logs and the most recent deployment.", state: "investigating", node: "sources" },
  { name: "Finding the cause", detail: "A setting raised concurrent sequences from 128 to 1024. Ember prepares a bounded fix.", state: "investigating", node: "investigate" },
  { name: "Ready for your review", detail: "Ember proposes reverting one setting. You decide whether the work continues.", state: "waiting", node: "review" },
  { name: "Checking the proposed fix", detail: "Independent checks verify that the proposed fix addresses the incident.", state: "verifying", node: "verify" },
  { name: "A new skill, ready to reuse", detail: "The verified approach becomes a versioned skill for the next compatible problem.", state: "verified", node: "skills" },
  { name: "Reusing the learned skill", detail: "A matching incident takes the learned skill path instead of asking the model again.", state: "building", node: "skills" },
  { name: "Same problem. No new model call.", detail: "The learned skill handles the compatible example. Now see what happens when a different problem looks similar.", state: "verified", node: "skills" },
  { name: "Lookalike safely refused", detail: "The fingerprint differs. The example stops instead of applying an incompatible fix.", state: "error", node: "verify" },
];
function readDrafts(): Draft[] {
  try { const value: unknown = JSON.parse(localStorage.getItem("sf.dashboard.drafts.v1") ?? "[]"); return Array.isArray(value) ? value.filter((d): d is Draft => typeof d?.id === "string" && typeof d?.text === "string" && typeof d?.createdAt === "string").slice(0, 100) : []; } catch { return []; }
}
function currentTab(): Tab { const id = window.location.hash.split("/")[2]; return ["tasks", "skills", "activity", "evidence", "settings"].includes(id) ? id as Tab : "overview"; }
function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: string }) { return <span className={`ed-tag ed-tag-${tone}`}>{children}</span>; }

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>(currentTab);
  const [source, setSource] = useState<"demo" | "live">("demo");
  const data = useLive(source === "live");
  const [drafts, setDrafts] = useState<Draft[]>(readDrafts);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [selected, setSelected] = useState<NodeKey | null>(null);
  const [phase, setPhase] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const editDraft = drafts.find((d) => d.id === editing);
  const [demoEvents, setDemoEvents] = useState<{ id: string; name: string; at: string }[]>([]);
  const movePhase = useCallback((next: number) => { setPhase(next); setDemoEvents((events) => [{ id: crypto.randomUUID(), name: PHASES[next].name, at: new Date().toISOString() }, ...events].slice(0, 50)); }, []);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const liveMode = source === "live";
  const connected = liveMode && data.conn === "connected";
  const p = phase === null ? null : PHASES[phase];
  const liveState: MascotState = !connected ? "idle" : data.approvals.length ? "waiting" : data.tasks.some((t) => t.status === "open") ? "investigating" : "idle";
  const ember = liveMode ? liveState : p?.state ?? "idle";
  const activeNode = liveMode ? connected ? data.approvals.length ? "review" : data.tasks.some((t) => t.status === "open") ? "investigate" : null : null : p?.node ?? null;
  const openTasks = data.tasks.filter((t) => t.status === "open");
  const taskCount = liveMode ? connected ? data.tasks.length : 0 : drafts.length;

  const liveSkills = data.skills.filter((s) => s.active && s.status === "approved");
  const title = NAV.find((n) => n.id === tab)?.label ?? "Workspace settings";

  useEffect(() => { const h = () => { setTab(currentTab()); setQuery(""); window.scrollTo({ top: 0 }); }; window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  useEffect(() => { try { localStorage.setItem("sf.dashboard.drafts.v1", JSON.stringify(drafts)); } catch { /* surfaced by the save action */ } }, [drafts]);
  useEffect(() => {
    if (liveMode || !playing || phase === null || phase === 2 || phase === 4 || phase === 6 || phase === PHASES.length - 1) return;
    const timer = window.setTimeout(() => movePhase(phase + 1), 2200);
    return () => window.clearTimeout(timer);
  }, [phase, playing, liveMode, movePhase]);

  const go = (next: Tab) => { window.location.hash = next === "overview" ? "/dashboard" : `/dashboard/${next}`; };
  const saveNewDraft = (text: string) => {
    const next = [{ id: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString() }, ...drafts].slice(0, 100);
    let saved = true;
    try { localStorage.setItem("sf.dashboard.drafts.v1", JSON.stringify(next)); } catch { saved = false; }
    setStorageError(!saved); setDrafts(next); setCreating(false); go("tasks");
    setNotice(saved ? "Task draft saved on this browser." : "Task kept for this visit. Browser storage is unavailable.");
  };
  const startDemo = () => { movePhase(0); setPlaying(true); setSelected(null); };
  const modeChange = (value: "demo" | "live") => { setSource(value); setPlaying(false); setPhase(null); setSelected(null); };
  const newTask = () => setCreating(true);

  return <div className="ed-app">
    <aside className="ed-sidebar" aria-label="Workspace navigation">
      <a className="ed-brand" href="#/dashboard"><span className="ed-brand-icon"><Flame size={23} /></span> <span>Skill<span className="ed-brand-green">Forge</span></span></a>
      <button className="ed-workspace" onClick={() => go("settings")}><span className="ed-workspace-avatar">P</span><span>Personal workspace<small>Your space to build</small></span><ChevronRight size={14} /></button>
      <p className="ed-nav-label">Workspace</p>
      <nav>{NAV.map(({ id, label, icon: Icon }) => <a key={id} href={`#/dashboard${id === "overview" ? "" : `/${id}`}`} aria-current={tab === id ? "page" : undefined}><Icon size={18} /><span>{label}</span>{id === "tasks" && taskCount > 0 ? <span className="ed-count">{taskCount}</span> : null}</a>)}</nav>
      <div className="ed-sidebar-bottom">
        <div className="ed-sidebar-ember"><Mascot state={ember} px={1.8} /><p>Small spark.<br /><strong>Growing possibilities.</strong></p></div>
        <a href="#/story"><CircleHelp size={17} /> How SkillForge works<ArrowUpRight size={14} /></a>
        <a href="#/dashboard/settings" aria-current={tab === "settings" ? "page" : undefined}><Settings2 size={17} /> Settings</a>
        <div className="ed-profile"><span>P</span><div>Personal workspace<small>Local first</small></div><span className="ed-profile-dot" /></div>
      </div>
    </aside>
    <div className="ed-body">
      <header className="ed-header"><div><span className="ed-breadcrumb">Workspace</span><ChevronRight size={13} /><span>{title}</span></div><div className="ed-header-tools"><label className="ed-source"><span className={`ed-status-dot ${connected ? "is-connected" : ""}`} /><span className="sr-only">Data source</span><select aria-label="Data source" value={source} onChange={(e) => modeChange(e.target.value as "demo" | "live")}><option value="demo">Demo workspace</option><option value="live">Local system</option></select></label><button className="ed-avatar" onClick={() => go("settings")} aria-label="Workspace settings">P</button></div></header>
      <main id="main" tabIndex={-1} className="ed-main">
        <div className="ed-page-heading"><div><p className="ed-eyebrow">Your living workspace</p><h1>{tab === "overview" ? <>Agents respond. <span>SkillForge remembers.</span></> : title}</h1><p>{tab === "overview" ? "Meet Ember. Turn one verified fix into a reusable skill." : tab === "tasks" ? "A clear place for everything you want to get done." : tab === "skills" ? "Work done once becomes a capability you can use again." : tab === "activity" ? "Follow the work, from the first spark to the final check." : tab === "evidence" ? "Inspect what happened, what passed, and what was refused." : "Make this workspace yours, one connection at a time."}</p></div>{tab === "overview" ? <button className="ed-button ed-button-subtle" onClick={() => go("evidence")}><ShieldCheck size={15} />View proof</button> : <button className="ed-button ed-button-primary" onClick={newTask}><Plus size={16} />New task</button>}</div>
        {liveMode && !connected ? <div className="ed-connection-note" role="status"><span className="ed-status-dot" /><span>{data.conn === "connecting" ? "Connecting to your local system…" : data.conn === "unauthorized" ? "Your local system needs a sign-in. Open the login link provided by your host." : "Your local system is unavailable. Saved tasks are still here."}</span><button onClick={() => go("settings")}>Connection settings <ArrowUpRight size={14} /></button></div> : null}
        {liveMode && connected ? <p className="ed-freshness">Updated {data.lastOk ? new Date(data.lastOk).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} · {data.status?.inference.ok === true ? "Model available" : data.status?.inference.ok === false ? "Model unavailable" : "Model status unknown"}</p> : null}

        {tab === "overview" ? <DemoJourney phase={phase} playing={playing} ember={ember} activeNode={activeNode} selected={selected} nodes={NODES} live={liveMode} connected={connected}
          name={liveMode ? connected ? data.approvals.length ? "A decision needs you" : openTasks.length ? `${openTasks.length} open tasks` : "Ready when you are" : "Waiting for connection" : p?.name ?? "Meet Ember."}
          detail={liveMode ? connected ? data.approvals.length ? "Review the proposed changes in your local console." : "Your local system’s tasks and skills are available in the workspace." : "Connect your local system in Settings to see its activity." : p?.detail ?? "A service is failing after a configuration change. Watch Ember investigate, check the fix, and learn a skill."}
          onSelect={(id) => setSelected(id as NodeKey | null)} onStart={startDemo} onToggle={() => setPlaying(!playing)} onAdvance={(next) => { movePhase(next); setPlaying(true); }} onProof={() => go("evidence")} onTasks={() => go("tasks")} /> : null}

        {tab === "tasks" && !liveMode ? <RecordedTasks query={query} onOpen={() => go("evidence")} /> : null}
        {tab === "tasks" ? <section className="ed-panel ed-list-panel"><div className="ed-panel-heading"><h2>{liveMode ? "Local tasks" : "Saved drafts"}<Tag>{liveMode ? connected ? data.tasks.length : "—" : drafts.length}</Tag></h2><label className="ed-search"><Search size={15} /><input aria-label="Search tasks" placeholder="Find a task…" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>{liveMode ? !connected ? <Empty icon={Layers3} title="Waiting for your local system" text="Task data will appear after a successful connection. Your browser drafts remain in the demo workspace." /> : data.tasks.filter((t) => t.label.toLowerCase().includes(query.toLowerCase())).length ? data.tasks.filter((t) => t.label.toLowerCase().includes(query.toLowerCase())).map((t) => <a key={t.id} href={`?source=live&task=${t.id}#/console/investigations`} className="ed-task-row"><span className="ed-row-icon"><ListTodo size={18} /></span><div><strong>{t.label}</strong><small>Task {t.id} · {t.model ?? "No model reported"}</small></div><Tag>{t.status}</Tag><ChevronRight size={15} /></a>) : <Empty icon={ListTodo} title="No matching tasks" text="Tasks reported by your local system will appear here." /> : drafts.filter((d) => d.text.toLowerCase().includes(query.toLowerCase())).length ? drafts.filter((d) => d.text.toLowerCase().includes(query.toLowerCase())).map((d) => <div key={d.id} className="ed-task-row"><span className="ed-row-icon"><FileText size={18} /></span><div><button className="ed-task-title" onClick={() => setEditing(d.id)}>{d.text}</button><small>{new Date(d.createdAt).toLocaleString()} · saved on this browser</small></div><Tag>Draft</Tag><button className="ed-icon-button" aria-label={`Delete draft: ${d.text}`} onClick={() => setDrafts(drafts.filter((x) => x.id !== d.id))}><X size={15} /></button></div>) : <Empty icon={ListTodo} title={query ? "No matching drafts" : "A fresh start"} text="Create a task draft to keep your next idea close. Drafts are saved on this browser." />}</section> : null}
        {tab === "skills" ? <section className="ed-panel ed-list-panel"><div className="ed-panel-heading"><h2>{liveMode ? "Approved skills" : "Skills that remember the work"}</h2><Tag>{liveMode ? connected ? `${liveSkills.length} available` : "Unavailable" : "Recorded GB10 run"}</Tag></div>{liveMode && !connected ? <Empty icon={Blocks} title="Your library will live here" text="Connect your local system to see its active, approved skills." /> : liveMode && !liveSkills.length ? <Empty icon={Blocks} title="Space for your first skill" text="Skills appear here after verification and host approval." /> : (liveMode ? liveSkills.map((s) => ({ id: `${s.name}-${s.version}`, name: s.name, description: s.description, version: s.version, hash: s.sha256, detail: `Recorded runs: ${s.runs.total}. Hidden validation: ${s.hidden_ok === true ? "passed" : s.hidden_ok === false ? "failed" : "not reported"}.` })) : [{ id: "recorded", name: archivedRun.synthesis.skill_name, description: "Recognizes a compatible serving-configuration failure and proposes the checked recovery path.", version: Number(archivedRun.synthesis.skill_version), hash: archivedRun.synthesis.skill_hash, detail: "This archived skill passed 9/9 hidden checks and was approved on the host. Only compatible incident fingerprints can reuse it. Switch to Local system to inspect the current registry." }]).map((s) => <article className="ed-skill-card" key={s.id}><div className="ed-skill-card-icon"><Blocks size={24} /></div><div><h3>{s.name}</h3><p>{s.description}</p><div className="ed-skill-meta"><Tag>{`Version ${s.version}`}</Tag><span><ShieldCheck size={13} />{liveMode ? "Host approved" : "Recorded host approval"}</span></div><button className="ed-text-button" aria-expanded={expandedSkill === s.id} onClick={() => setExpandedSkill(expandedSkill === s.id ? null : s.id)}>{expandedSkill === s.id ? "Hide details" : "View details"}<ChevronRight size={14} /></button>{expandedSkill === s.id ? <div className="ed-skill-detail"><p>{s.detail}</p>{s.hash ? <code>sha256: {s.hash}</code> : null}</div> : null}</div></article>)}</section> : null}
        {tab === "activity" ? <section className="ed-panel ed-list-panel"><div className="ed-panel-heading"><h2>Workspace activity</h2><Tag>{liveMode ? connected ? "Local audit events" : "Unavailable" : demoEvents.length ? "This visit" : "Recorded GB10 run"}</Tag></div>{liveMode ? !connected || !data.events.length ? <Empty icon={History} title={connected ? "Nothing to catch up on" : "Waiting for a connection"} text="Your local system’s audit events will appear here." /> : [...data.events].reverse().slice(0, 50).map((e) => <div className="ed-task-row" key={e.id}><span className="ed-row-icon"><GitBranch size={17} /></span><div><strong>{e.event}</strong><small>{e.ts} · {e.actor}</small></div><Tag>#{e.id}</Tag></div>) : <>{demoEvents.map((event) => <div className="ed-task-row" key={event.id}><span className="ed-row-icon"><Play size={17} /></span><div><strong>{event.name}</strong><small>{new Date(event.at).toLocaleTimeString()} · interactive example · no real task executed</small></div><Tag>Demo</Tag></div>)}{drafts.map((d) => <div className="ed-task-row" key={d.id}><span className="ed-row-icon"><FileText size={17} /></span><div><strong>Saved a task draft</strong><small>{d.text} · {new Date(d.createdAt).toLocaleString()}</small></div><Tag>Browser</Tag></div>)}{!demoEvents.length ? [...archivedRun.audit].reverse().map((event, index) => <div className="ed-task-row" key={`recorded-${index}`}><span className="ed-row-icon"><GitBranch size={17} /></span><div><strong>{event.event}</strong><small>{event.t} · {event.detail}</small></div><Tag>Recorded</Tag></div>) : null}</>}</section> : null}
        {tab === "evidence" ? <Suspense fallback={<p className="ed-freshness" aria-busy="true">Loading run evidence…</p>}><RunEvidence /></Suspense> : null}
        {tab === "settings" ? <section className="ed-panel ed-settings"><div className="ed-panel-heading"><h2>Workspace connection</h2><Tag>{liveMode ? connected ? "Connected" : "Not connected" : "Demo"}</Tag></div><h3>Choose what you see</h3><p>Explore the interface now, then bring your local system into the same workspace.</p><div className="ed-mode-options"><button aria-pressed={!liveMode} onClick={() => modeChange("demo")}><Sparkles size={22} /><strong>Demo workspace</strong><span>An interactive example and your browser drafts.</span><span className="ed-radio">{!liveMode ? <Check size={12} /> : null}</span></button><button aria-pressed={liveMode} onClick={() => modeChange("live")}><Layers3 size={22} /><strong>Local system</strong><span>Actual tasks, reviews, skills, and audit activity.</span><span className="ed-radio">{liveMode ? <Check size={12} /> : null}</span></button></div><div className="ed-settings-status"><div><span>Local connection</span><Tag>{connected ? "Connected" : liveMode && data.conn === "connecting" ? "Connecting" : "Not connected"}</Tag></div><div><span>Model</span><span>{liveMode && connected ? data.status?.inference.model ?? "Not reported" : "Not connected"}</span></div><div><span>Task submission</span><span>Browser drafts</span></div></div><p className="ed-settings-help">{PREVIEW ? "This hosted build has no local host connection. Run the app with your local operator service to use Local system mode." : "Local system mode uses the existing operator service and its host sign-in. Start that service and open its login link to connect."} Live changes continue through the host’s review workflow.</p><div className="ed-settings-links"><a className="ed-button ed-button-subtle" href="#/world/onboard">Set up your workspace<ArrowUpRight size={14} /></a><a className="ed-text-button" href="#/console/system">System details<ArrowUpRight size={14} /></a></div></section> : null}
        {creating ? <DraftEditor text="" createdAt={new Date().toISOString()} title="New task" onSave={saveNewDraft} onClose={() => setCreating(false)} /> : null}
        {editDraft ? <DraftEditor key={editDraft.id} text={editDraft.text} createdAt={editDraft.createdAt} onClose={() => setEditing(null)} onSave={(text) => { const next = drafts.map((d) => d.id === editDraft.id ? { ...d, text } : d); let saved = true; try { localStorage.setItem("sf.dashboard.drafts.v1", JSON.stringify(next)); } catch { saved = false; } setDrafts(next); setEditing(null); setStorageError(!saved); setNotice(saved ? "Task draft updated." : "Draft updated for this visit. Browser storage is unavailable."); }} /> : null}
        <p className="ed-notice" role={storageError ? "alert" : "status"}>{notice}</p>
        <footer className="ed-footer"><span><Flame size={13} />Made to remember the useful work.</span><span>SkillForge <span className="ed-footer-dot">·</span> Your workspace, your control</span></footer>
      </main>
    </div>
  </div>;
}
function Empty({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) { return <div className="ed-empty"><span><Icon size={25} /></span><h3>{title}</h3><p>{text}</p></div>; }
