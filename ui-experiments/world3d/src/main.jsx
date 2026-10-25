import "./index.css";
// TIME-BOXED 3D SPIKE: the same office and the same recorded events as the 2.5D scene, in React Three Fiber.
// Shares the event adapter, scene-state fold and sprite frames with ui/src/world (imported, not copied).
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import recorded from "../../../ui/src/world/recorded-run.json";
import { fromAudit, sceneState, DEPTS } from "../../../ui/src/world/events";
import { STATES, runs, W, H } from "../../../ui/src/world/sprites";

const EVENTS = recorded.events.map(fromAudit);
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ROOMS = { server: [0, 0, "#FFFFFF"], review: [9, 0, "#FFFFFF"], intake: [0, 9, "#FFFFFF"], library: [9, 9, "#FFFFFF"] };
const SPOT = { server: [3.6, 4.4], review: [11, 4.6], intake: [3.2, 12.6], library: [12.4, 13.2], gate: [7.5, 7.5] };
const C = { ok: "#3FCF95", warn: "#F1AD64", fail: "#E35D6A", signal: "#4FB7F0", rack: "#3A4760", wood: "#E9B87F", wall: "#B9CFE3", slot: "#DDE7F0", ticket: "#FF8A94" };

const Box = ({ p, s, c, emissive, onClick }) => (
  <mesh position={[p[0] + s[0] / 2, p[2] + s[2] / 2, p[1] + s[1] / 2]} onClick={onClick}>
    <boxGeometry args={[s[0], s[2], s[1]]} /><meshLambertMaterial color={c} emissive={emissive ?? "#000"} />
  </mesh>
);

function Room({ id, onOpen }) {
  const [x, y, c] = ROOMS[id];
  return (
    <group>
      <Box p={[x, y, -0.05]} s={[6, 6, 0.05]} c={c} onClick={(e) => { e.stopPropagation(); onOpen(id); }} />
      <Box p={[x, y, 0]} s={[6, 0.15, 2]} c={C.wall} />
      <Box p={[x, y, 0]} s={[0.15, 6, 2]} c="#A3BED6" />
    </group>
  );
}

/** the pixel companion as a billboard sprite; frames from the same sprite grid */
function Mascot({ state, target }) {
  const sprite = useRef();
  const textures = useMemo(() => Object.fromEntries(Object.entries(STATES).map(([k, v]) => [k, v.frames.map((f) => {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    for (const r of runs(f)) { g.fillStyle = r.c; g.fillRect(r.x, r.y, r.w, 1); }
    const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })])), []);
  const clock = useRef(0);
  useFrame((_, dt) => {
    const s = sprite.current;
    if (!s) return;
    const [tx, tz] = target;
    if (REDUCE) s.position.set(tx, 1.1, tz);
    else { s.position.x += (tx - s.position.x) * Math.min(1, dt * 3); s.position.z += (tz - s.position.z) * Math.min(1, dt * 3); }
    clock.current += dt * 1000;
    const fr = textures[state];
    s.material.map = fr[REDUCE ? 0 : Math.floor(clock.current / STATES[state].ms) % fr.length];
  });
  return <sprite ref={sprite} position={[target[0], 1.1, target[1]]} scale={[2.6, 2.2, 1]}><spriteMaterial transparent /></sprite>;
}

function Office({ state, onOpen }) {
  const cur = state.current;
  const gate = state.gate === "pass" ? C.ok : state.gate === "fail" ? C.fail : state.gate === "pending" ? C.signal : "#9AA9B8";
  return (
    <>
      <ambientLight intensity={1.6} /><directionalLight position={[10, 20, 5]} intensity={1.4} />
      <Box p={[-1, -1, -0.15]} s={[17, 17, 0.1]} c="#C7DCEB" />
      {Object.keys(ROOMS).map((id) => <Room key={id} id={id} onOpen={onOpen} />)}
      {[0.6, 1.9, 3.2].map((x) => <Box key={x} p={[x, 0.6, 0]} s={[1, 1, 2.6]} c={C.rack} />)}
      {[0.6, 1.9, 3.2].map((x) => <Box key={`l${x}`} p={[x + 0.3, 1.6, 1.4]} s={[0.15, 0.05, 0.15]} c={C.signal} emissive={C.signal} />)}
      <Box p={[2.4, 3, 0]} s={[1.4, 1.4, 1]} c={state.served ? C.signal : C.rack} />
      <Box p={[10.2, 1.6, 0]} s={[3, 1.3, 0.9]} c={C.wood} />
      <Box p={[11.6, 0.8, 0]} s={[0.5, 0.4, 1.4]} c="#4C9FD6" />
      <Box p={[12.6, 1.9, 0.9]} s={[0.3, 0.3, 0.6]} c={state.waiting ? C.warn : "#9AA9B8"} emissive={state.waiting ? C.warn : "#000"} />
      <Box p={[0.6, 10.4, 0]} s={[5, 1, 0.45]} c="#5A6B86" />
      {Array.from({ length: Math.min(state.tickets, 4) }).map((_, i) => <Box key={i} p={[1 + i * 1.2, 10.6, 0.45]} s={[0.7, 0.6, 0.5]} c={C.ticket} />)}
      <Box p={[9.6, 9.4, 0]} s={[4.6, 0.9, 2.4]} c={C.wood} />
      {Array.from({ length: 6 }).map((_, i) => <Box key={`c${i}`} p={[13.4 - i * 0.72, 9.55, 2.4]} s={[0.5, 0.6, 0.55]} c={i < state.stored ? C.ok : i < state.stored + state.drafted ? C.warn : C.slot} />)}
      <Box p={[6.7, 7.3, 0]} s={[0.35, 0.35, 2.4]} c={C.rack} onClick={() => onOpen("gate")} />
      <Box p={[7.95, 7.3, 0]} s={[0.35, 0.35, 2.4]} c={C.rack} onClick={() => onOpen("gate")} />
      <Box p={[6.7, 7.3, 2.4]} s={[1.6, 0.35, 0.35]} c={gate} emissive={gate} />
      <Mascot state={cur?.mascot ?? "idle"} target={SPOT[cur?.dept ?? "intake"]} />
    </>
  );
}

function App() {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const id = setInterval(() => setAt((a) => (a + 1) % (EVENTS.length + 1)), 900);
    return () => clearInterval(id);
  }, []);
  const state = useMemo(() => sceneState(EVENTS.slice(0, at)), [at]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#DCEBF5", fontFamily: "system-ui" }}>
      <Canvas orthographic camera={{ position: [24, 22, 24], zoom: 30, near: 0.1, far: 200 }} frameloop={REDUCE ? "demand" : "always"}
        onCreated={({ camera }) => camera.lookAt(7.5, 0, 7.5)} dpr={[1, 2]}>
        <Office state={state} onOpen={setOpen} />
      </Canvas>
      <div style={{ position: "absolute", top: 12, left: 12, right: 12, maxWidth: 560, background: "#fff", border: "2px solid #14203A", padding: "6px 10px", borderRadius: 6, fontSize: 14 }}>
        <b>3D prototype · recorded data (not live)</b> · <a href="/#/">back to the console</a>
        <div>Replay of a recorded mock-agent run (no model, no backend): step {at} of {EVENTS.length}: {state.current?.title ?? "start"}{open ? `  |  ${DEPTS[open].name}` : ""}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
