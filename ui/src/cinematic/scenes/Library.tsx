// The skill library: a rack of slots. A drafted skill is an amber outline ("waiting for a person"); a stored skill is a solid
// green cartridge. Counts come straight from visual.library; nothing is lit that the fold does not say exists.
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { LAYOUT, type CineVisual } from "../contract";
import { LIB, LIB_CAPACITY, libSlotLocal } from "../assets/dims";
import { ringFrame, roundedBox } from "../assets/geometry";
import { COL } from "../materials/palette";
import { damp, type Rig } from "./rig";
import type { SetAssets } from "./useAssets";

const POS = [...LAYOUT.library] as [number, number, number];
const W = LIB.cols * LIB.cell[0];
const H = LIB.rows * LIB.cell[1];
const DEPTH = 0.74;
const cartGeo = roundedBox(LIB.cell[0] - 0.22, LIB.cell[1] - 0.22, 0.42, 0.04, 3);
const outlineGeo = ringFrame(LIB.cell[0] - 0.16, LIB.cell[1] - 0.16, 0.05, 0.026, 0.05, 0.003);
const bayGeo = ringFrame(LIB.cell[0] - 0.1, LIB.cell[1] - 0.1, 0.05, 0.012, 0.01, 0.002);
const shelfGeo = roundedBox(W + 0.5, 0.07, DEPTH, 0.02, 2);
const tmp = new Matrix4();
const dividerGeo = roundedBox(0.06, H, DEPTH, 0.015, 2);

