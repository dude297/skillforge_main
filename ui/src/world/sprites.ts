// "Ember": an original pixel companion for SkillForge, a small spark from the forge. One 28x24 sprite grid, one
// palette. Body = the console's "agent acting" blue family; state accents reuse the console's meanings: mint = verified
// by code, amber = a person is needed, coral = failure. Frames are composed from layers so every state shares one body.

export type MascotState = "idle" | "investigating" | "building" | "verifying" | "verified" | "waiting" | "error";

export const W = 28, H = 24;

/** 7 core colours + 3 state accents. "." is transparent. */
export const PALETTE: Record<string, string> = {
  k: "#14203A", // ink outline
  b: "#8FD3FF", // body
  d: "#4C9FD6", // body shade
  h: "#D9F2FF", // body highlight / glass
  w: "#FFFFFF", // eye shine
  p: "#FF9EB0", // cheeks
  e: "#FFD166", // ember (the tip glows while it works)
  g: "#65E9B7", // verified (console: verifier only)
  o: "#F1AD64", // a person is needed (console: warn)
  r: "#FF8A94", // failure (console: fail)
};

type Layer = { grid: string[]; x: number; y: number };
export type Frame = Layer[];

// a drop of flame: the tip is the ember
const BODY = [
  "......kk......",
  ".....kbbk.....",
  "....kbbbbk....",
  "...kbhbbbbk...",
  "..kbhhbbbbbk..",
  ".kbhhbbbbbbbk.",
  ".kbhbbbbbbbbk.",
  "kbbbbbbbbbbbbk",
  "kbbbbbbbbbbbbk",
  "kbbbbbbbbbbbbk",
  "kpbbbbbbbbbbpk",
  "kbbbbbbbbbbbbk",
  ".kdbbbbbbbbdk.",
  "..kddddddddk..",
  "...kkk..kkk...",
];
const BX = 7, BY = 7; // body origin on the canvas
const TIP = (lit: boolean, dy = 0): Layer => ({ grid: lit ? ["ee", "ee"] : ["hb", "bb"], x: BX + 6, y: BY + 1 + dy });

const EYES: Record<string, { grid: string[]; dx: number; dy: number }> = {
  open: { grid: ["kw", "kk", "kk"], dx: 0, dy: 0 },
  blink: { grid: ["..", "..", "kk"], dx: 0, dy: 0 },
  happy: { grid: [".k.", "k.k"], dx: 0, dy: 1 },
  right: { grid: ["kw", "kk", "kk"], dx: 1, dy: 0 },
  up: { grid: ["kw", "kk"], dx: 0, dy: -1 },
  x: { grid: ["k.k", ".k.", "k.k"], dx: 0, dy: 0 },
};
const MOUTH: Record<string, string[]> = { smile: ["k..k", ".kk."], open: [".kk.", "k..k", ".kk."], flat: ["kkkk"], o: [".k.", "k.k", ".k."] };

function face(eyes: keyof typeof EYES, mouth: keyof typeof MOUTH = "smile", dy = 0, dx = 0): Layer[] {
  const e = EYES[eyes], m = MOUTH[mouth];
  return [
    { grid: e.grid, x: BX + 3 + e.dx + dx, y: BY + 7 + e.dy + dy },
    { grid: e.grid, x: BX + 9 - (e.grid[0].length - 2) + e.dx + dx, y: BY + 7 + e.dy + dy },
    { grid: m, x: BX + 7 - Math.floor(m[0].length / 2) + dx, y: BY + 11 + dy },
  ];
}
const body = (dy = 0, dx = 0): Layer => ({ grid: BODY, x: BX + dx, y: BY + dy });
const ARMS = (dy = 0): Layer[] => [{ grid: ["k", "k"], x: BX - 1, y: BY + 9 + dy }, { grid: ["k", "k"], x: BX + 14, y: BY + 9 + dy }];
const at = (grid: string[], x: number, y: number): Layer => ({ grid, x, y });

const MAGNIFIER = ["..kkk...", ".khhwk..", "khhhhhk.", "khhhhhk.", ".khhhk..", "..kkkk..", ".....kk.", "......kk"];
const HAMMER_UP = ["kkkkk", "kdddk", "kkkkk", "..e..", "..e..", "..e.."];
const HAMMER_DOWN = ["kkk....", "kdkeeee", "kkk...."];
const SPARKS = ["e...e", "..e..", "e...e"];
const GLASS_A = ["kkkkk", "keeek", ".kek.", "..k..", ".khk.", "khhhk", "kkkkk"];
const GLASS_B = ["kkkkk", "khhhk", ".khk.", "..k..", ".kek.", "keeek", "kkkkk"];
const CHECK = [".ggggg.", "gggggwg", "ggggwgg", "gwgwggg", "ggwgggg", "ggggggg", ".ggggg."];
const ASK = [".ooooo.", "ookkkoo", "ooooko o".replace(" ", ""), "oookooo", "ooooooo", "oookooo", ".ooooo.", "..oo..."];
const HAND = ["kk", "kb", "kb", "kb"];
const BANG = ["rr", "rr", "rr", "rr", "..", "rr"];
const PUFF = [".hh.", "hhhh", ".hh."];
const WRENCH = ["g..g", "gggg", ".gg.", ".gg.", ".gg."];

