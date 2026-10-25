// Ember's Living System: the visual projection never says more than the artifact. Pure logic (no browser) over the real
// recorded OnCall run, plus a few page-level trust checks (no write requests; no operator API in the hosted preview).
import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import type { OnCallRun } from "../src/data/oncall";
import { projectOnCallToGraph, resolveAt } from "../src/moonshot/projection";
import { illustrationGraph } from "../src/moonshot/fixtures";
import { BEATS, clean, type BeatId, type MoonshotGraph } from "../src/moonshot/types";

const recorded = (): OnCallRun => JSON.parse(readFileSync(new URL("../public/demo/oncall-run.recorded.json", import.meta.url), "utf-8")) as OnCallRun;
const at = (g: MoonshotGraph, id: string, b: BeatId) => { const n = g.nodes.find((x) => x.id === id) ?? g.edges.find((x) => x.id === id); return n ? resolveAt(n, b) : null; };
const beatOf = (g: MoonshotGraph, id: BeatId) => g.beats.find((b) => b.id === id)!;

test.describe("projection is pure and deterministic", () => {
  test("same input, same graph; input is not mutated", () => {
    const run = recorded(), before = JSON.stringify(run);
    const a = projectOnCallToGraph(run, "file"), b = projectOnCallToGraph(run, "file");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(run)).toBe(before);
    expect(a.nodes.length).toBeGreaterThanOrEqual(10);
    expect(a.nodes.length).toBeLessThanOrEqual(25);
    expect(a.edges.length).toBeLessThanOrEqual(40);
    expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
    expect(new Set(a.edges.map((e) => e.id)).size).toBe(a.edges.length);
    for (const e of a.edges) { expect(a.nodes.some((n) => n.id === e.from), e.id).toBe(true); expect(a.nodes.some((n) => n.id === e.to), e.id).toBe(true); }
  });

  test("the recorded artifact is labelled RECORDED SIMULATION, reference skill, simulated approval", () => {
    const g = projectOnCallToGraph(recorded(), "file");
    expect(g.mode).toBe("recorded");
    expect(g.modeLabel).toBe("RECORDED SIMULATION");
    expect(g.truth).toMatchObject({ referenceSkill: true, approvalSimulated: true, approvalPending: true, reuseDone: true, refused: true, modelCalls: 0 });
    expect(g.banner).toMatch(/hand-written/);
    expect(g.banner).toMatch(/simulated by an agent, not a person/);
    expect(projectOnCallToGraph(recorded(), "endpoint").modeLabel).toBe("RECORDED SIMULATION");
  });

  test("LIVE LOCAL only for a real-model run served by the endpoint", () => {
    const r = recorded();
    r.mode = "LIVE_REAL_MODEL"; r.synthesis!.provenance = "model";
    expect(projectOnCallToGraph(r, "endpoint").modeLabel).toBe("LIVE LOCAL");
    expect(projectOnCallToGraph(r, "file").modeLabel).toBe("RECORDED SIMULATION");
    r.synthesis!.provenance = "recorded_reference";
    expect(projectOnCallToGraph(r, "endpoint").modeLabel).toBe("RECORDED SIMULATION");
  });
});

