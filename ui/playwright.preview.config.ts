import { defineConfig } from "@playwright/test";

// Suite for the HOSTED PREVIEW build: `VITE_PREVIEW=1 npm run build` first (npm run build:preview), then
//   PW_CHROMIUM_PATH=/path/to/chromium PORT=4173 npx playwright test -c playwright.preview.config.ts
// It serves dist with `vite preview` and refuses to run against a normal build (see e2e-preview/preview-build.spec.ts).
// PW_CHROMIUM_PATH: any Chromium binary (unset: Playwright's bundled Chromium, or PW_CHANNEL=msedge). PORT: default 4173.
const exe = process.env.PW_CHROMIUM_PATH;
const port = process.env.PORT ?? "4173";
const url = `http://127.0.0.1:${port}/`;
export default defineConfig({
  testDir: "e2e-preview",
  timeout: 90_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: url,
    channel: exe ? undefined : process.env.PW_CHANNEL,
    launchOptions: exe ? { executablePath: exe, args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] } : undefined,
    trace: "retain-on-failure",
  },
  webServer: { command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`, url, reuseExistingServer: true },
});