/** Each state is a loop of frames; `ms` is the frame duration. Repeated frames make idle motion irregular. */
export const STATES: Record<MascotState, { label: string; ms: number; frames: Frame[] }> = {
  idle: {
    label: "Idle", ms: 260,
    frames: [
      [body(), ...ARMS(), ...face("open"), TIP(true)], [body(), ...ARMS(), ...face("open"), TIP(true)],
      [body(1), ...ARMS(1), ...face("open", "smile", 1), TIP(false, 1)], [body(1), ...ARMS(1), ...face("open", "smile", 1), TIP(true, 1)],
      [body(), ...ARMS(), ...face("open"), TIP(true)], [body(), ...ARMS(), ...face("blink"), TIP(true)],
      [body(), ...ARMS(), ...face("open"), TIP(false)], [body(1), ...ARMS(1), ...face("open", "smile", 1), TIP(true, 1)],
      [body(1), ...ARMS(1), ...face("open", "smile", 1), TIP(true, 1)],
    ],
  },
  investigating: {
    label: "Investigating", ms: 220,
    frames: [
      [body(), ...ARMS(), ...face("right", "o"), TIP(true), at(MAGNIFIER, 21, 11)],
      [body(), ...ARMS(), ...face("right", "o"), TIP(false), at(MAGNIFIER, 21, 10)],
      [body(), ...ARMS(), ...face("right"), TIP(true), at(MAGNIFIER, 20, 9)],
      [body(), ...ARMS(), ...face("right"), TIP(false), at(MAGNIFIER, 20, 10)],
    ],
  },
  building: {
    label: "Building", ms: 140,
    frames: [
      [body(), ...ARMS(), ...face("happy", "smile"), TIP(true), at(HAMMER_UP, 21, 5)],
      [body(1), ...ARMS(1), ...face("happy", "open", 1), TIP(true, 1), at(HAMMER_DOWN, 20, 16), at(SPARKS, 22, 12)],
      [body(), ...ARMS(), ...face("happy", "smile"), TIP(false), at(HAMMER_UP, 21, 5)],
    ],
  },
  verifying: {
    label: "Verification pending", ms: 420,
    frames: [
      [body(), ...ARMS(), ...face("up", "flat"), TIP(false), at(GLASS_A, 22, 2)],
      [body(), ...ARMS(), ...face("up", "flat"), TIP(false), at(GLASS_A, 22, 2)],
      [body(), ...ARMS(), ...face("blink", "flat"), TIP(false), at(GLASS_B, 22, 2)],
    ],
  },
  verified: {
    label: "Verified", ms: 170,
    frames: [
      [body(), ...ARMS(), ...face("happy", "open"), TIP(true), at(CHECK, 21, 1)],
      [body(-2), ...ARMS(-3), ...face("happy", "open", -2), TIP(true, -2), at(CHECK, 21, 0)],
      [body(-1), ...ARMS(-2), ...face("happy", "open", -1), TIP(true, -1), at(CHECK, 21, 1)],
      [body(), ...ARMS(), ...face("happy"), TIP(true), at(CHECK, 21, 1)],
      [body(), ...ARMS(), ...face("happy"), TIP(true), at(CHECK, 21, 1)],
      [body(), ...ARMS(), ...face("happy"), TIP(true), at(CHECK, 21, 1)],
    ],
  },
  waiting: {
    label: "Waiting for a person", ms: 380,
    frames: [
      [body(), ...face("right"), TIP(true), at(["k", "k"], BX - 1, BY + 9), at(HAND, 21, 10), at(ASK, 20, 0)],
      [body(), ...face("right"), TIP(true), at(["k", "k"], BX - 1, BY + 9), at(HAND, 21, 9), at(ASK, 20, 0)],
      [body(), ...face("blink"), TIP(false), at(["k", "k"], BX - 1, BY + 9), at(HAND, 21, 10), at(ASK, 20, 1)],
    ],
  },
  error: {
    label: "Error, recovering", ms: 190,
    frames: [
      [body(0, -1), ...face("x", "o", 0, -1), TIP(false), at(BANG, 23, 3)],
      [body(0, 1), ...face("x", "o", 0, 1), TIP(false), at(BANG, 23, 3)],
      [body(), ...ARMS(), ...face("blink", "flat"), TIP(false), at(PUFF, 20, 3)],
      [body(), ...ARMS(), ...face("open", "flat"), TIP(true), at(WRENCH, 22, 9)],
      [body(), ...ARMS(), ...face("open", "smile"), TIP(true), at(WRENCH, 22, 9)],
    ],
  },
};

/** Compose a frame into horizontal colour runs (one <rect> per run keeps the SVG tiny). */
export function runs(frame: Frame): { x: number; y: number; w: number; c: string }[] {
  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill("."));
  for (const l of frame)
    l.grid.forEach((row, dy) => [...row].forEach((ch, dx) => {
      const x = l.x + dx, y = l.y + dy;
      if (ch !== "." && x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = ch;
    }));
  const out: { x: number; y: number; w: number; c: string }[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const ch = row[x];
      let w = 1;
      while (x + w < W && row[x + w] === ch) w++;
      if (ch !== ".") out.push({ x, y, w, c: PALETTE[ch] });
      x += w;
    }
  });
  return out;
}
