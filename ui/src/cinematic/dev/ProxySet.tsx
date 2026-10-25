// DEV ONLY: stand-in stations at LAYOUT positions so the camera and the timing can be judged without the real set.
import { LAYOUT, type CineVisual } from "../contract";
import { HERO } from "../timeline/camera";

const st = (p: readonly [number, number, number], w: number, h: number, d: number, color: string, key: string) => (
  <mesh key={key} position={[p[0], h / 2, p[2]]}><boxGeometry args={[w, h, d]} /><meshBasicMaterial color={color} /></mesh>
);

export default function ProxySet({ visual }: { visual: CineVisual }) {
  return (
    <group>
      <mesh position={[LAYOUT.machine[0], 0.75, LAYOUT.machine[2]]}><boxGeometry args={[2.2, 1.5, 2.2]} /><meshBasicMaterial color="#5d7487" /></mesh>
      {st(LAYOUT.intake, 1.6, 1.2, 1.6, "#2f6a8a", "i")}
      {st(LAYOUT.review, 2.2, 0.9, 1.4, visual.review === "waiting" ? "#b9863f" : "#46586b", "r")}
      {st(LAYOUT.verify, 1.8, 1.1, 1.4, visual.verify === "passed" ? "#3fae86" : "#46586b", "v")}
      {st(LAYOUT.library, 3, 1.4, 1.6, "#46586b", "l")}
      {st(LAYOUT.refusalStop, 0.4, 1.8, 0.4, "#7a3a44", "x")}
      <mesh position={HERO as unknown as [number, number, number]}><icosahedronGeometry args={[0.35, 0]} /><meshBasicMaterial color="#82D8FF" /></mesh>
      <gridHelper args={[60, 60, "#1b2430", "#121a24"]} position={[0, 0.01, 0]} />
    </group>
  );
}
