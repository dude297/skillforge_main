// Ember's Living System (#/world/moonshot): interaction, keyboard, viewports, reduced motion, refusal, pending approval.
// Most tests run with prefers-reduced-motion so the graph is settled and the camera is instant; one block covers real motion.
import { expect, test, type Page } from "@playwright/test";

const ROUTE = "/#/world/moonshot";
const settled = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(ROUTE);
  await expect(page.getByTestId("ms-root")).toBeVisible();
  await expect(page.locator('[data-id="ember"]')).toBeVisible();
  await expect(page.locator(".ms-beat[aria-current=step]")).toContainText("Refuse");
};
const node = (page: Page, id: string) => page.locator(`.ms-svg .ms-node[data-id="${id}"]`);
const edge = (page: Page, id: string) => page.locator(`.ms-svg .ms-edge[data-id="${id}"]`);
const beat = (page: Page, b: string) => page.locator(`.ms-beat[data-beat="${b}"]`).click();
const fit = (page: Page) => page.getByRole("button", { name: "Fit to graph" }).click();
const inspector = (page: Page) => page.getByTestId("ms-inspector");
const PRIMARY = "edge:gateway-recovery";

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Ember is the existing sprite at the centre; provenance chip says RECORDED SIMULATION", async ({ page }) => {
    await settled(page);
    await fit(page);
    await expect(page.getByTestId("ms-chip")).toHaveText("RECORDED SIMULATION");
    await expect(page.getByTestId("ms-banner")).toContainText("Reference skill hand-written");
    await expect(page.getByTestId("ms-banner")).toContainText("Approval simulated by an agent, not a person");
    expect(await page.locator(".ms-ember rect").count(), "the 28x24 Mascot sprite is drawn, not a plain orb").toBeGreaterThan(40);
    const c = await page.getByTestId("ms-canvas").boundingBox();
    const e = await page.locator(".ms-ember").boundingBox();
    expect(Math.abs(e!.x + e!.width / 2 - (c!.x + c!.width / 2)), "Ember horizontally central").toBeLessThan(c!.width * 0.1);
    expect(e!.y).toBeGreaterThan(c!.y - 1);
    expect(e!.y + e!.height).toBeLessThan(c!.y + c!.height + 1);
  });

  test("hover and focus show a popover with name, status and source", async ({ page }) => {
    await settled(page);
    await fit(page);
    await node(page, "plinth").hover();
    const pop = page.getByTestId("ms-pop");
    await expect(pop).toContainText("Workspace host");
    await expect(pop).toContainText("RECORDED SIMULATION");
    await page.mouse.move(5, 500);
    await expect(pop).toHaveCount(0);
    await node(page, "skill").focus();
    await expect(pop).toContainText("oncall-serving-config");
    await expect(pop).toContainText("Approved (SIMULATED)");
  });

  test("click a node opens the inspector; Escape closes it and returns focus", async ({ page }) => {
    await settled(page);
    await fit(page);
    await node(page, "gate").click();
    const insp = inspector(page);
    await expect(insp).toContainText("Host approval");
    await expect(insp).toContainText("Decided by a person");
    await expect(insp).toContainText("NO: simulated by an agent");
    await expect(insp).toContainText("cannot approve, promote or execute");
    await page.keyboard.press("Escape");
    await expect(insp).toHaveCount(0);
    await expect(node(page, "gate")).toBeFocused();
  });

  test("clicking empty canvas closes the inspector", async ({ page }) => {
    await settled(page);
    await fit(page);
    await node(page, "skill").click();
    await expect(inspector(page)).toBeVisible();
    const c = await page.getByTestId("ms-canvas").boundingBox();
    await fit(page);
    await page.mouse.click(c!.x + c!.width / 2, c!.y + 12);
    await expect(inspector(page)).toHaveCount(0);
  });

  test("primary edge: Connection Inspector with Overview / Before / Proposed / Evidence / Permissions", async ({ page }) => {
    await settled(page);
    await fit(page);
    await edge(page, PRIMARY).locator(".ms-mk-bg").click();
    const insp = inspector(page);
    await expect(insp).toContainText("Inference Gateway to Incident Recovery");
    await expect(insp.getByRole("tab")).toHaveText(["Overview", "Before", "Proposed", "Evidence", "Permissions"]);
    await expect(insp).toContainText("Suggested only");

    await insp.getByRole("tab", { name: "Before" }).click();
    await expect(page.getByTestId("ms-baseline-label")).toContainText("CONCEPTUAL baseline. Not measured.");
    await expect(insp).toContainText("Steps / latency / cost");

    await insp.getByRole("tab", { name: "Proposed" }).click();
    await expect(insp).toContainText("Compare paths");
    await expect(insp.getByText("REMOVED")).toBeVisible();
    await expect(insp.getByText("RETAINED").first()).toBeVisible();
    await expect(insp).toContainText("Approving the skill does not remove per-action approval");
    await expect(insp).toContainText("Estimated benefit");
    await expect(insp.locator(".row", { hasText: "Estimated benefit" })).toContainText("Not measured");
    await expect(insp.locator(".row", { hasText: "Rollback" })).toContainText("Not exposed in this UI");

    await insp.getByRole("tab", { name: "Evidence" }).click();
    await expect(insp).toContainText("Hidden suite 9/9");
    await expect(insp).toContainText("hidden: num_seqs_raised_oom: passed");
    await expect(insp.getByRole("link", { name: /Guided demo/ })).toHaveAttribute("href", "#/demo");

    await insp.getByRole("tab", { name: "Permissions" }).click();
    await expect(insp).toContainText("SIMULATED by an agent in this recording; not a person's");
    await expect(insp).toContainText("cannot approve, promote or execute");
  });

  test("no approve / execute / mutation control exists anywhere on the page", async ({ page }) => {
    await settled(page);
    await fit(page);
    await edge(page, PRIMARY).locator(".ms-mk-bg").click();
    for (const t of ["Overview", "Before", "Proposed", "Evidence", "Permissions"]) {
      await inspector(page).getByRole("tab", { name: t }).click();
      const bad = page.getByRole("button", { name: /^(approve|promote|execute|deploy|apply|reject|rollback|activate)\b/i });
      await expect(bad).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /approve & deploy|approve and/i })).toHaveCount(0);
  });

  test("INC-2 reuse path shows model_calls: 0 from the payload; INC-3 refusal explains why", async ({ page }) => {
    await settled(page);
    await fit(page);
    await expect(page.getByTestId("ms-caption")).toContainText("INC-3 is refused");
    await edge(page, "edge:skill-workflow").locator(".ms-mk-bg").click();
    await expect(page.getByTestId("ms-model-calls")).toHaveText("0");
    await expect(page.getByTestId("ms-reuse-note")).toContainText("256 ms (recorded)");
    await expect(page.getByTestId("ms-reuse-note")).toContainText("SIMULATED");

    await fit(page);
    await edge(page, "edge:router-refusal").locator(".ms-mk-bg").click();
    const why = page.getByTestId("ms-refusal-reason");
    await expect(why).toContainText("fingerprint differs");
    await expect(why).toContainText("OSError");
    await expect(why).toContainText("disk_full");
    await expect(why).toContainText("gpu_oom");
    const refused = node(page, "refusal");
    await expect(refused).toHaveAttribute("data-state", "refused");
    await expect(refused).not.toContainText(/verified|approved|success|passed/i);
    await expect(edge(page, "edge:router-refusal")).toHaveAttribute("data-state", "refused");
  });

  test("replay timeline: each beat is steppable, skippable and replayable; refuse beat shows the refused branch", async ({ page }) => {
    await page.goto(ROUTE);
    await page.getByRole("button", { name: "Skip intro" }).click();
    await beat(page, "bootstrap");
    await expect(node(page, "skill")).toHaveCount(0);
    await expect(node(page, "plinth")).toHaveAttribute("data-state", "configured");
    await expect(node(page, "src:log")).toHaveAttribute("data-state", "discovered");
    await beat(page, "propose");
    await expect(node(page, "skill")).toHaveAttribute("data-state", "proposed");
    await beat(page, "test");
    await expect(node(page, "verifier")).toHaveAttribute("data-state", "tested");
    await expect(node(page, "skill")).toHaveAttribute("data-state", "tested");
    await expect(node(page, "refusal")).toHaveCount(0);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("ms-stopped")).toBeVisible();
    await expect(node(page, "gate")).toHaveAttribute("data-state", "awaiting_approval");
    await page.getByRole("button", { name: /Continue replay/ }).click();
    await expect(node(page, "gate")).toHaveAttribute("data-state", "approved_simulated");
    await expect(node(page, "gate")).not.toHaveAttribute("data-state", "approved");
    await beat(page, "refuse");
    await expect(node(page, "refusal")).toHaveAttribute("data-state", "refused");
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.locator(".ms-beat[aria-current=step]")).toContainText("Bootstrap");
  });

  test("accessible list selects nodes and connections", async ({ page }) => {
    await settled(page);
    await page.locator(".ms-list summary").click();
    await page.locator('.ms-list [data-list="verifier"]').click();
    await expect(inspector(page)).toContainText("Independent tests");
    await page.locator('.ms-list [data-list="edge:gateway-recovery"]').click();
    await expect(inspector(page).getByRole("tab", { name: "Before" })).toBeVisible();
  });

  test("Ember click opens What I am doing with the real state", async ({ page }) => {
    await settled(page);
    await page.locator('.ms-ember').click();
    const insp = inspector(page);
    await expect(insp).toContainText("What I am doing");
    await expect(insp).toContainText("No active task");
    await expect(insp).toContainText("replay of a recording");
    await expect(insp).toContainText("Ember cannot approve");
  });

  test("illustration mode is separate: chip changes, no recorded nodes, example nodes marked not built", async ({ page }) => {
    await settled(page);
    await page.getByTestId("ms-illustration-toggle").click();
    await expect(page.getByTestId("ms-chip")).toHaveText("ILLUSTRATION");
    await expect(node(page, "skill")).toHaveCount(0);
    await expect(node(page, "ill:git")).toHaveAttribute("data-state", "unavailable");
    await expect(page.getByTestId("ms-banner")).toContainText("NOT built or connected");
    await page.getByTestId("ms-illustration-toggle").click();
    await expect(page.getByTestId("ms-chip")).toHaveText("RECORDED SIMULATION");
    await expect(node(page, "ill:git")).toHaveCount(0);
  });
});