test.describe("verified / approved / executed stay distinct", () => {
  test("a simulated approval is never 'approved' (a person's); host_cli is", () => {
    const g = projectOnCallToGraph(recorded(), "file");
    for (const b of BEATS) for (const id of ["gate", "skill", "edge:gateway-recovery", "edge:verifier-gate"]) {
      const r = at(g, id, b);
      if (r) { expect(r.state, `${id}@${b}`).not.toBe("approved"); expect(r.state, `${id}@${b}`).not.toBe("verified"); }
    }
    expect(at(g, "gate", "reuse")?.state).toBe("approved_simulated");
    const run = recorded(); run.approval!.kind = "host_cli"; run.approval!.by = "ops-oncall";
    const h = projectOnCallToGraph(run, "file");
    expect(at(h, "gate", "reuse")?.state).toBe("approved");
    expect(h.truth.approvalSimulated).toBe(false);
  });

  test("tests passed is not host-approved; approval waits at the approval beat even though the artifact later records an approval", () => {
    const g = projectOnCallToGraph(recorded(), "file");
    expect(at(g, "skill", "test")?.state).toBe("tested");
    expect(at(g, "verifier", "test")?.state).toBe("tested");
    expect(at(g, "gate", "test")).toBeNull();
    expect(at(g, "gate", "approval")?.state).toBe("awaiting_approval");
    expect(at(g, "skill", "approval")?.state).toBe("awaiting_approval");
    expect(at(g, "edge:gateway-recovery", "approval")?.state).toBe("awaiting_approval");
    expect(beatOf(g, "approval").gate).toBe(true);
  });

  test("model_calls is 0 only when the payload says 0; otherwise Not measured; hand-written reference is not model output", () => {
    const run = recorded();
    expect(projectOnCallToGraph(run, "file").edges.find((e) => e.id === "edge:skill-workflow")?.modelCalls).toBe(0);
    run.reuse!.model_calls = null;
    const g = projectOnCallToGraph(run, "file");
    const e = g.edges.find((x) => x.id === "edge:skill-workflow")!;
    expect(e.modelCalls).toBeNull();
    expect(e.relation).toContain("Not measured");
    expect(beatOf(g, "reuse").caption).toContain("Not measured");
    expect(beatOf(g, "reuse").caption).not.toMatch(/model_calls: 0/);
    run.reuse!.model_calls = 3;
    expect(projectOnCallToGraph(run, "file").edges.find((x) => x.id === "edge:skill-workflow")?.modelCalls).toBe(3);
    const s = projectOnCallToGraph(recorded(), "file").nodes.find((n) => n.id === "skill")!;
    expect(s.summary).toMatch(/hand-written reference skill, not model output/);
    expect(s.facts.find(([k]) => k === "Model calls (synthesis)")?.[1]).toBe("Not measured");
  });

  test("unknown metrics stay null: no improvement percent, no latency for the primary edge before measurement", () => {
    const run = recorded(); run.reuse!.latency_ms = null;
    const g = projectOnCallToGraph(run, "file");
    for (const e of g.edges) expect(e.improvementPct, e.id).toBeNull();
    expect(g.edges.find((e) => e.primary)?.latencyMs).toBeNull();
  });
});

