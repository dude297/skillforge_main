// THE FORGE: the root. Chooses how the film is shown (WebGL stage, stepped stage under reduced motion, or the SVG poster),
// owns the clock, and lays the typography and controls over it. The 3D stage is a lazy chunk: three.js loads only when a
// visitor is actually about to watch.
//
// Truth: this file never decides what happened. The film is a list of known events (adapters/illustration.ts) told up to a
// moment in time; status colours come from toVisual(sceneState(events)).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import { BEAT_ORDER } from "./contract";
import { Clock } from "./timeline/clock";
import { frameAt, visualFor } from "./timeline/frame";
import { endOfBeat, LAST } from "./timeline/sequence";
import { attachDriver } from "./overlay/driver";
import { Provenance, Words, Exits } from "./overlay/Overlay";
import { Controls, type Trace } from "./overlay/Controls";
import { Collapsed } from "./overlay/Collapsed";
import { SEEN_KEY } from "./overlay/copy";
import { PosterScene } from "./fallback/Poster";
import { StageBoundary } from "./fallback/StageBoundary";
import { canUseWebGL, detectQuality } from "./fallback/webgl";
import "./overlay/forge.css";

const Stage3D = lazy(() => import("./timeline/Stage3D"));

export interface CinematicProps {
  /** called when the visitor chooses where to go after the reveal (a hash route that already exists) */
  onEnter?: (href: string) => void;
  /** "intro": a full-viewport opening (below the app bar). "embedded": fills its container (the guided demo). */
  mode?: "intro" | "embedded";
  className?: string;
  /** the film reached its end state (played through or skipped) */
  onComplete?: () => void;
  /** dev and QA only: seek, hold, or force a path. Never set in production code. */
  debug?: { t?: number; paused?: boolean; poster?: boolean; tier?: "high" | "low"; reduced?: boolean; expanded?: boolean; proxy?: boolean };
}

const safe = {
  seen(): boolean { try { return window.sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } },
  mark(): void { try { window.sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage can be blocked; the film then simply plays again */ } },
};

const INTERACTIVE = "button, a, input, select, textarea, summary, [contenteditable], [role='button'], [role='link']";

