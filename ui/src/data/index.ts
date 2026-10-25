/**
 * Data-access boundary for the SkillForge UI. A barrel only: it names where data comes from and changes no consumer
 * (every screen still imports from the individual modules).
 *
 * Two build modes (see docs/DATA_MODES.md):
 *   PREVIEW  `VITE_PREVIEW=1 npm run build`  hosted, frontend-only. Never calls the operator API. Reads only bundled
 *            fixtures (everything under "Fixtures" below). `live.*` resolves to an "unreachable" result without a request.
 *   LIVE     `npm run build` served by `python -m app ui` (same origin). Reads the read-only operator API; the base URL
 *            is `VITE_OPERATOR_API` at build time, default `/ui` (see `live.base`). The UI never falls back from live
 *            to fixtures: a failed call is shown as a failure.
 *
 * To point LIVE mode at a different backend, change ONE thing: `VITE_OPERATOR_API` in the build environment, or
 * `BASE` at the top of `live.ts`. Response shapes are validated at runtime by the `V` checks in `live.ts`; the
 * authoritative contract comes from the integration team (`CONTRACT.md` is the proposal).
 *
 * Fixture locations (all shipped inside the bundle or `dist/`; none is fetched from outside the origin):
 *   src/data/synthetic.ts                 scripted run that drives the console's "Preview" source (`useSyntheticRun`)
 *   src/data/recorded.ts                  parser for a real bench `result.json` the operator loads by hand
 *   src/data/auditReplay.ts               parser for a real `python3 -m app audit` export
 *   src/data/registry.ts                  sample skills / history, plus the REAL repo `data/models.json` (bundled by System)
 *   src/world/recorded-run.json           recorded run replayed by the Office (`#/world`) and the console's Recorded source
 *   src/world/bootstrap-data.ts           illustrated onboarding ("Set up") content
 *   public/demo/oncall-run.recorded.json  OnCall guided-demo run, fetched as `./demo/oncall-run.recorded.json`
 *                                         (schema `skillforge.oncall_run/1`, see `isOnCallRun`)
 */
import { PREVIEW } from "../lib/preview";

export type DataMode = "preview" | "live";

/** Which data mode this bundle was built for. Fixed at build time; there is no runtime switch to LIVE in a preview build. */
export const dataMode = (): DataMode => (PREVIEW ? "preview" : "live");

// ---- LIVE: read-only operator API adapter (GET only; the session is an HttpOnly cookie)
export { live } from "./live";
export type {
  LiveResult, LiveEvent, LiveTask, LiveTaskDetail, LiveAction, LiveSkill, LiveStatus, LiveBench,
  LiteState, LiteWorkspace, LiteItem, LiteDiscovery, WorkflowState,
} from "./live";
// Host commands the operator runs by hand (approve, reject, promote, roll back). The browser never performs them.
export { approveCommand, rejectCommand, promoteCommand, rollbackCommand, disableCommand } from "./live";

// ---- LIVE polling hooks over the adapter
export { useLive, useLiveTask, mergeEvents } from "./useLive";
export type { ConnState, LiveData } from "./useLive";

// ---- OnCall demo run: live endpoint first (never in PREVIEW), then the recorded file in dist
export { loadOnCall, useOnCall } from "./useOnCall";
export type { OnCallLoad } from "./useOnCall";
export { isOnCallRun, SCHEMA as ONCALL_SCHEMA } from "./oncall";
export type { OnCallRun, OnCallOrigin, DemoMode } from "./oncall";

// ---- Fixtures: synthetic and recorded sources
export { useSyntheticRun, SYNTHETIC_STATUS, REPLAY_STEPS } from "./synthetic";
export type { Phase, Faults, RunState } from "./synthetic";
export { parseBenchResult } from "./recorded";
export type { Recorded } from "./recorded";
export { parseAudit } from "./auditReplay";
export { SKILLS, HISTORY, MODEL_REGISTRY } from "./registry";
export type { SkillVersion, SkillEntry, HistoryRun, RegistryModel } from "./registry";

// ---- Shared shapes
export type { Source, Health, SystemStatus, Step, StepState, StepKind, ProposedFix, SkillArtifact, BenchRow, Compare } from "./types";
