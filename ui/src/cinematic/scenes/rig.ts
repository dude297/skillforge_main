// Shared, mutable, per-frame state of the set. Set pieces write their smoothed output here (never allocating) and the
// floor and the lights read it, so a lit lamp throws a pool on the ground and the machine's core lights its surroundings.
import { Color, MathUtils } from "three";
import { useEffect, useRef, type RefObject } from "react";

export interface Rig {
  power: number;
  work: number;
  /** machine core light colour, already scaled by its level */
  core: Color;
  lamp: number;
  gate: number;
  gateCol: Color;
  stored: number;
  drafted: number;
  intake: number;
  refuse: number;
  /** 0.1 when the room is dark, 1 when powered: idle hairlines and grid scale with it */
  vis: number;
  time: number;
}

export function makeRig(): Rig {
  return { power: 0, work: 0, core: new Color(), lamp: 0, gate: 0, gateCol: new Color(), stored: 0, drafted: 0, intake: 0, refuse: 0, vis: 0.1, time: 0 };
}

export const damp = MathUtils.damp;

/** The latest props in a ref, updated after every commit: readable from useFrame without re-subscribing. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}
