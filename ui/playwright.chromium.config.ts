import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Same suite as playwright.config.ts, for machines without Microsoft Edge (CI, cloud sandboxes).
// PW_CHROMIUM_PATH points at any Chromium binary; unset, Playwright's bundled Chromium is used.
// PORT lets several checkouts test side by side (default 4173).
const exe = process.env.PW_CHROMIUM_PATH;
const port = process.env.PORT ?? "4173";
const url = `http://127.0.0.1:${port}/`;
export default defineConfig({
  ...base,
  // software WebGL (SwiftShader) compiles the intro's shaders on the CPU and can hold the main thread for seconds while
  // the suite runs in parallel; give assertions more time here only. No assertion is loosened.
  expect: { timeout: 10_000 },
  use: {
    ...base.use,
    baseURL: url,
    channel: undefined,
    launchOptions: exe ? { executablePath: exe, args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] } : undefined,
  },
  webServer: { command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`, url, reuseExistingServer: true },
});
