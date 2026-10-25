import { defineConfig } from "@playwright/test";

// LIVE integration: the spec starts the real operator API (`python -m app ui`) and a real mock-agent rehearsal
// (scripts/rehearse.py -> `python -m app serve`) itself, against a throwaway database. Needs `npm run build` first.
export default defineConfig({
  testDir: "e2e-live",
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
  use: { channel: "msedge", trace: "retain-on-failure", reducedMotion: "reduce" },
});
