import { useEffect, useState } from "react";
import { isOnCallRun, type OnCallOrigin, type OnCallRun } from "./oncall";
import { live } from "./live";
import { PREVIEW } from "../lib/preview";

export type OnCallLoad = { state: "loading" } | { state: "ok"; run: OnCallRun; origin: OnCallOrigin } | { state: "missing"; detail: string };

async function fetchRun(url: string, ms: number): Promise<OnCallRun | string> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return `${url}: HTTP ${r.status}`;
    const data: unknown = await r.json().catch(() => null);
    return isOnCallRun(data) ? data : `${url}: not a skillforge.oncall_run/1 document`;
  } catch (e) {
    return `${url}: ${ctl.signal.aborted ? "no answer" : e instanceof Error ? e.message : String(e)}`;
  } finally { window.clearTimeout(timer); }
}

let cache: Promise<OnCallLoad> | null = null;
/** Live endpoint first (skipped in the hosted preview), then the recorded file that ships in dist. Loaded once per page. */
export function loadOnCall(): Promise<OnCallLoad> {
  cache ??= (async () => {
    const errs: string[] = [];
    if (!PREVIEW) {
      const r = await fetchRun(`${live.base}/demo/oncall`, 4000);
      if (typeof r !== "string") return { state: "ok", run: r, origin: "endpoint" } as const;
      errs.push(r);
    }
    const f = await fetchRun("./demo/oncall-run.recorded.json", 4000);
    if (typeof f !== "string") return { state: "ok", run: f, origin: "file" } as const;
    errs.push(f);
    return { state: "missing", detail: errs.join("; ") } as const;
  })();
  return cache;
}

export function useOnCall(): OnCallLoad {
  const [s, setS] = useState<OnCallLoad>({ state: "loading" });
  useEffect(() => { let alive = true; loadOnCall().then((r) => { if (alive) setS(r); }); return () => { alive = false; }; }, []);
  return s;
}