test.describe("fail closed", () => {
  test("pending approval locks reuse and refusal", () => {
    const run = recorded(); run.approval = { ...run.approval!, state: "pending", by: null, at: null, kind: null };
    const g = projectOnCallToGraph(run, "file");
    expect(beatOf(g, "approval").unlocked).toBe(true);
    expect(beatOf(g, "approval").gate).toBe(true);
    expect(beatOf(g, "reuse").unlocked).toBe(false);
    expect(beatOf(g, "refuse").unlocked).toBe(false);
    expect(g.nodes.find((n) => n.id === "gate") && at(g, "gate", "refuse")?.state).toBe("awaiting_approval");
    expect(g.edges.some((e) => e.id === "edge:skill-workflow")).toBe(false);
    expect(g.edges.some((e) => e.id === "edge:router-refusal")).toBe(false);
    expect(g.truth.reuseDone).toBe(false);
  });

  test("rejected approval is refused, not approved, and unlocks nothing", () => {
    const run = recorded(); run.approval!.state = "rejected";
    const g = projectOnCallToGraph(run, "file");
    expect(at(g, "gate", "approval")?.state).toBe("refused");
    expect(beatOf(g, "reuse").unlocked).toBe(false);
  });

  test("failed or missing verification: no approval step, no reuse", () => {
    const failed = recorded(); failed.verification!.passed = false;
    const g = projectOnCallToGraph(failed, "file");
    expect(at(g, "skill", "test")?.state).toBe("failed");
    expect(beatOf(g, "approval").unlocked).toBe(false);
    expect(beatOf(g, "reuse").unlocked).toBe(false);
    expect(g.emberByBeat.test).toBe("error");
    const unknown = recorded(); unknown.verification!.passed = null;
    const u = projectOnCallToGraph(unknown, "file");
    expect(at(u, "verifier", "test")?.state).toBe("unknown");
    expect(at(u, "verifier", "test")?.label).toBe("Not measured");
    expect(beatOf(u, "approval").unlocked).toBe(false);
  });

  test("no refusal recorded: no refused branch is drawn", () => {
    const run = recorded(); run.refusal = { incident_id: "INC-3", state: null, reason: null };
    const g = projectOnCallToGraph(run, "file");
    expect(beatOf(g, "refuse").unlocked).toBe(false);
    expect(g.edges.some((e) => e.kind === "blocked")).toBe(false);
  });

  test("INC-3 refusal carries the real reason from the artifact", () => {
    const run = recorded();
    const g = projectOnCallToGraph(run, "file");
    const ref = g.nodes.find((n) => n.id === "refusal")!;
    expect(ref.facts.find(([k]) => k.startsWith("Reason"))?.[1]).toContain("exception_type: 'torch.OutOfMemoryError' -> 'OSError'");
    expect(g.edges.find((e) => e.id === "edge:router-refusal")?.reason).toContain("failure_category: 'gpu_oom' -> 'disk_full'");
    expect(at(g, "refusal", "refuse")?.state).toBe("refused");
    expect(at(g, "edge:router-refusal", "refuse")?.state).toBe("refused");
    expect(at(g, "refusal", "reuse")).toBeNull();
  });

  test("no artifact: unavailable, only the first beat, nothing marked discovered/tested/approved", () => {
    const g = projectOnCallToGraph(null, null);
    expect(g.mode).toBe("unavailable");
    expect(g.modeLabel).toBe("UNAVAILABLE");
    expect(g.beats.filter((b) => b.unlocked).map((b) => b.id)).toEqual(["bootstrap"]);
    for (const n of g.nodes) expect(at(g, n.id, "refuse")?.state).toBe("unavailable");
    expect(g.lastUpdated).toBeNull();
  });

  test("a payload with every field null does not crash and claims nothing", () => {
    const empty = { schema: "skillforge.oncall_run/1", mode: "RECORDED_SIMULATION", generated_at: null, host: null, model: null, incident: null, synthesis: null, verification: null, approval: null, reuse: null, refusal: null, telemetry: null, audit: null } as OnCallRun;
    const g = projectOnCallToGraph(empty, "file");
    expect(g.beats.filter((b) => b.unlocked).map((b) => b.id)).toEqual(["bootstrap"]);
    expect(g.edges.every((e) => e.modelCalls === null && e.latencyMs === null)).toBe(true);
    expect(g.nodes.find((n) => n.id === "service")).toBeUndefined();
  });
});

test.describe("dedupe and untrusted text", () => {
  test("replayed duplicate evidence and audit events do not duplicate nodes or evidence", () => {
    const run = recorded();
    const base = projectOnCallToGraph(run, "file");
    run.incident!.evidence = [...run.incident!.evidence!, ...run.incident!.evidence!];
    run.audit = [...run.audit!, ...run.audit!];
    const g = projectOnCallToGraph(run, "file");
    expect(g.nodes.map((n) => n.id)).toEqual(base.nodes.map((n) => n.id));
    expect(g.edges.map((e) => e.id)).toEqual(base.edges.map((e) => e.id));
    expect(Object.keys(g.evidence).sort()).toEqual(Object.keys(base.evidence).sort());
  });

  test("strings are capped and control characters stripped (rendered as text, never markup)", () => {
    const run = recorded();
    run.incident!.evidence![0].excerpt = `<img src=x onerror=alert(1)>${"A".repeat(5000)}\u0007\u001b[31m`;
    run.incident!.title = "<script>boom()</script>".repeat(40);
    const g = projectOnCallToGraph(run, "file");
    for (const e of Object.values(g.evidence)) expect(e.description.length, e.id).toBeLessThanOrEqual(600);
    for (const n of g.nodes) { expect(n.summary.length, n.id).toBeLessThanOrEqual(700); expect(n.summary).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/); }
    expect(clean("a\u0000b\u007fc")).toBe("a b c");
    expect(clean(null)).toBe("Not measured");
    expect(clean("x".repeat(500), 50).length).toBe(50);
  });

  test("no local absolute paths or secrets in any projected text", () => {
    const g = projectOnCallToGraph(recorded(), "file");
    const text = JSON.stringify(g);
    expect(text).not.toMatch(/[A-Za-z]:\\\\Users|\/home\/|\/Users\/|bearer |api[_-]?key|password/i);
  });
});