test.describe("keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("Tab reaches nodes and edges; Enter and Space select; Escape closes; tabs use arrow keys", async ({ page }) => {
    await settled(page);
    await fit(page);
    await node(page, "plinth").focus();
    await page.keyboard.press("Enter");
    await expect(inspector(page)).toContainText("Workspace host");
    await page.keyboard.press("Escape");
    await expect(inspector(page)).toHaveCount(0);
    await expect(node(page, "plinth")).toBeFocused();

    const focusable = await page.locator(".ms-svg [role=button][tabindex='0']").count();
    expect(focusable).toBeGreaterThan(20);
    await node(page, "service").focus();
    let sawEdge = false;
    for (let i = 0; i < 40 && !sawEdge; i++) {
      await page.keyboard.press("Tab");
      sawEdge = await page.evaluate(() => document.activeElement?.classList.contains("ms-edge") ?? false);
    }
    expect(sawEdge, "Tab reaches an edge").toBe(true);
    await page.keyboard.press("Space");
    await expect(inspector(page)).toHaveAttribute("data-kind", "edge");
    await page.keyboard.press("Escape");
    await expect(inspector(page)).toHaveCount(0);

    await edge(page, PRIMARY).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Before" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("ms-baseline-label")).toBeVisible();
  });
});

test.describe("phone 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("one focal cluster, no horizontal overflow, inspector is a bottom sheet that does not cover the graph", async ({ page }) => {
    await settled(page);
    const over = await page.evaluate(() => { const d = document.documentElement; return Math.max(d.scrollWidth - d.clientWidth, document.body.scrollWidth - d.clientWidth); });
    expect(over).toBeLessThanOrEqual(0);
    await expect(page.locator(".ms-list")).toHaveAttribute("open", "");
    await page.locator('.ms-list [data-list="edge:gateway-recovery"]').click();
    const insp = inspector(page);
    await expect(insp).toBeVisible();
    await expect(insp.getByRole("tab", { name: "Proposed" })).toBeVisible();
    const sheet = await insp.boundingBox();
    const cv = await page.getByTestId("ms-canvas").boundingBox();
    expect(Math.abs(sheet!.y + sheet!.height - 844), "sheet is anchored to the bottom").toBeLessThan(2);
    expect(sheet!.width).toBeGreaterThan(385);
    expect(cv!.y + cv!.height, "sheet does not overlap the canvas").toBeLessThanOrEqual(sheet!.y + 2);
    expect(cv!.height).toBeGreaterThan(200);
    await insp.getByRole("tab", { name: "Proposed" }).click();
    await expect(insp).toContainText("Compare paths");
    const fs = await insp.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs, "readable text").toBeGreaterThanOrEqual(14);
    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(insp).toHaveCount(0);
  });

  test("phone graph hides sublabels and shows a focused cluster", async ({ page }) => {
    await settled(page);
    await beat(page, "refuse");
    await expect(node(page, "refusal")).toBeVisible();
    const sub = node(page, "refusal").locator(".ms-sub");
    await expect(sub).toBeHidden();
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("settled graph: no intro, no running animation, no beam, no particles; inspection still works", async ({ page }) => {
    await settled(page);
    await expect(page.getByTestId("ms-root")).toHaveAttribute("data-intro", "false");
    await expect(page.getByTestId("ms-intro")).toHaveCount(0);
    await page.waitForTimeout(400);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect | null)?.target?.closest?.(".ms-root")).length);
    expect(running, "no running animation inside the Living System").toBe(0);
    await expect(page.locator(".ms-beam, .ms-particle, .ms-halo-pulse, .ms-orbit")).toHaveCount(0);
    await expect(page.locator(".ms-svg animateMotion")).toHaveCount(0);
    await expect(page.locator(".ms-beat[aria-current=step]")).toContainText("Refuse");
    await node(page, "refusal").click();
    await expect(inspector(page)).toContainText("fingerprint");
    await expect(page.getByTestId("ms-chip")).toHaveText("RECORDED SIMULATION");
  });
});

