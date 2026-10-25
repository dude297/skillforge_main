// Polls the read-only operator API. All console state in Live mode is DERIVED from what the backend returns: a page
// reload, a service restart or a reconnect simply re-reads it. Events are keyed by their audit id, so a duplicate
// delivery can't produce a duplicate step, and a database reset/restore (ids going backwards) triggers a full resync.
import { useEffect, useState } from "react";
import { live, type LiveAction, type LiveEvent, type LiveSkill, type LiveStatus, type LiveTask, type LiveTaskDetail } from "./live";

export type ConnState = "connecting" | "connected" | "lost" | "unauthorized";

export interface LiveData {
  conn: ConnState;
  error: string | null;
  /** epoch ms of the last fully successful poll; data on screen is at least this fresh */
  lastOk: number | null;
  status: LiveStatus | null;
  /** why the host status is unavailable (it is polled separately and may be slow) */
  statusError: string | null;
  tasks: LiveTask[];
  approvals: LiveAction[];
  skills: LiveSkill[];
  events: LiveEvent[];
  lastEventId: number;
}

const EMPTY: LiveData = { conn: "connecting", error: null, lastOk: null, status: null, statusError: null, tasks: [], approvals: [], skills: [], events: [], lastEventId: 0 };
const POLL_MS = 1500;
const MAX_BACKOFF_MS = 10_000;
const STATUS_MS = 5000;          // the server caches status for 10 s
const STATUS_TIMEOUT_MS = 40_000; // nemoclaw status alone may take up to 30 s on the host
const KEEP_EVENTS = 1000;

export function mergeEvents(have: LiveEvent[], incoming: LiveEvent[]): LiveEvent[] {
  if (!incoming.length) return have;
  const byId = new Map(have.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP_EVENTS);
}

export function useLive(enabled: boolean): LiveData {
  const [data, setData] = useState<LiveData>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let alive = true, timer = 0, statusTimer = 0, failures = 0, resync = false;
    // the cursor lives HERE, updated in the same place as the state: a back-to-back catch-up poll never re-reads a
    // stale value. lastEvent remembers what we saw at the cursor, so a replaced DB is detected even if ids grew.
    let cursor = 0, lastEvent: LiveEvent | null = null;

    const poll = async () => {
      const [tasks, approvals, skills, events] = await Promise.all([live.tasks(), live.approvals(), live.skills(), live.events(cursor)]);
      if (!alive) return;
      const failed = [tasks, approvals, skills, events].find((r) => !r.ok);
      if (failed && !failed.ok) {
        failures++;
        resync = true; // whatever happened while we were away (restart, restore), re-read the event stream from 0
        // keep what was last received (it is real, and the UI marks it stale); never fill in anything else
        setData((d) => ({ ...d, conn: failed.reason === "unauthorized" ? "unauthorized" : "lost", error: `${failed.reason}: ${failed.detail}` }));
      } else if (tasks.ok && approvals.ok && skills.ok && events.ok) {
        const a = events.data.anchor;
        const replaced = events.data.last_id < cursor || (cursor > 0 && lastEvent != null &&
          (!a || a.ts !== lastEvent.ts || a.event !== lastEvent.event));
        if (resync || replaced) { // start over from the beginning of the (possibly different) audit trail
          resync = false; cursor = 0; lastEvent = null;
          setData((d) => ({ ...d, events: [], lastEventId: 0 }));
          timer = window.setTimeout(poll, 0);
          return;
        }
        failures = 0;
        const incoming = events.data.events;
        if (incoming.length) { lastEvent = incoming[incoming.length - 1]; cursor = lastEvent.id; }
        setData((d) => {
          const merged = mergeEvents(d.events, incoming);
          return { ...d, conn: "connected", error: null, lastOk: Date.now(), tasks: tasks.data.tasks, approvals: approvals.data.pending,
            skills: skills.data.skills, events: merged, lastEventId: cursor };
        });
        if (incoming.length === 500) { timer = window.setTimeout(poll, 0); return; } // catching up
      }
      const wait = failures ? Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures, 3)) : POLL_MS;
      timer = window.setTimeout(poll, wait);
    };

    // status can be slow (it probes inference and the sandbox on the host): it has its own loop and its own, longer
    // timeout, and its failure never marks the whole connection lost. A failed or old status is dropped, not kept.
    const pollStatus = async () => {
      const r = await live.status(STATUS_TIMEOUT_MS);
      if (!alive) return;
      setData((d) => ({ ...d, status: r.ok ? r.data : null, statusError: r.ok ? null : `${r.reason}: ${r.detail}` }));
      statusTimer = window.setTimeout(pollStatus, STATUS_MS);
    };
    poll();
    pollStatus();
    // leaving Live drops everything: coming back must never show a previous session's data as "connected"
    return () => { alive = false; window.clearTimeout(timer); window.clearTimeout(statusTimer); setData(EMPTY); };
  }, [enabled]);

  return enabled ? data : EMPTY;
}

/** Detail for one task, re-read whenever new audit events arrive (cheap: one indexed query per table). */
export function useLiveTask(id: number | null, version: number) {
  const [state, setState] = useState<{ id: number | null; detail: LiveTaskDetail | null; error: string | null }>({ id: null, detail: null, error: null });
  useEffect(() => {
    if (id == null) return;
    let alive = true;
    live.task(id).then((r) => {
      if (!alive) return;
      setState((s) => (r.ok ? { id, detail: r.data, error: null }
        : { id, detail: s.id === id ? s.detail : null, error: `${r.reason}: ${r.detail}` }));
    });
    return () => { alive = false; };
  }, [id, version]);
  return state.id === id ? state : { id, detail: null, error: null };
}