test.describe("illustration is separate", () => {
  test("illustration graph shares no node with the recorded graph except the two anchors, and nothing is connected", () => {
    const ill = illustrationGraph(), rec = projectOnCallToGraph(recorded(), "file");
    expect(ill.mode).toBe("illustration");
    expect(ill.modeLabel).toBe("ILLUSTRATION");
    const anchors = new Set(["ember", "plinth"]);
    for (const n of ill.nodes) if (!anchors.has(n.id)) { expect(rec.nodes.some((x) => x.id === n.id)).toBe(false); expect(at(ill, n.id, "bootstrap")?.state).toBe("unavailable"); expect(n.provenance.kind).toBe("illustration"); }
    expect(ill.beats.filter((b) => b.unlocked).length).toBe(1);
  });
});

test.describe("the module has no write path", () => {
  test("source contains no network call, no mutation verb, no operator endpoint", () => {
    const dir = new URL("../src/moonshot/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => /\.(ts|tsx)$/.test(x))) {
      const src = readFileSync(new URL(f, dir), "utf-8");
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
      expect(src, f).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
      expect(src, f).not.toMatch(/["'`]\/ui\//);
    }
  });
});

test.describe("page-level trust", () => {
  test("only same-origin GET requests; no operator API request in a hosted-preview build; no write request ever", async ({ page }) => {
    const reqs: { method: string; url: string }[] = [];
    page.on("request", (r) => { if (!/^(data|blob):/.test(r.url())) reqs.push({ method: r.method(), url: r.url() }); });
    await page.goto("/#/world/moonshot");
    await expect(page.getByTestId("ms-chip")).toHaveText("RECORDED SIMULATION");
    const preview = await page.locator(".site-strip").isVisible();
    await page.getByRole("button", { name: "Skip intro" }).click();
    for (const b of BEATS) await page.locator(`.ms-beat[data-beat="${b}"]`).click();
    await page.locator('.ms-list summary').click();
    await page.locator('.ms-list [data-list="edge:gateway-recovery"]').click();
    await page.waitForTimeout(300);
    expect(reqs.filter((r) => r.method !== "GET")).toEqual([]);
    expect(reqs.every((r) => new URL(r.url).origin === new URL(page.url()).origin)).toBe(true);
    if (preview) expect(reqs.filter((r) => new URL(r.url).pathname.split("/").includes("ui")), "hosted preview must never call /ui/*").toEqual([]);
    else for (const r of reqs.filter((x) => new URL(x.url).pathname.split("/").includes("ui"))) expect(r.url).toMatch(/\/ui\/demo\/oncall$/);
  });

  test("artifact unreachable: UNAVAILABLE, nothing shown as discovered or approved", async ({ page }) => {
    await page.route("**/oncall-run.recorded.json", (r) => r.abort());
    await page.goto("/#/world/moonshot");
    await expect(page.getByTestId("ms-chip")).toHaveText("UNAVAILABLE", { timeout: 15_000 });
    await expect(page.getByTestId("ms-banner")).toContainText("Nothing is shown as discovered, tested or approved");
    await expect(page.locator('.ms-svg .ms-node[data-id="skill"]')).toHaveCount(0);
    await expect(page.locator('.ms-beat[aria-disabled="true"]')).toHaveCount(6);
    await expect(page.getByTestId("ms-updated")).toContainText("Not measured");
  });

  test("a pending approval in the artifact disables reuse and refusal in the UI", async ({ page }) => {
    await page.route("**/oncall-run.recorded.json", async (route) => {
      const run = recorded(); run.approval = { ...run.approval!, state: "pending", by: null, at: null, kind: null };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(run) });
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/world/moonshot");
    await expect(page.locator('.ms-beat[data-beat="reuse"]')).toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    await expect(page.locator('.ms-beat[data-beat="refuse"]')).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('.ms-beat[aria-current=step]')).toContainText("Await approval");
    await expect(page.getByTestId("ms-stopped")).toBeVisible();
    await expect(page.locator('.ms-svg .ms-node[data-id="gate"]')).toHaveAttribute("data-state", "awaiting_approval");
    await page.locator('.ms-beat[data-beat="reuse"]').click({ force: true });
    await expect(page.locator('.ms-beat[aria-current=step]')).toContainText("Await approval");
    await expect(page.getByRole("button", { name: /Continue replay|Next/ })).toBeDisabled();
  });
});
