// Shared browser launcher for the QA scripts. Default: the installed Microsoft Edge (no download), as before.
// Set PW_CHROMIUM_PATH to any Chromium binary to run the same scripts on a machine without Edge (CI, cloud sandbox).
import { chromium } from "@playwright/test";

export function launchBrowser(opts = {}) {
  const exe = process.env.PW_CHROMIUM_PATH;
  return exe
    ? chromium.launch({ ...opts, executablePath: exe, args: ["--no-sandbox", "--no-zygote", "--disable-gpu", ...(opts.args ?? [])] })
    : chromium.launch({ channel: "msedge", ...opts });
}
