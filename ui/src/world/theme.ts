// Two treatments for the experiment. "daylight" = warm, friendly pixel branding. "night" = the existing premium console
// palette (tokens.css) with pixel elements as accents. State colours keep the console's meanings in both.
export type ThemeName = "daylight" | "night";

export const THEMES: Record<ThemeName, Record<string, string>> = {
  daylight: {
    bg: "#DCEBF5", ground: "#C7DCEB", corridor: "#EAF2F8", floorA: "#FFFFFF", floorB: "#F2F6FA",
    wallA: "#B9CFE3", wallB: "#A3BED6", rackTop: "#5A6B86", rackL: "#3A4760", rackR: "#2C374C",
    wood: "#E9B87F", woodL: "#C98F55", woodR: "#B27A44", paper: "#FFFFFF", belt: "#5A6B86",
    ticket: "#FF8A94", ticketL: "#E36672", ticketR: "#C94F5C", door: "#7D93AE", slot: "#DDE7F0", slotL: "#C3D2E0",
    ok: "#3FCF95", okL: "#2DAF7C", okR: "#239466", warn: "#F1AD64", warnL: "#D98F43", warnR: "#BF7A33",
    fail: "#E35D6A", signal: "#4FB7F0", dim: "#9AA9B8", focus: "#14203A", sign: "#14203A", signText: "#FFFFFF",
    gateFloor: "#FFF4D6", hair: "#3B2A20", skin: "#F2C6A0", shirt: "#4C9FD6", legs: "#2C374C",
  },
  night: {
    bg: "#080C12", ground: "#0D131B", corridor: "#121A24", floorA: "#18222E", floorB: "#141D27",
    wallA: "#223040", wallB: "#1B2735", rackTop: "#2f4153", rackL: "#0E141C", rackR: "#0A0F15",
    wood: "#3A4656", woodL: "#2B3542", woodR: "#232C37", paper: "#C9D6E2", belt: "#2f4153",
    ticket: "#FF8A94", ticketL: "#D96A75", ticketR: "#B8545F", door: "#2f4153", slot: "#18222E", slotL: "#121A24",
    ok: "#65E9B7", okL: "#48C496", okR: "#37A57D", warn: "#F1AD64", warnL: "#CC8B48", warnR: "#A8713A",
    fail: "#FF8A94", signal: "#82D8FF", dim: "#2f4153", focus: "#82D8FF", sign: "#18222E", signText: "#9CADBA",
    gateFloor: "#1B2735", hair: "#C9D6E2", skin: "#E9B993", shirt: "#3A4656", legs: "#121A24",
  },
};
