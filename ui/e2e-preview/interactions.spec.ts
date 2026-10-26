import type { Page } from "@playwright/test";
import { MUTATING_NAME, ROUTES } from "../scripts/lib/routes.mjs";
import { runConsoleWorkflow, stepDemo, switchConsoleSources } from "../scripts/lib/exercise.mjs";
import { dataRequests, expect, liveSourceControls, previewStrip, settle, test } from "./guard";

// The guard fixture (auto) fails every test here if any request leaves the origin, touches the operator API (/ui/*),
// is not a GET, or if a console/page error occurs. The assertions below are about behaviour that must still hold.

const originOf = (page: Page) => new URL(page.url()).origin;

test("investigation workflow: start, approve, learn, promote, reuse; every step is local and says nothing is sent", async ({ page, net }) => {
  const before = net.mark();
  const clicked: string[] = await runConsoleWorkflow(page);
  expect(clicked.length, "the scripted workflow progressed through several steps").toBeGreaterThanOrEqual(3);
  // a public preview must never present a scripted decision as a real one
  for (const name of clicked.filter((n) => MUTATING_NAME.test(n))) expect(name, "scripted decisions are labelled as simulations").toMatch(/^simulate/i);
  expect(dataRequests(net.since(before)), "no network traffic besides lazy code chunks").toEqual([]);
  await expect(previewStrip(page)).toHaveCount(0);
  expect(await liveSourceControls(page)).toEqual([]);
  test.info().annotations.push({ type: "scripted-controls-clicked", description: clicked.join(" > ") });
});

test("rejecting a proposal is local and the workflow ends without an applied change", async ({ page, net }) => {
  await page.goto("/#/console/investigations");
  await page.getByRole("button", { name: /^start/i }).click();
  const reject = page.getByRole("button", { name: /^(simulate )?reject/i }).first();
  await reject.waitFor({ state: "visible", timeout: 15_000 });
  const before = net.mark();
  await reject.click();
  await page.waitForTimeout(500);
  expect(net.since(before)).toEqual([]);
});

test("model offline / connection drop / verification failure rehearsals stay local", async ({ page, net }) => {
  for (const label of [/model offline/i, /connection drops/i, /verification fails/i]) {
    await page.goto("/#/console/investigations");
    await settle(page, 300);
    const box = page.getByLabel(label);
    if (await box.count() === 0) { test.info().annotations.push({ type: "note", description: `no checkbox for ${label}` }); continue; }
    await box.check();
    const before = net.mark();
    const clicked = await runConsoleWorkflow(page, { maxSteps: 3 }); // loads the page again; re-check the box afterwards is not needed
    expect(clicked.length).toBeGreaterThan(0);
    expect(dataRequests(net.since(before))).toEqual([]);
  }
});

test("guided demo: keyboard steps change the scene and never touch the network", async ({ page, net }) => {
  await page.goto("/#/demo");
  await settle(page, 600);
  await page.keyboard.press("Space"); // stop autoplay so the arrows are deterministic
  const text0 = await page.locator("#root").innerText();
  const before = net.mark();
  await stepDemo(page, { steps: 6 });
  const text1 = await page.locator("#root").innerText();
  expect(dataRequests(net.since(before))).toEqual([]);
  expect(new URL(page.url()).hash).toBe("#/demo");
  expect(text1, "stepping through the demo changed what is on screen").not.toBe(text0);
  await expect(previewStrip(page)).toHaveCount(0);
});

test("presenter route survives keyboard use", async ({ page }) => {
  await page.goto("/#/demo/pitch");
  await settle(page, 500);
  for (const k of ["ArrowRight", "ArrowRight", "ArrowLeft", "n", "n"]) { await page.keyboard.press(k); await page.waitForTimeout(150); }
  await expect(previewStrip(page)).toHaveCount(0);
});

