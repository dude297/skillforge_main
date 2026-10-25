// EXPERIMENT (exp/world): Ember + the isometric company. Three clearly separated sources:
//   1. the scroll story: an illustration (scripted, labelled)
//   2. "Watch a real run": a recorded backend run (sanitized operator-API export), or Live when this page is served by
//      `python -m app ui` with a session. The scene never fills a live gap with story events.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, X } from "lucide-react";
import { Mascot } from "./Mascot";
import { Scene } from "./Scene";
import { BEATS, DEPTS, STORY, consoleLink, fromAudit, fromOnCallAudit, normalize, sceneState, type Dept, type VizEvent, type VizSource } from "./events";
import { STATES, type MascotState } from "./sprites";
import { THEMES, type ThemeName } from "./theme";
import recorded from "./recorded-run.json";
import { live, type LiveEvent } from "../data/live";
import { useLive } from "../data/useLive";
import { useOnCall } from "../data/useOnCall";
import { PREVIEW } from "../lib/preview";
import "./world.css";

const RECORDED: VizEvent[] = normalize((recorded.events as LiveEvent[]).map(fromAudit));

const SOURCE_LABEL: Record<VizSource, { text: string; cls: string; hint: string }> = {
  story: { text: "Illustration", cls: "world-tag-story", hint: "A scripted story of how the system works. Not a run." },
  recorded: { text: "Recorded run", cls: "world-tag-recorded", hint: `A real backend run captured through the read-only API. Agent: scripted mock, no model.` },
  live: { text: "Live", cls: "world-tag-live", hint: "This system right now, through the read-only operator API." },
  oncall: { text: "OnCall run", cls: "world-tag-recorded", hint: "The OnCall run's audit trail. Its mode banner in the guided demo says whether a model or a recorded reference wrote the code." },
};

export function SourceTag({ source, stale = false }: { source: VizSource; stale?: boolean }) {
  const s = SOURCE_LABEL[source];
  return (
    <span title={stale ? "Connection lost: this is the last state received, not now" : s.hint} className={`world-tag ${stale ? "world-tag-stale" : s.cls}`}>
      {s.text}{stale ? " (connection lost)" : ""}<span className="sr-only">: {stale ? "the last state received, not now" : s.hint}</span>
    </span>
  );
}

