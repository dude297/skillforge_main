// The stage floor: lacquer + (high tier) planar reflection + light pools + contact shadow + hairline grid. See materials/floor.ts.
import { memo, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, LinearMipmapLinearFilter, PlaneGeometry, Mesh, type ShaderMaterial } from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { LAYOUT } from "../contract";
import { DESK, MACHINE } from "../assets/dims";
import { POOLS, floorShader, makePlainFloor, type FloorUniforms } from "../materials/floor";
import { COL } from "../materials/palette";
import type { Rig } from "./rig";

const geo = new PlaneGeometry(180, 180);

// pool slots: 0 machine front spill, 1 review lamp, 2 verify gate, 3 library stored, 4 library drafted, 5 intake, 6 refusal stop
function seedPools(u: FloorUniforms) {
  const at = (i: number, x: number, z: number, r: number) => u.uPool.value[i].set(x, z, r, 0);
  at(0, LAYOUT.machine[0], LAYOUT.machine[2] + MACHINE.d / 2 + 1.5, 5.5);
  at(1, LAYOUT.review[0], LAYOUT.review[2] + 0.1, DESK.w * 1.5);
  at(2, LAYOUT.verify[0], LAYOUT.verify[2], 3.8);
  at(3, LAYOUT.library[0] - 1.2, LAYOUT.library[2] + 1.6, 3.6);
  at(4, LAYOUT.library[0] + 0.6, LAYOUT.library[2] + 1.6, 3.2);
  at(5, LAYOUT.intake[0] + 1.2, LAYOUT.intake[2], 5);
  at(6, LAYOUT.refusalStop[0], LAYOUT.refusalStop[2], 3.2);
  u.uBox.value.set(LAYOUT.machine[0], LAYOUT.machine[2], MACHINE.w / 2, MACHINE.d / 2);
}

export const Floor = memo(function Floor({ rig, tier }: { rig: Rig; tier: "high" | "low" }) {
  const made = useMemo(() => {
    if (tier === "high") {
      const refl = new Reflector(geo, { color: new Color("#070b11"), textureWidth: 640, textureHeight: 400, clipBias: 0.003, shader: floorShader(), multisample: 0 });
      const rt = refl.getRenderTarget();
      rt.texture.generateMipmaps = true;
      rt.texture.minFilter = LinearMipmapLinearFilter;
      const rm = refl.material as ShaderMaterial;
      rm.fog = true;
      refl.rotation.x = -Math.PI / 2;
      const uniforms = rm.uniforms as FloorUniforms;
      seedPools(uniforms);
      return { object: refl as Mesh, uniforms, dispose: () => refl.dispose() };
    }
    const { material, uniforms } = makePlainFloor();
    const mesh = new Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2;
    seedPools(uniforms);
    return { object: mesh, uniforms, dispose: () => material.dispose() };
  }, [tier]);
  useEffect(() => () => made.dispose(), [made]);

  useFrame((state) => {
    const u = made.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uKey.value = rig.power;
    u.uReflect.value = tier === "high" ? 0.35 + 0.65 * rig.power : 0;
    const pool = u.uPool.value;
    const col = u.uPoolCol.value;
    pool[0].w = rig.power * (0.3 + 0.5 * rig.work);
    col[0].set(rig.core.r, rig.core.g, rig.core.b).multiplyScalar(0.55);
    pool[1].w = rig.lamp;
    col[1].set(COL.warn.r, COL.warn.g, COL.warn.b);
    pool[2].w = rig.gate;
    col[2].set(rig.gateCol.r, rig.gateCol.g, rig.gateCol.b);
    pool[3].w = rig.stored;
    col[3].set(COL.verified.r, COL.verified.g, COL.verified.b);
    pool[4].w = rig.drafted;
    col[4].set(COL.warn.r, COL.warn.g, COL.warn.b);
    pool[5].w = rig.intake;
    col[5].set(COL.signal.r, COL.signal.g, COL.signal.b);
    pool[6].w = rig.refuse;
    col[6].set(COL.fail.r, COL.fail.g, COL.fail.b);
    u.uRail.value = 0.25 + 0.75 * rig.power;
  });

  void POOLS;
  return <primitive object={made.object} />;
});
