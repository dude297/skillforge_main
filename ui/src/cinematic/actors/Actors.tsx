/* eslint-disable react-hooks/immutability -- the Choreo is an imperative frame-loop state machine, not React state */
// The actors of The Forge: what moves. Everything is driven by `visual` (the fold's projection) through one Choreo
// state machine; nothing here decides progress or status. `visual` is ONE stable object the timeline mutates in place
// (progress, route.progress change per frame): it is read inside useFrame, never captured at render time.
//
// Progress contract: `visual.progress` is how far the transition into the CURRENT state has played (0..1). The few
// motions that belong to a single state use it as a scrub: the evidence stream (ticket just arrived), the skill
// condensing, the packet's journey along the short or refused path. State changes themselves (proposal to review desk,
// artifact into the library) are eased on a local clock so any jump between states stays continuous.
// Reduced motion: no streaming, no travel, no particles; static end states.
import { useLayoutEffect, useMemo, useRef } from "react";
import { invalidate, useFrame } from "@react-three/fiber";
import type { PointLight } from "three";
import type { ActorProps, CineVisual } from "../contract";
import { Choreo } from "./choreo";
import { Storm } from "./Storm";
import { Lattice } from "./Lattice";
import { Crystal } from "./Crystal";
import { Packet } from "./Packet";
import { Marks } from "./Marks";
import { Trace } from "./Trace";
import { EmberBillboard } from "./Ember";

export function Actors({ visual, quality, reducedMotion }: ActorProps) {
  const ch = useMemo(() => new Choreo(), []);
  if (import.meta.env.DEV) (globalThis as { __choreo?: Choreo }).__choreo = ch; // dev harness inspection only
  const vref = useRef<CineVisual>(visual);
  const light = useRef<PointLight>(null);
  useLayoutEffect(() => {
    vref.current = visual;
    ch.reduced = reducedMotion;
    if (reducedMotion) { ch.update(visual, 0, 0.016); ch.update(visual, 0.02, 0.016); invalidate(); }
  }, [visual, reducedMotion, ch]);
  useFrame((state, dt) => {
    ch.update(vref.current, state.clock.elapsedTime, dt);
    const l = light.current;
    if (l) { l.position.copy(ch.focusPos); l.position.y += 0.6; l.color.copy(ch.focusColor); l.intensity = ch.focusLevel * 8; }
  }, -1);
  const low = quality.tier === "low";
  return (
    <group>
      <Trace ch={ch} />
      <Storm ch={ch} low={low} />
      <Lattice ch={ch} />
      <Crystal ch={ch} low={low} />
      <Packet ch={ch} />
      <Marks ch={ch} />
      <EmberBillboard ch={ch} />
      {/* the key light follows the work: colour and place come from the active item */}
      <pointLight ref={light} intensity={0} distance={11} decay={2} />
    </group>
  );
}
