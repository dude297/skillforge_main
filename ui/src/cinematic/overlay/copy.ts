// The film's words. Two display lines, one per act that earns one; everything else is the event's own wording
// (visual.caption) or an honest note about who decides.
import type { Beat, CineProvenance } from "../contract";

export const HEADLINES = {
  awaken: ["Fix it once", "with AI."],
  forge: ["Reuse the fix", "without it."],
} as const satisfies Partial<Record<Beat, readonly string[]>>;

/** On screen at all times. The intro is a drawn story, never a recording. */
export const PROVENANCE_LABEL: Record<CineProvenance, string> = {
  illustration: "Illustration, not a recorded run",
  recorded: "Recorded simulation, not a live run",
  live: "Live from the host",
};

/** Who decides. The browser never approves or promotes anything; the film says so where a person is involved. */
export const NOTES: Partial<Record<Beat, string>> = {
  gate: "Approval is a person's decision, made on the host. This page can't approve anything.",
  forge: "Promotion into the library is also a person's decision on the host.",
  shortpath: "The short path skips the model, not the approval. A person still decides on the host.",
};

export const ENTER_TITLE = "Now run it yourself.";
export const EXITS = [
  { href: "#/demo", label: "Guided demo", primary: true },
  { href: "#/world", label: "Explore the office", primary: false },
  { href: "#/console", label: "Open the console", primary: false },
] as const;

export const SEEN_KEY = "skillforge.forge.seen";
