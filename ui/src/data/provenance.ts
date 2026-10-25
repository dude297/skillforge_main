// No Vite or browser dependencies: the event mappers that use this also run in Node (e2e specs import them).
/** Who did the work in a task. ONE place decides the words; anything unrecognised is never shown as a model run. */
export type TaskMode = "real" | "mock" | "deterministic";
const PROVENANCE: Record<TaskMode, { short: string; label: string; title: string }> = {
  real: { short: "local model", label: "Local model", title: "The local model drove these tool calls" },
  mock: { short: "mock agent", label: "Mock agent (scripted, no model)",
    title: "A scripted stand-in made these tool calls; the backend, approvals and verifier are real" },
  deterministic: { short: "deterministic skill", label: "Deterministic skill (no model, no agent)",
    title: "An approved skill ran as fixed code. No model and no agent were involved; approvals and the verifier are real" },
};
export const provenance = (mode: unknown) => PROVENANCE[mode as TaskMode]
  ?? { short: "unknown origin", label: "Unknown origin", title: "This task's mode is not recognised; nothing is assumed about who did the work" };
