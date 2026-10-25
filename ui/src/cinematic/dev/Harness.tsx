// DEV ONLY (never in the production build): `npx vite --port <p>` then open /cinematic-dev.html.
//   Worker B block (query params): ?t=5500 seek, &paused=1 hold there, &poster=1 force the SVG poster, &tier=high|low,
//   &reduced=1 stepped mode, &expanded=1 ignore "seen", &proxy=1 placeholder stations, &sample=1 fill empty beats with
//   sample events (&sample=force replaces gate/forge/shortpath), &fresh=1 forget "seen".
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles/tokens.css";
import { Cinematic } from "../Cinematic";
// --- Worker B harness block -------------------------------------------------------------------------------------------
import { ILLUSTRATION_BEATS } from "../adapters/illustration";
import { STORY, type VizEvent } from "../../world/events";
import { SEEN_KEY } from "../overlay/copy";

const q = new URLSearchParams(location.search);
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
if (q.get("fresh") === "1") sessionStorage.removeItem(SEEN_KEY);

if (q.has("sample")) {
  const force = q.get("sample") === "force";
  const byId = (...ids: string[]) => ids.map((id) => STORY.find((e) => e.id === id)!);
  const fill = (beat: keyof typeof ILLUSTRATION_BEATS, evs: VizEvent[]) => { if (force || ILLUSTRATION_BEATS[beat].length === 0) ILLUSTRATION_BEATS[beat] = evs; };
  fill("gate", byId("s5", "s6", "s7", "s8"));
  fill("forge", byId("s9", "s10", "s11", "s12"));
  fill("shortpath", [
    ...byId("s13"),
    { id: "x-short", dept: "library", mascot: "building", effects: ["ticket_out"], success: true, title: "The short path", detail: "The skill proposes the fix in milliseconds, without the model.", evidence: [] },
    { id: "x-in2", dept: "intake", mascot: "idle", effects: ["ticket_in"], title: "A different problem arrives", detail: "The data does not match the skill.", evidence: [] },
    { id: "x-ref", dept: "library", mascot: "error", effects: ["ticket_out"], success: false, title: "Refused: handed to a person", detail: "No guess, nothing changed.", evidence: [] },
  ]);
}
const debug = { t: num("t"), paused: q.get("paused") === "1", poster: q.get("poster") === "1", tier: (q.get("tier") as "high" | "low" | null) ?? undefined, reduced: q.has("reduced") ? q.get("reduced") === "1" : undefined, expanded: q.get("expanded") === "1", proxy: q.get("proxy") === "1" };
// --- end Worker B harness block ---------------------------------------------------------------------------------------
// --- Worker A block (set isolation harness): ?part=set ...
import { SetHarness } from "./SetHarness";
// --- end Worker A block
// ---- Worker C block: ?part=actors renders the actors alone (see dev/ActorsHarness.tsx) ----
import { ActorsHarness } from "./ActorsHarness";
// ---- end Worker C block ----

const part = q.get("part");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {part === "set" ? <SetHarness q={q} /> : part === "actors" ? <ActorsHarness /> : <Cinematic onEnter={(h) => console.log("enter", h)} debug={debug} />}
  </StrictMode>,
);
