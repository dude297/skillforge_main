// Drives the interactive parts of the hosted preview so QA tools see more than first paint: the console workflow
// (Start, then every scripted step button the page offers), the guided demo with the keyboard, and the source switch.
// Selectors are roles and name prefixes, not copy-exact strings, so rewording does not break it. Never throws on a
// missing control: the caller asserts on the invariants it cares about (requests, errors, violations).
// Scripted decisions in Preview/Recorded are named "Simulate …" (approval, promotion, learning a skill); the plain
// names are kept so the script still works against older builds. Rejection is driven separately by the e2e suite.
const STEP = /^(start|simulate (approval|promotion|learning)|approve|turn this|promote|run on)/i;

export async function runConsoleWorkflow(page, { maxSteps = 10 } = {}) {
  const clicked = [];
  await page.goto("#/console/investigations");
  for (let i = 0; i < maxSteps; i++) {
    const btn = page.getByRole("button", { name: STEP }).first();
    try { await btn.waitFor({ state: "visible", timeout: 6000 }); } catch { break; }
    clicked.push((await btn.textContent())?.trim() ?? "");
    await btn.click();
    await page.waitForTimeout(400);
  }
  return clicked;
}

export async function stepDemo(page, { steps = 8 } = {}) {
  await page.goto("#/demo");
  await page.waitForTimeout(500);
  await page.keyboard.press("Space"); // pause autoplay if any, so the arrows are deterministic
  for (let i = 0; i < steps; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250); }
  await page.keyboard.press("n");
  for (let i = 0; i < steps; i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(120); }
}

/** Switch every source the console offers. Returns the accessible names of the options it clicked. */
export async function switchConsoleSources(page) {
  const names = [];
  await page.goto("#/console/overview");
  const radios = page.getByRole("radio");
  const n = await radios.count();
  for (let i = 0; i < n; i++) {
    const r = radios.nth(i);
    const name = ((await r.evaluate((el) => el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? "")) || "").trim();
    if (!name) continue;
    names.push(name);
    await r.evaluate((el) => el.closest("label")?.click() ?? el.click());
    await page.waitForTimeout(250);
  }
  return names;
}

export async function exerciseAll(page) {
  const out = {};
  out.workflow = await runConsoleWorkflow(page);
  await stepDemo(page);
  out.sources = await switchConsoleSources(page);
  return out;
}
