// Physical dimensions and anchor points of the set, in scene units (y up). Shared by the set pieces; other workers may
// import these to aim actors at real geometry (e.g. fly evidence into MACHINE_CORE, land the proposal on DESK_TOP).
import { LAYOUT } from "../contract";

/** The GB10 is a stage hero: a ~15 cm square, ~5 cm tall box enlarged to 3.6 units wide. Front face looks toward +z. */
export const MACHINE = { w: 3.6, h: 1.26, d: 3.6, foot: 0.1, radius: 0.065 } as const;
/** Height (world y) of the centre of the front perforated face. */
export const FACE_Y = 0.745;
/** Centre of the energized core behind the front perforation (world). */
export const MACHINE_CORE = [LAYOUT.machine[0], FACE_Y, LAYOUT.machine[2] + MACHINE.d / 2 - 0.06] as const;
/** Centre of the machine body (world): a good converge point for evidence. */
export const MACHINE_CENTER = [LAYOUT.machine[0], MACHINE.foot + MACHINE.h / 2, LAYOUT.machine[2]] as const;

/** Intake portal: a frame standing at LAYOUT.intake, opening facing roughly +x (the way the work travels), turned toward the camera. */
export const INTAKE = { yaw: 1.05, w: 2.9, h: 3.7, depth: 1.5 } as const;
export const INTAKE_OPENING = [LAYOUT.intake[0], 1.95, LAYOUT.intake[2]] as const;

/** Human review desk at LAYOUT.review. Desk long axis along x. */
export const DESK = { w: 2.7, d: 1.15, topY: 0.92, lampY: 3.1 } as const;
export const DESK_TOP = [LAYOUT.review[0], DESK.topY + 0.06, LAYOUT.review[2]] as const;
export const DESK_LAMP = [LAYOUT.review[0], DESK.lampY, LAYOUT.review[2] - 0.15] as const;

/** Independent verification gate at LAYOUT.verify: a tunnel of hairline arches along the travel axis (x). */
export const GATE = { yaw: 0.42, w: 3.1, h: 3.5, ribs: 5, span: 2.4 } as const;
export const GATE_OPENING = [LAYOUT.verify[0], 1.85, LAYOUT.verify[2]] as const;

/** Skill library rack at LAYOUT.library. 4 columns x 3 rows of slots, faces +z (turned a little toward the camera). */
export const LIB = { yaw: -0.16, cols: 4, rows: 3, cell: [1.06, 0.86] as const, slotY0: 0.62 } as const;
export const LIB_CAPACITY = LIB.cols * LIB.rows;
/** Local (rack space) centre of slot i: i=0 bottom-left, filling a row at a time from the bottom. */
export function libSlotLocal(i: number): [number, number] {
  const c = i % LIB.cols;
  const r = Math.floor(i / LIB.cols);
  return [(c - (LIB.cols - 1) / 2) * LIB.cell[0], LIB.slotY0 + LIB.cell[1] * (r + 0.5)];
}
/** World position of slot i's front opening (for actors that deliver a skill into the rack). */
export function libSlotWorld(i: number): [number, number, number] {
  const [lx, ly] = libSlotLocal(i);
  const cos = Math.cos(LIB.yaw);
  const sin = Math.sin(LIB.yaw);
  return [LAYOUT.library[0] + lx * cos + 0.3 * sin, ly, LAYOUT.library[2] - lx * sin + 0.3 * cos];
}