/** "How to read the office": the cast and the colours, always next to the scene */
function Key() {
  const sw = (c: string) => <span aria-hidden className="inline-block size-3 shrink-0 rounded-[2px] border border-[#14203A]" style={{ background: c }} />;
  return (
    <dl className="world-key grid grid-cols-2 gap-x-5 gap-y-1.5 text-meta sm:grid-cols-4" aria-label="How to read the office">
      <div className="flex items-center gap-2"><dt className="flex items-center gap-2"><Mascot state="idle" px={1} title="Ember" still /><span className="font-semibold">Ember</span></dt><dd className="world-muted">the AI agent</dd></div>
      <div className="flex items-center gap-2"><dt className="font-semibold">Person at the desk</dt><dd className="world-muted">approves every change</dd></div>
      <div className="flex items-center gap-2"><dt className="flex items-center gap-1">{sw("#4FB7F0")}{sw("#3FCF95")}{sw("#E35D6A")}<span className="font-semibold">Gate</span></dt><dd className="world-muted">checking, verified, failed</dd></div>
      <div className="flex items-center gap-2"><dt className="flex items-center gap-1">{sw("#F1AD64")}{sw("#3FCF95")}<span className="font-semibold">Shelf</span></dt><dd className="world-muted">skill waiting, skill in use</dd></div>
      <div className="flex items-center gap-2 sm:col-span-4"><dt className="font-semibold">Blinking rack lights</dt><dd className="world-muted">decorative; everything else is driven by events</dd></div>
    </dl>
  );
}

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Evidence for one department: what it is, and the events of the current run that happened there. */
function Popover({ dept, events, source, onClose }: { dept: Dept; events: VizEvent[]; source: VizSource; onClose: () => void }) {
  const link = consoleLink(source, dept, events.filter((e) => e.dept === dept).at(-1)?.task);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; // the department that opened it
    ref.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };  // closing returns focus there
  }, [dept]);
  const here = events.filter((e) => e.dept === dept).slice(-4).reverse();
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="pop-h"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className="world-pop relative z-10 w-full space-y-3 p-4 outline-none md:absolute md:top-12 md:right-3 md:w-[min(22rem,calc(100%-1.5rem))]">
      <div className="flex items-start justify-between gap-3">
        <h3 id="pop-h" className="font-semibold">{DEPTS[dept].name}</h3>
        <button type="button" onClick={onClose} className="world-icon-btn" aria-label="Close"><X aria-hidden size={16} /></button>
      </div>
      <p className="text-meta">{DEPTS[dept].role}</p>
      <div className="flex items-center gap-2 text-meta"><span className="world-muted">Evidence from</span><SourceTag source={source} /></div>
      {here.length ? (
        <ul className="space-y-2 text-meta">
          {here.map((e) => (
            <li key={e.id} className="world-pop-item">
              <p className="font-medium">{e.title}</p>
              <p className="world-muted">{e.detail}</p>
              {e.evidence.length ? <p className="font-mono text-[0.75rem] world-muted [overflow-wrap:anywhere]">{e.evidence.join("; ")}</p> : null}
              {source !== "story" && e.task != null ? <a className="world-link text-[0.75rem]" href={consoleLink(source, e.dept, e.task).href}>{consoleLink(source, e.dept, e.task).label}</a> : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-meta world-muted">Nothing has happened here yet in this run.</p>}
      <a className="world-btn h-9 w-full justify-center text-meta" href={link.href}>{link.label}</a>
    </div>
  );
}

export function Hero({ theme }: { theme: ThemeName }) {
  return (
    <section className="world-hero mx-auto grid max-w-6xl items-center gap-10 px-6 pt-14 pb-10 md:grid-cols-[1.1fr_1fr]">
      <div className="space-y-5">
        <h1 className="world-h1 text-balance">Meet Ember. It fixes a problem once, then learns the shortcut.</h1>
        <p className="world-lead max-w-[34rem]">
          Ember is the agent inside SkillForge. It solves new problems with a person watching, proves every fix, and keeps
          what worked as a skill, so the next similar problem takes the short way.
        </p>
        <p className="world-body max-w-[34rem]">Below is a tiny company: problems arrive at intake, Ember works in the local AI room, a person decides at the review desk, an independent gate checks every change, and proven skills go on the library shelf.</p>
        <div className="flex flex-wrap gap-3">
          <a href="#story" onClick={(e) => { e.preventDefault(); document.getElementById("story")?.scrollIntoView(); }} className="world-btn world-btn-primary">Follow one problem</a>
          <a href="#replay" onClick={(e) => { e.preventDefault(); document.getElementById("replay")?.scrollIntoView(); }} className="world-btn">Watch a real run</a>
        </div>
      </div>
      <div className="world-stage-card grid place-items-center p-8">
        <Mascot state="idle" px={theme === "daylight" ? 10 : 9} />
      </div>
    </section>
  );
}

/** desktop: sticky scene + scrolling beats. The beat in the middle of the viewport drives the scene. */
function StoryScroll({ theme }: { theme: ThemeName }) {
  const [beat, setBeat] = useState(0);
  const [open, setOpen] = useState<Dept | null>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) setBeat(Number((en.target as HTMLElement).dataset.beat));
    }, { rootMargin: "-48% 0px -48% 0px" });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const events = useMemo(() => STORY.slice(0, BEATS[beat].end + 1), [beat]);
  const state = useMemo(() => sceneState(events), [events]);
  return (
    <section id="story" aria-labelledby="story-h" className="relative mx-auto grid max-w-[88rem] gap-8 px-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <h2 id="story-h" className="sr-only">One problem, start to finish (illustration)</h2>
      <div className="sticky top-16 h-[calc(100dvh-5rem)] py-4">
        <div className="world-scene-frame relative h-full overflow-hidden">
          <Scene state={state} theme={theme} focus={state.current?.dept ?? null} zoom={1.38} onOpen={setOpen} open={open}
            label={`Illustration, step ${beat + 1} of ${BEATS.length}: ${BEATS[beat].heading}`} />
          <div className="absolute top-3 left-3 flex items-center gap-2"><SourceTag source="story" /><span className="world-chip">Ember: {STATES[state.mascot].label.toLowerCase()}</span></div>
          {open ? <Popover dept={open} events={events} source="story" onClose={() => setOpen(null)} /> : null}
          <div className="world-key-wrap absolute inset-x-3 bottom-3"><Key /></div>
        </div>
      </div>
      <ol className="py-[40dvh]">
        {BEATS.map((b, i) => (
          <li key={b.heading} ref={(el) => { refs.current[i] = el; }} data-beat={i} aria-current={beat === i ? "step" : undefined}
            className={`world-beat mb-[55dvh] space-y-3 border-l-4 pl-5 ${beat === i ? "is-on" : ""}`}>
            <p className="world-step tnum">{String(i + 1).padStart(2, "0")} of {String(BEATS.length).padStart(2, "0")}</p>
            <h3 className="world-h3 text-balance">{b.heading}</h3>
            <p className="world-body">{b.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** mobile: no sticky scroll-scrubbing; each beat is a card with its own small, still scene */
function StoryCards({ theme }: { theme: ThemeName }) {
  return (
    <section id="story" aria-labelledby="story-h-m" className="space-y-6 px-4">
      <div className="flex items-center justify-between gap-3"><h2 id="story-h-m" className="world-h3">One problem, start to finish</h2><SourceTag source="story" /></div>
      <Key />
      <ol className="space-y-6">
        {BEATS.map((b, i) => {
          const st = sceneState(STORY.slice(0, b.end + 1));
          return (
            <li key={b.heading} className="world-card space-y-3 p-4">
              <div className="world-scene-frame h-56 overflow-hidden">
                <Scene state={st} theme={theme} focus={st.current?.dept ?? null} zoom={1.7} onOpen={() => {}} open={null} label={`Illustration: ${b.heading}`} still />
              </div>
              <p className="world-step tnum">{String(i + 1).padStart(2, "0")} of {String(BEATS.length).padStart(2, "0")}</p>
              <h3 className="world-h3 text-balance">{b.heading}</h3>
              <p className="world-body">{b.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Replay of real events with transport controls. Live follows the newest event unless the viewer scrubs. */
function Replay({ theme }: { theme: ThemeName }) {
  const [source, setSource] = useState<"recorded" | "live" | "oncall">("recorded");
  const [apiHere, setApiHere] = useState<boolean | null>(null);
  const oc = useOnCall();
  const oncallEvents = useMemo(() => (oc.state === "ok" ? normalize((oc.run.audit ?? []).map(fromOnCallAudit)) : []), [oc]);
  useEffect(() => { live.health().then((r) => setApiHere(r.ok)); }, []);
  const ld = useLive(source === "live" && apiHere === true);
  const liveEvents = useMemo(() => normalize(ld.events.map(fromAudit)), [ld.events]);
  const all = source === "recorded" ? RECORDED : source === "oncall" ? oncallEvents : liveEvents;
  const [pos, setPos] = useState<number | null>(null); // null = follow the end
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<Dept | null>(null);
  const wide = useMedia("(min-width: 768px)"); // phones: the frame is too short, so the detail goes below it
  const at = Math.min(pos ?? all.length, all.length);
  const running = playing && at < all.length;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setPos((p) => Math.min((p ?? 0) + 1, all.length)), 900);
    return () => window.clearInterval(id);
  }, [running, all.length]);
  const events = useMemo(() => all.slice(0, at), [all, at]);
  const state = useMemo(() => sceneState(events, source === "live" ? ld.approvals.length : 0), [events, source, ld.approvals.length]);
  const step = useCallback((d: number) => { setPlaying(false); setPos((p) => Math.max(0, Math.min(all.length, (p ?? all.length) + d))); }, [all.length]);
  const cur = state.current;
  const liveProblem = source === "oncall" ? (oc.state === "missing" ? `No OnCall run could be loaded (${oc.detail}). Nothing is filled in.` : null)
    : source !== "live" ? null : apiHere === false ? "This page isn't served by the operator API, so there's no live system to show. Nothing is filled in."
    : ld.conn === "unauthorized" ? "Not signed in: open a one-time link from `python -m app ui --link`."
    : ld.conn === "lost" ? `Lost the connection (${ld.error}). Showing what was last received.` : null;

  return (
    <section id="replay" aria-labelledby="replay-h" className="mx-auto max-w-[88rem] space-y-4 px-4 py-16 md:px-6"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input, [role=button], [role=dialog]")) return;
        if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      }}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h2 id="replay-h" className="world-h2">Watch a real run</h2>
          <p className="world-body max-w-[42rem]">The same office, driven by real backend events instead of the illustration. Click a department to see its evidence. Arrow keys step through events.</p>
        </div>
        <fieldset className="world-seg flex p-0.5">
          <legend className="sr-only">Run source</legend>
          {(PREVIEW ? ["recorded", "oncall"] as const : ["recorded", "oncall", "live"] as const).map((s) => (
            <label key={s} className={`world-seg-item ${source === s ? "is-on" : ""}`}>
              <input type="radio" name="world-source" value={s} className="sr-only" checked={source === s} onChange={() => { setSource(s); setPos(null); setPlaying(false); setOpen(null); }} />
              {s === "recorded" ? "Recorded run" : s === "oncall" ? "OnCall run" : "Live"}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="world-scene-frame relative aspect-[8/5] overflow-hidden md:aspect-auto md:h-[min(64dvh,40rem)] md:min-h-80">
          {liveProblem && !all.length ? (
            <p role="status" className="world-body grid h-full place-items-center p-8 text-center">{liveProblem}</p>
          ) : (
            <Scene state={state} theme={theme} focus={null} onOpen={setOpen} open={open}
              label={`${SOURCE_LABEL[source].text}: event ${at} of ${all.length}${cur ? `, ${cur.title}` : ""}`} />
          )}
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2"><SourceTag source={source} stale={source === "live" && ld.conn === "lost"} />{cur ? <span className="world-chip">Ember: {STATES[state.mascot].label.toLowerCase()}</span> : null}</div>
          {all.length ? <div className="world-key-wrap absolute inset-x-3 bottom-3 hidden md:block"><Key /></div> : null}
          {open && wide ? <Popover dept={open} events={events} source={source} onClose={() => setOpen(null)} /> : null}
        </div>
        {open && !wide ? <Popover dept={open} events={events} source={source} onClose={() => setOpen(null)} /> : null}
        <div className="md:hidden"><Key /></div>
        <div className="world-card flex min-h-0 flex-col p-4">
          {liveProblem ? <p role="status" className="world-warn mb-3 text-meta">{liveProblem}</p> : null}
          <div className="flex items-center gap-2">
            <button type="button" className="world-icon-btn" onClick={() => { setPlaying(false); setPos(0); }} aria-label="Restart"><RotateCcw aria-hidden size={16} /></button>
            <button type="button" className="world-icon-btn" onClick={() => step(-1)} aria-label="Previous event"><SkipBack aria-hidden size={16} /></button>
            <button type="button" className="world-btn world-btn-primary h-9 px-3" disabled={!all.length} onClick={() => { if (!running && at >= all.length) setPos(0); setPlaying(!running); }}>
              {running ? <Pause aria-hidden size={16} /> : <Play aria-hidden size={16} />}{running ? "Pause" : at >= all.length ? "Replay" : "Play"}
            </button>
            <button type="button" className="world-icon-btn" onClick={() => step(1)} aria-label="Next event"><SkipForward aria-hidden size={16} /></button>
            <span className="tnum ml-auto text-meta world-muted">{at} of {all.length}</span>
          </div>
          <label className="mt-3 block">
            <span className="sr-only">Replay position</span>
            <input type="range" min={0} max={all.length} value={at} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }}
              className="w-full accent-[var(--color-signal)]" aria-valuetext={`event ${at} of ${all.length}`} />
          </label>
          <div aria-live="polite" className="mt-3 min-h-20 space-y-1">
            {cur ? (<><p className="font-semibold">{cur.title}</p><p className="world-body">{cur.detail}</p>{cur.at ? <p className="tnum text-meta world-muted">{cur.at} UTC{cur.task != null ? `, task ${cur.task}` : ""}</p> : null}
              <a className="world-link text-meta" href={consoleLink(source, cur.dept, cur.task).href}>{consoleLink(source, cur.dept, cur.task).label}</a></>)
              : <p className="world-body">Press play. Each step is one real event from the audit trail.</p>}
          </div>
          <ol aria-label="Events so far, newest first" className="mt-3 max-h-64 min-h-0 flex-1 space-y-1 overflow-y-auto text-meta" tabIndex={0}>
            {events.slice().reverse().slice(0, 40).map((e) => (
              <li key={e.id}>
                <a href={consoleLink(source, e.dept, e.task).href} className="flex gap-2 rounded px-1 hover:bg-black/5" title={consoleLink(source, e.dept, e.task).label}>
                  <span className="world-muted w-20 shrink-0">{DEPTS[e.dept].name.split(" ")[0]}</span><span>{e.title}</span>
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-meta world-muted">{source === "recorded" ? recorded.note : source === "oncall" ? "The OnCall run's audit trail, one event per step. The guided demo (#/demo) walks through the same run." : "Read-only: approvals happen on the host, never here."}</p>
        </div>
      </div>
    </section>
  );
}

function StateLegend() {
  return (
    <section aria-labelledby="legend-h" className="mx-auto max-w-6xl space-y-4 px-6 pb-20">
      <h2 id="legend-h" className="world-h2">What Ember is doing</h2>
      <p className="world-body max-w-[42rem]">Each pose maps to one real system state. Ember only shows what the backend reports.</p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        {(Object.keys(STATES) as MascotState[]).map((s) => (
          <li key={s} className="world-card grid place-items-center gap-2 p-3 text-center text-meta"><Mascot state={s} px={3} /><span>{STATES[s].label}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** prelude: renders instead of the hero (the Bootstrap illustration); the office below is unchanged */
export function World({ theme: forced, prelude }: { theme?: ThemeName; prelude?: (theme: ThemeName, desktop: boolean) => React.ReactNode } = {}) {
  const q = new URLSearchParams(window.location.search).get("t");
  const theme: ThemeName = forced ?? (q === "daylight" || q === "night" ? q : "daylight");
  const desktop = useMedia("(min-width: 768px)");
  return (
    <main id="main" tabIndex={-1} className={`world world-${theme}`} style={{ background: THEMES[theme].bg }}>
      {prelude ? prelude(theme, desktop) : <Hero theme={theme} />}
      {desktop ? <StoryScroll theme={theme} /> : <StoryCards theme={theme} />}
      <Replay theme={theme} />
      <StateLegend />
    </main>
  );
}