test.describe("real motion: intro and autoplay", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("intro is skippable; autoplay stops at the pending approval and never passes it on its own", async ({ page }) => {
    test.setTimeout(75_000);
    await page.goto(ROUTE);
    await expect(page.getByTestId("ms-intro")).toBeVisible();
    await expect(page.locator(".ms-halo-ring")).toHaveCount(1);
    await expect(page.getByTestId("ms-root")).toHaveAttribute("data-beat", "bootstrap");
    await expect(page.getByTestId("ms-stopped")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("ms-root")).toHaveAttribute("data-beat", "approval");
    await expect(node(page, "gate")).toHaveAttribute("data-state", "awaiting_approval");
    await page.waitForTimeout(5000);
    await expect(page.getByTestId("ms-root")).toHaveAttribute("data-beat", "approval");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    await expect(node(page, "gate")).toHaveAttribute("data-state", "awaiting_approval");
    await expect(node(page, "router")).toHaveCount(0);
  });

  test("skip intro, then replay restarts the tour from bootstrap", async ({ page }) => {
    await page.goto(ROUTE);
    await page.getByRole("button", { name: "Skip intro" }).click();
    await expect(page.getByTestId("ms-intro")).toHaveCount(0);
    await beat(page, "reuse");
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByTestId("ms-root")).toHaveAttribute("data-beat", "bootstrap");
  });
});