export const Library = memo(function Library({ assets, rig, visual }: { assets: SetAssets; rig: Rig; visual: CineVisual }) {
  const cartRef = useRef<InstancedMesh>(null);
  const draftRef = useRef<InstancedMesh>(null);
  const bayRef = useRef<InstancedMesh>(null);
  const shelfRef = useRef<InstancedMesh>(null);
  const divRef = useRef<InstancedMesh>(null);
  const cartMat = useMemo(() => new MeshStandardMaterial({ color: "#0a2a1f", metalness: 0.6, roughness: 0.42, envMap: assets.env, envMapIntensity: 0.55, emissive: COL.verified.clone().multiplyScalar(0.62), toneMapped: false }), [assets.env]);
  const draftMat = useMemo(() => new MeshBasicMaterial({ color: new Color(), toneMapped: false }), []);
  const bayMat = useMemo(() => new MeshBasicMaterial({ color: COL.hair.clone().multiplyScalar(0.55), toneMapped: false }), []);
  useEffect(() => () => { cartMat.dispose(); draftMat.dispose(); bayMat.dispose(); }, [cartMat, draftMat, bayMat]);
  const seen = useMemo(() => ({ stored: -1, drafted: -1 }), []);

  // static geometry of the rack (instanced): bays, shelves, dividers
  useEffect(() => {
    const m = new Matrix4();
    const bays = bayRef.current, shelves = shelfRef.current, divs = divRef.current;
    if (bays) {
      for (let i = 0; i < LIB_CAPACITY; i++) { const [x, y] = libSlotLocal(i); bays.setMatrixAt(i, m.makeTranslation(x, y, DEPTH / 2 - 0.02)); }
      bays.instanceMatrix.needsUpdate = true;
    }
    if (shelves) {
      for (let k = 0; k <= LIB.rows; k++) shelves.setMatrixAt(k, m.makeTranslation(0, LIB.slotY0 + k * LIB.cell[1], 0));
      shelves.instanceMatrix.needsUpdate = true;
    }
    if (divs) {
      for (let c = 0; c <= LIB.cols; c++) divs.setMatrixAt(c, m.makeTranslation((c - LIB.cols / 2) * LIB.cell[0], LIB.slotY0 + H / 2, 0));
      divs.instanceMatrix.needsUpdate = true;
    }
  }, []);

  useFrame((state, dt) => {
    const nStored = Math.min(visual.library.stored, LIB_CAPACITY);
    const nDrafted = Math.min(visual.library.drafted, LIB_CAPACITY - nStored);
    // which slots hold what: instance matrices are rewritten only when the counts change (visual is mutated in place)
    if (nStored !== seen.stored || nDrafted !== seen.drafted) {
      seen.stored = nStored;
      seen.drafted = nDrafted;
      const carts = cartRef.current, drafts = draftRef.current;
      if (carts) {
        for (let i = 0; i < nStored; i++) { const [x, y] = libSlotLocal(i); carts.setMatrixAt(i, tmp.makeTranslation(x, y, 0.02)); }
        carts.count = nStored;
        carts.instanceMatrix.needsUpdate = true;
      }
      if (drafts) {
        for (let i = 0; i < nDrafted; i++) { const [x, y] = libSlotLocal(nStored + i); drafts.setMatrixAt(i, tmp.makeTranslation(x, y, DEPTH / 2 + 0.005)); }
        drafts.count = nDrafted;
        drafts.instanceMatrix.needsUpdate = true;
      }
    }
    rig.stored = damp(rig.stored, Math.min(1, nStored / 3), 3, dt);
    rig.drafted = damp(rig.drafted, nDrafted > 0 ? Math.min(1, 0.5 + nDrafted / 4) : 0, 3, dt);
    const pulse = 0.82 + 0.18 * Math.sin(state.clock.elapsedTime * 2.2);
    draftMat.color.copy(COL.warn).multiplyScalar(1.05 * pulse);
    bayMat.color.copy(COL.hair).multiplyScalar(0.55 * rig.vis);
  });

  const { cell, slotY0 } = LIB;
  return (
    <group position={POS} rotation-y={LIB.yaw}>
      {/* base cabinet and plinth */}
      <mesh geometry={roundedBox(W + 0.8, 0.12, DEPTH + 0.5, 0.03, 3)} material={assets.pbr.dark} position={[0, 0.06, 0.1]} />
      <mesh geometry={roundedBox(W + 0.3, slotY0 - 0.12, DEPTH, 0.04, 3)} material={assets.pbr.body} position={[0, 0.12 + (slotY0 - 0.12) / 2, 0]} />
      {/* back panel */}
      <mesh geometry={roundedBox(W, H, 0.05, 0.01, 2)} material={assets.pbr.matte} position={[0, slotY0 + H / 2, -DEPTH / 2 + 0.05]} />
      {/* uprights, shelves and dividers */}
      <mesh geometry={roundedBox(0.17, H + 0.35, DEPTH + 0.04, 0.04, 3)} material={assets.pbr.body} position={[-W / 2 - 0.1, slotY0 + H / 2 + 0.05, 0]} />
      <mesh geometry={roundedBox(0.17, H + 0.35, DEPTH + 0.04, 0.04, 3)} material={assets.pbr.body} position={[W / 2 + 0.1, slotY0 + H / 2 + 0.05, 0]} />
      <mesh geometry={roundedBox(W + 0.5, 0.14, DEPTH + 0.04, 0.04, 3)} material={assets.pbr.body} position={[0, slotY0 + H + 0.12, 0]} />
      <instancedMesh ref={shelfRef} args={[shelfGeo, assets.pbr.steel, LIB.rows + 1]} frustumCulled={false} />
      <instancedMesh ref={divRef} args={[dividerGeo, assets.pbr.dark, LIB.cols + 1]} frustumCulled={false} />
      {/* slots: hairline bays, stored cartridges, amber drafts */}
      <instancedMesh ref={bayRef} args={[bayGeo, bayMat, LIB_CAPACITY]} frustumCulled={false} />
      <instancedMesh ref={cartRef} args={[cartGeo, cartMat, LIB_CAPACITY]} frustumCulled={false} />
      <instancedMesh ref={draftRef} args={[outlineGeo, draftMat, LIB_CAPACITY]} frustumCulled={false} />
      {void cell}
    </group>
  );
});
