import { defineConfig } from "@playwright/test";

// Runs against the production build (vite preview) in the locally installed Microsoft Edge: no browser download.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4173/", channel: "msedge", trace: "retain-on-failure" },
  webServer: { command: "npx vite preview --host 127.0.0.1 --port 4173 --strictPort", url: "http://127.0.0.1:4173/", reuseExistingServer: true },
});