export function Cinematic({ onEnter, mode = "intro", className, onComplete, debug }: CinematicProps) {
  const systemReduced = useReducedMotion();
  const reduced = debug?.reduced ?? !!systemReduced;
  const [webgl] = useState(() => !debug?.poster && canUseWebGL());
  const [failed, setFailed] = useState<string | null>(null);
  const use3d = webgl && !failed;
  const stepped = reduced || !use3d;
  const quality = useMemo(() => detectQuality(reduced, debug?.tier), [reduced, debug?.tier]);
  const [clock] = useState(() => {
    const c = new Clock(stepped);
    if (debug?.t != null) c.seek(debug.t);
    return c;
  });
  const [collapsed, setCollapsed] = useState(() => mode === "intro" && !debug?.expanded && safe.seen());
  const rootRef = useRef<HTMLElement | null>(null);
  const visible = useRef(true);
  const status = useSyncExternalStore(clock.subscribe, clock.getStatus);

  // reduced motion or a failed stage: no running time, the visitor advances beat by beat
  useEffect(() => { clock.setStepped(stepped); }, [clock, stepped]);

  // the stage is ready (first frames drawn, shaders compiled): now the film may start
  // ...unless the visitor already acted while it was loading (skipped, stepped or replayed): never restart under them
  const onReady = useCallback(() => {
    if (debug?.paused || reduced || clock.status.ended || clock.t > 0) return;
    clock.play();
  }, [clock, debug?.paused, reduced]);
  const onFail = useCallback((why: string) => setFailed(why), []);

  // CSS variables for the words and the rail
  useEffect(() => { const el = rootRef.current; return el ? attachDriver(clock, el) : undefined; }, [clock, collapsed]);

  // never run while nobody is looking
  useEffect(() => {
    const onVis = () => clock.hold("hidden", document.hidden);
    document.addEventListener("visibilitychange", onVis);
    const el = rootRef.current;
    const io = el && "IntersectionObserver" in window ? new IntersectionObserver(([e]) => { visible.current = e.intersectionRatio >= 0.5; clock.hold("offscreen", e.intersectionRatio < 0.15); }, { threshold: [0, 0.15, 0.5, 1] }) : null;
    if (el) io?.observe(el);
    return () => { document.removeEventListener("visibilitychange", onVis); io?.disconnect(); };
  }, [clock, collapsed]);

  // the end: remember it for this tab and tell the host page
  const completed = useRef(false);
  useEffect(() => {
    if (status.ended && !completed.current) { completed.current = true; safe.mark(); onComplete?.(); }
    if (!status.ended) completed.current = false;
  }, [status.ended, onComplete]);

  // keyboard: Esc skips, Space pauses (only when the film is what the visitor is looking at), arrows move between beats
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || collapsed) return;
      const root = rootRef.current;
      const target = e.target as Element | null;
      const inside = !!(root && target && root.contains(target));
      const interactive = !!target?.closest?.(INTERACTIVE);
      if (e.key === "Escape") {
        if (clock.status.ended || !(inside || visible.current)) return;
        e.preventDefault(); clock.skip();
      } else if (e.key === " " || e.code === "Space") {
        if (interactive || clock.status.ended || clock.status.stepped) return;
        if (!(inside || (mode === "intro" && visible.current))) return;
        e.preventDefault(); clock.toggle();
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && inside) {
        e.preventDefault(); clock.jump(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, collapsed, mode]);

  useEffect(() => () => clock.dispose(), [clock]);

  const navigate = useCallback((href: string, e: React.MouseEvent<HTMLAnchorElement>) => {
    safe.mark();
    if (onEnter) { e.preventDefault(); onEnter(href); }
  }, [onEnter]);

  const expand = useCallback(() => {
    clock.replay();
    clock.pause(); // starts when the stage reports ready; the poster and reduced motion do not run at all
    setCollapsed(false);
  }, [clock]);

  // `status` changes only when the beat or the told events change, which is exactly when these must be recomputed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visual = useMemo(() => visualFor(frameAt(clock.t)), [clock, status]);
  // the trace takes the colour of what the work was doing in each beat: amber while a person is needed, rose on a refusal
  const traces = useMemo(() => BEAT_ORDER.map((_, i): Trace => {
    const v = i === status.beatIndex ? visual : visualFor(frameAt(endOfBeat(i)));
    return v.route?.kind === "refused" ? "fail" : v.review === "waiting" ? "warn" : "signal";
  }), [visual, status.beatIndex]);

  return (
    <section
      ref={rootRef}
      className={`forge ${className ?? ""}`}
      data-mode={mode}
      data-collapsed={collapsed ? "true" : undefined}
      data-path={collapsed ? "collapsed" : use3d ? (reduced ? "stepped-3d" : "3d") : "poster"}
      aria-label="SkillForge in one minute: an illustration, not a recorded run"
    >
      {collapsed ? (
        <Collapsed onReplay={expand} onNavigate={navigate} />
      ) : (
        <>
          <div className="forge-stage">
            {use3d ? (
              <StageBoundary onFail={onFail}>
                <Suspense fallback={null}>
                  <Stage3D clock={clock} quality={quality} reducedMotion={reduced} onReady={onReady} onFail={onFail} devProxy={debug?.proxy} />
                </Suspense>
              </StageBoundary>
            ) : (
              <div className="forge-poster"><PosterScene index={status.beatIndex} /></div>
            )}
          </div>
          <div className="forge-scrim" aria-hidden="true" />
          <div className="forge-ui">
            <Provenance visual={visual} />
            <Words visual={visual} />
            <Controls clock={clock} status={status} traces={traces} skipLabel={stepped ? "Skip to end" : "Skip intro"} />
            {status.beatIndex === LAST ? <Exits onNavigate={navigate} /> : null}
          </div>
        </>
      )}
    </section>
  );
}