test.describe("console sources", () => {
  for (const section of ["overview", "investigations", "skills", "history", "benchmarks", "system"]) {
    test(`#/console/${section}: no Live option; switching every offered source is local`, async ({ page, net }) => {
      await page.goto(`/#/console/${section}`);
      await settle(page, 500);
      expect(await liveSourceControls(page)).toEqual([]);
      const before = net.mark();
      const offered: string[] = await switchConsoleSources(page); // visits overview and clicks each radio
      expect(offered.length, "at least one source radio").toBeGreaterThan(0);
      expect(offered.filter((n) => /^live\b/i.test(n)), "Live offered").toEqual([]);
      expect(dataRequests(net.since(before))).toEqual([]);
    });
  }

  test("?source=live in the URL cannot select Live", async ({ page, net }) => {
    for (const path of ["/?source=live#/console/overview", "/?source=live#/console/investigations", "/?source=live#/world"]) {
      await page.goto(path);
      await settle(page, 500);
      expect(await liveSourceControls(page), path).toEqual([]);
      await expect(page.getByText(/not connected to a live system/i), `${path}: live view rendered`).toHaveCount(0);
      await expect(previewStrip(page)).toHaveCount(0);
    }
    expect(net.requests.filter((r) => new URL(r.url).pathname.split("/").includes("ui"))).toEqual([]);
  });

  test("world source switch (recorded / oncall) offers no Live", async ({ page }) => {
    await page.goto("/#/world");
    await settle(page, 600);
    const radios = page.getByRole("radio");
    const n = await radios.count();
    for (let i = 0; i < n; i++) {
      await radios.nth(i).evaluate((el) => (el.closest("label") as HTMLElement | null)?.click() ?? (el as HTMLElement).click());
      await page.waitForTimeout(300);
      expect(await liveSourceControls(page)).toEqual([]);
    }
  });
});

test.describe("approve / promote / execute / reject / rollback controls", () => {
  for (const r of ROUTES) {
    test(`${r.hash}: no such control reaches the network (all are scripted or show a host command)`, async ({ page, net }) => {
      // reach the states where these controls exist
      if (r.hash.startsWith("#/console/investigations") && !r.hash.endsWith("incident")) await runConsoleWorkflow(page, { maxSteps: 2 });
      else { await page.goto(`/${r.hash}`); await settle(page, 700); }

      const found: string[] = [];
      for (const role of ["button", "link"] as const) {
        const loc = page.getByRole(role, { name: MUTATING_NAME });
        for (let i = 0; i < await loc.count(); i++) {
          const el = loc.nth(i);
          const name = ((await el.getAttribute("aria-label")) ?? (await el.innerText().catch(() => ""))).trim().replace(/\s+/g, " ");
          found.push(`${role}: ${name}`);
          if (role === "link") {
            const href = (await el.getAttribute("href")) ?? "";
            expect(href === "" || /^[#?]/.test(href), `link "${name}" must stay in this page (href=${href})`).toBe(true);
          }
        }
      }
      if (found.length) test.info().annotations.push({ type: "controls", description: found.join(" | ") });

      const before = net.mark();
      const buttons = page.getByRole("button", { name: MUTATING_NAME });
      const start = page.url();
      for (let i = 0; i < Math.min(await buttons.count(), 6); i++) {
        const b = buttons.nth(i);
        if (!(await b.isVisible()) || !(await b.isEnabled())) continue;
        await b.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(250);
      }
      expect(dataRequests(net.since(before)), "clicking these controls made requests").toEqual([]);
      expect(originOf(page)).toBe(new URL(start).origin);
    });
  }
});

test.describe("click every visible button once, per route", () => {
  for (const r of ROUTES) {
    test(`${r.hash}: no button reaches the network`, async ({ page, net }) => {
      test.setTimeout(150_000);
      await page.goto(`/${r.hash}`);
      await settle(page, 700);
      const before = net.mark();
      const cap = 25;
      for (let i = 0; i < cap; i++) {
        const buttons = page.locator("button:visible:not([disabled])");
        if (i >= await buttons.count()) break;
        await buttons.nth(i).click({ timeout: 1500, noWaitAfter: true }).catch(() => {});
        await page.waitForTimeout(120);
        if (new URL(page.url()).hash.split("/").slice(0, 3).join("/") !== r.hash.split("/").slice(0, 3).join("/")) { await page.goto(`/${r.hash}`); await settle(page, 300); }
      }
      expect(dataRequests(net.since(before)), "a button caused a request").toEqual([]);
    });
  }

  test("story: scrolling the whole page makes no requests beyond code chunks", async ({ page, net }) => {
    await page.goto("/#/story");
    await settle(page, 500);
    const before = net.mark();
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 500) { await page.mouse.wheel(0, 500); await page.waitForTimeout(60); }
    expect(dataRequests(net.since(before))).toEqual([]);
  });
});
