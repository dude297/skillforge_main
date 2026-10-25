// Linear-space colours for the set, derived from the semantic CINE_COLORS. Statuses keep their meaning in the room:
// signal = agent acting, verified = independent check passed, warn = a person is needed, fail = failure.
import { Color } from "three";
import { CINE_COLORS } from "../contract";

export const COL = {
  signal: new Color(CINE_COLORS.signal),
  verified: new Color(CINE_COLORS.verified),
  warn: new Color(CINE_COLORS.warn),
  fail: new Color(CINE_COLORS.fail),
  void: new Color(CINE_COLORS.void),
  /** neutral instrument light: powered but not signalling anything (never a status colour) */
  neutral: new Color("#9db3c6"),
  /** idle hairline: the console's --line-strong, lit just enough to be read */
  hair: new Color("#3b5266"),
  cool: new Color("#cfe6ff"),
} as const;
