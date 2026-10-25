// Motion language (DESIGN.md §6). Components import these; no magic durations in components.
import { useReducedMotion, type Transition } from "motion/react";

export const DUR = { micro: 0.16, panel: 0.3, major: 0.6 } as const;
export const EASE = {
  standard: [0.2, 0, 0, 1] as const,
  emphasis: [0.16, 1, 0.3, 1] as const,
};

export const t = {
  micro: { duration: DUR.micro, ease: EASE.standard } satisfies Transition,
  panel: { duration: DUR.panel, ease: EASE.standard } satisfies Transition,
  major: { duration: DUR.major, ease: EASE.emphasis } satisfies Transition,
};

/** Transition that collapses to an instant change when the user prefers reduced motion. */
export function useT(kind: keyof typeof t): Transition {
  const reduce = useReducedMotion();
  return reduce ? { duration: 0 } : t[kind];
}

/** Enter/exit for list rows and panels: opacity + a short translate, nothing else. */
export const rise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};
