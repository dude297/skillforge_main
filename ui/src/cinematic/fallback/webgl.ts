// Capability and quality detection for the film. Everything here is conservative: when in doubt, the poster.
import type { Quality } from "../contract";

let cached: boolean | null = null;

/** Can this browser make a WebGL context at all? (Blocked, disabled, headless without GPU, exhausted contexts: all say no.) */
export function canUseWebGL(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    cached = !!gl && typeof gl.getParameter === "function";
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // hand the context back immediately
  } catch {
    cached = false;
  }
  return cached;
}

/** Phones and modest machines get the low tier: fewer pixels, no post-processing. */
export function detectQuality(reducedMotion: boolean, force?: "high" | "low"): Quality {
  const probe = (): boolean => {
    try {
      const phone = window.matchMedia("(max-width: 768px)").matches;
      const cores = navigator.hardwareConcurrency || 8;
      const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
      return phone || cores <= 4 || mem <= 4;
    } catch { return true; }
  };
  const low = force ? force === "low" : probe();
  return low
    ? { tier: "low", postfx: false, dpr: [1, 1.5] }
    : { tier: "high", postfx: !reducedMotion, dpr: [1, 2] };
}
