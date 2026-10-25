# SkillForge — Moonshot UI: Ember's Living System
**UI/UX implementation handoff for Claude**  
**Date:** 2026-10-25  
**Repo:** `<REPO_URL>`  
**Target file:** `moonshot_ui.md` (repo root)  
**Intent:** cinematic, interactive, evidence-grounded prototype; build incrementally on the existing UI.  
**Priority:** a genuinely useful operator interface, not a pre-rendered marketing animation.

> **North star:** A workspace wakes up. Ember, the familiar little SkillForge mascot, appears at its center. From Bootstrap roots, a living map of real systems and workflows grows outward. Ember explores *authorized, read-only* context, surfaces potential optimizations, tests candidate skills through the established verification pipeline, and presents side-by-side "before versus proposed" connections for human review. Only genuinely approved/verified capabilities become solid branches.

## 0. One-minute brief — READ FIRST

Make a **Living System** canvas, with **Ember visually and emotionally at the center**. The canvas combines:
- **Bootstrap roots** — known workspace / environment / permissions / data sources.
- **Ember at the heart** — the existing blue pixel-flame character, responding to *real* system states and events, not merely running a canned happy animation.
- **Branches / nodes** — workspaces, repositories (only if truly discovered), services, records, tools, skills, verifiers, and workflows.
- **Edges / paths** — observed relationships versus proposed optimizations, plus evidence, safety state, and required human decisions.
- **Human decision inspector** — hover briefly to understand a connection; click to compare **Current → Proposed**, inspect diff, tests, evidence, risk, and exact next human action.
- **Visible learning** — a new verified skill is added to the map; recurrence follows a short deterministic path with zero model calls *when supported by a real run*; an incompatible lookalike is refused.

**The cinematic animation is the explanation of the product.** Not decoration. Every meaningful pulse, branch growth, color change, verification mark, and displayed metric must correspond to an auditable event or be visibly marked "Illustration"/"Recorded".

The tree is **a visual metaphor, not the data model**. The underlying topology must be a graph: systems may have many-to-many dependencies, branches may connect sideways, loops may exist, and an "optimization" may be a proposed alternative path between existing nodes. Do not distort the actual dependencies simply to achieve a literal botanical tree.

**Tagline direction:** "Agents respond. SkillForge remembers." Alternative hero: "Watch your operations learn." Do not let slogan override evidence.

## 1. Repo-grounded starting state (checked 2026-10-25)

Read these before coding, especially if commits have moved:
- `README.md`, `docs/CLAIMS.md`, `docs/BENCHMARKS.md`, `docs/LIMITATIONS.md`, `docs/SECURITY.md` — current truth / limitations.
- `ui/src/world/Mascot.tsx`, `ui/src/world/sprites.ts` — **reuse Ember**, the original animated 28×24 blue pixel sprite; available states: `idle`, `investigating`, `building`, `verifying`, `verified`, `waiting`, `error`. Preserve its recognizability, palette, crisp edges and state meanings. Add aura/particles around the sprite, not by repainting it.
- `ui/src/world/Bootstrap.tsx`, `ui/src/world/bootstrap-data.ts` — existing SVG/Motion bootstrap cinematic. The latter explicitly contains **illustrative** data, not real connectors.
- `ui/src/world/World.tsx`, `ui/src/world/Scene.tsx`, `ui/src/world/events.ts` — Daylight 2.5D world, state mapping, replay and source tags. Keep functional.
- `ui/src/story/GuidedDemo.tsx`, `ui/src/data/oncall.ts` — six-scene OnCall flow, provenance logic.
- `ui/src/data/live.ts`, `ui/src/data/useLive.ts` — read-only operator API, authenticated polling, event merging, stale/reconnect handling.
- `experiments/router/bootstrap.py`, `experiments/bootstrap_lite/lite.py`, `ui/BOOTSTRAP_LITE.md` — real read-only Bootstrap Lite for an allowlisted **ops dataset**, not general filesystem/Git discovery.
- `docs/PRODUCT_CONTRACTS.md` — proposed workflows, compatible skills, verifier coverage, dependencies, missing permissions; these are **contracts**, not an authorization to execute.
- `experiments/oncall_infer/`, `ui/public/demo/oncall-run.recorded.json`, `docs/DEMO_GUIDE.md` — existing demo artifacts and recorded flow.

**Truth as of this handoff:** The 2026-10-25 GB10 operator reported a real local Qwen skill-generation attempt that passed 9/9 hidden cases, followed by a person approving the skill at the host CLI, INC-2 deterministic reuse with 0 model calls (six trials, p50 28.2 ms), and INC-3 fingerprint refusal. See `docs/BENCHMARKS.md` for provenance and caveats. **This does not turn the committed `oncall-run.recorded.json` into a live recording.** The committed recording uses hand-written reference code and a simulated approval. GB10 execution used the subprocess runner; NemoClaw/OpenShell was not installed/verified on the GB10 at the time documented. A separate identical model run scored 8/9 and was rejected. No validated cost/energy savings or general-purpose codebase exploration.

Do not regress or misstate this. Recheck the repo and actual run source before making any "LIVE", human-approved, hardware, speedup, security isolation, or connector claim.

## 2. Creative direction

### Core composition

Imagine an organism made of **elegant fiber-optic circuitry**, with a clear software topology:
- A visually grounded **Bootstrap root system** grows from a small **local GB10/workspace plinth** at the lower center, connecting discovered inputs. Distinguish "found" from "connected"; unverified connections remain faint and dashed.
- **Ember occupies the central hub**, above the root intersection, cradled in a halo / glass orb / softly breathing energy field. Ember is **not a generic glowing sphere** and must be legible as the existing pixel mascot, even when zoomed out. This is the emotional focal point.
- Main **branches** radiate left, right, and upward, producing meaningful clusters: Sources / Services / Workflows / Skills / Verification / Human Review. Avoid hardcoding these as fictional department integrations.
- Nodes resemble illuminated glass/metal terminals with small icons, names, source/status markers. Thin curved paths link them. A proposed relation appears as a **translucent ghost branch** growing toward another node; established relationships use solid lines only when actually supported.
- When a skill is verified, light travels along the verification path; when host-approved, a new skill node locks into the graph; when reused, the already-approved path lights up without the inference branch.
- When refused, show a restrained **amber/coral stopping point**, the reason, and *no* successful growth. Failure should look competent and trustworthy.

**Aesthetic:** high-end cinematic systems map: deep navy / charcoal environment; layered depth, subtle volumetric glow, electric azure/cyan (Ember and active investigation), muted gold (proposed opportunity), mint (independently verified), warm amber (human required), coral (refused/failed). Keep readable high-contrast typography and existing state semantics. The current Daylight warm pixel identity can inform tactile details; offer a darker "Moonshot" treatment rather than globally replacing the design system.

**Camera choreography:** start intimately on Ember/root, ease out to reveal the network; ease toward one newly forming edge on click. Movement should convey causality and focus—not arbitrary spinning, uncontrolled bloom, hyperspeed starfields, or an undifferentiated hairball. Keep controls functional while motion plays.

### Mental model / spatial hierarchy

```text
             VERIFIED SKILLS        PROPOSED WORKFLOWS
                 ●───●                ◌ - - ◌
                /     \              /
  DATA / REPOS ●       ●───● INCIDENT / OPERATIONS
               \       /      \
                \   [ EMBER ]--◌  (ghost opportunity)
                 \  /  |   \
               [ BOOTSTRAP ROOTS ]
                known workspace
                sources, policies
                local GB10/runtime

              [human review / evidence inspector]
```

The graph should be true even if rendered as a stylized tree. **Ember is central, but Ember is not an authority node:** human permissions and independent verifiers remain distinct and cannot be bypassed by clicking the mascot.

## 3. User journeys and interaction specification

### A. Enter / Bootstrap
1. User enters "Living System" (recommended new route `#/world/moonshot` or another route consistent with the existing router, without breaking `#/world`, `#/world/onboard`, `#/demo`, or console).
2. The root wakes up; label the workspace and actual data source. Ember animates `idle → investigating` when genuine read-only discovery begins.
3. Roots grow **only as authorized data returns**. Unsupported Git, Slack, ERP, and arbitrary-codebase integrations are *not displayed as working*. They may appear in a separately identified "Example connections" or "Future integrations" mode, never alongside live nodes with ambiguous badges.
4. Show small provenance chip at all times: `LIVE LOCAL` / `RECORDED SIMULATION` / `ILLUSTRATION` / `UNAVAILABLE`. Show last successful update and stale/offline state. If data is missing, the corresponding branch remains unknown, not verified.

### B. Explore the topology
- Pan, zoom, reset view, fit to graph; optionally filter by "Services / Workflows / Skills / Needs review". Keep "Focus Ember" as a real camera action.
- Ember follows an **event-driven** focus state: looks toward the relevant branch, shows magnifier when investigating, hammer/build state during skill drafting, verifying animation during tests, waiting pose when a human action is needed. Mascot stays in the central anchor during normal exploration; don't make it literally walk over the UI and obstruct content.
- **Hover/focus on node**: small popover, name, type, effective source/provenance, status, succinct summary. No "healthy", "automated", or "connected" unless the backend establishes it.
- **Click node**: accessible side inspector: what it is, actual capability, inputs/outputs, permissions, dependencies, recent trusted evidence, last verified state, links to the existing console when available.
- **Hover/focus on edge**: two systems, relationship type, state ("Observed", "Suggested only", "Tests passed", "Awaiting host approval", "Active approved skill", "Stale", "Refused"), and provenance.
- **Click edge**: persistent "Connection Inspector" with BEFORE / PROPOSED tabs or a split comparison, tests, criteria, missing evidence, why-now, trust boundaries, links to logs/skills, and human next step. Keyboard selection must work identically to pointer.

### C. Inspect a proposed optimization — primary wow interaction

Suggested demo relationship: **Inference Gateway → Incident Recovery**. This example maps to the OnCall scenario; do not invent an actual gateway connector that is not configured.

**Current / baseline panel**
- Path: incident detected → unfamiliar incident → model investigation → diagnosis/action proposal → human approves → execute once → independently verify.
- Clearly identify whether this is a **conceptual baseline** (not measured) or an **observed recorded trace** (actual run). Display the individual source(s) and timestamps when available.
- Don't claim a fixed number of steps, latency, cost, savings or manual time without evidence.

**Proposed panel**
- Path: exact fingerprint match → approved versioned skill proposes bounded action **without model calls** → action approval/policy → execute once → independent verification. Note: approving the *skill* does **not** eliminate required per-action human approvals.
- Overlay gold dashed edge for the proposal; only after the relevant actual approval/verification evidence does its appearance advance to a validated/approved state. The skill can be "tested" before approval, which is not "active".
- Detail fields: specific discovered problem, evidence refs, proposed change, impacted nodes, proposed steps, validation coverage, hidden suite result, estimated benefit (only if marked estimate), measured benefit (only if present), potential failure modes, rollback or disable controls that are described **but not exposed as executable UI actions**.
- Under "Compare paths", show the old and new paths visually side by side, and highlight exactly which inference/steps are removed or retained. Avoid animation that implies skipping policy, host review or verification.
- "Why this is safe": exact-match + trusted fingerprint + independent tests + host approval + re-read verifier + fail-closed behavior. Never label tested code "guaranteed safe."
- "View evidence": links into `#/demo` and appropriate existing console routes, with source type. "Copy host command" only if a validated allowlisted command is actually provided by the trusted backend; no fabricated runnable commands.

### D. Human review
The graph is a **read-only cockpit**, not a new security boundary. Show proposed workflow versus active one, impact, test coverage, permission requirements, and pending human approvals. Today human approval/promotion occurs at the **host CLI** and the UI must never approve or auto-activate, even through a misleading decorative button.

Suggested labels: "Needs your review", "Copy host-side instructions" (only when real), "Open evidence", "Inspect existing skill". Do NOT add an "Approve & deploy" UI control backed by fake state or by a new write API.

### E. Reuse and refusal — actual intellectual payoff
- On INC-1, Ember investigates/builds/tests, then waits for host promotion.
- On compatible INC-2, a new short path glows from exact-match router through approved skill and approval/verification; animate a small "0 model calls" counter **only if the replay payload genuinely asserts 0**.
- On lookalike INC-3, the edge terminates at a refusal node. Inspector says why: disk-full `OSError` differs from GPU OOM; fingerprint mismatch. Never show a completed-success badge.
- Use current run artifacts, not an invented model-created skill or timing. When a run is merely scripted, state so.

## 4. Visual states are product states, not just colors

| Graph concept | Visual | Truth criterion |
| --- | --- | --- |
| Discovered | faint node/line, open circle | read-only inventory/manifest, no health or grants implied |
| Configured / unknown health | partly filled glyph + label | configured, not necessarily reachable |
| Connected / active | solid node and anchored line | real permitted reachable integration or verified exact-match skill; specify which |
| Opportunity | gold ghost branch, dashed outline | hypothesis/proposed_workflows only; cannot mutate state |
| Testing | moving light within bounded edge | test actually running; otherwise "illustrative playback" |
| Passed verification | mint ring/check next to candidate | independent verification passes; may still be unapproved |
| Awaiting human | amber pause at gated connection | backend pending approval |
| Approved / executable in scope | solid branch with version/hash inspector | exact-match skill approved for this context; individual actions still gated |
| Applied but unverified | neutral "Applied; checking" | action executed but verifier not yet passed |
| Refused / stale / blocked | interrupted dotted edge, reason | real mismatch, changed contract, denied scope or failure |
| Connection lost | freeze graph with "last updated" overlay | transport lost: NEVER pretend cached state is now-live |

**Status labels remain visible in text and shape**, not color alone. All fields with unknown metrics are `null` / "Not measured", never zero.

## 5. Layout and responsive interaction

**Desktop**
- Top-left: "SkillForge / Living System", workspace selector if real, source mode chip and updated-at.
- Center ~65–75%: cinematic graph canvas, Ember pinned to its meaningful central hub. Zoom/pan, search/filter, legend, camera reset.
- Right ~25–35%: contextual inspector; collapsed until selected. Tabs: "Overview", "Before / Proposed", "Evidence", "Permissions". On large monitors inspector overlays outside the useful graph region; graph recenters selection.
- Bottom thin timeline/replay: Bootstrap → Explore → Propose → Test → Await approval → Reuse / Refuse. Timeline stepping is accessible and source-labeled.
- Ambient background frames the map; no floating marketing KPI counters unsupported by the backend.

**Tablet / phone**
- Graph has one focal cluster at a time, fewer labels, zoom-to-node and accessible node list. Inspector becomes a bottom sheet with real readable text. No tiny 3D labels. Prefer a "story card" fallback for narrow screens and reduced motion.

**Interactions**
- Click/tap Ember → small "What I'm doing" panel with *actual* current state or "No active task"; links to live task/replay, **not a talking-avatar chatbot**.
- Click empty space / Escape → close inspector. Back restores prior selection where appropriate.
- Keyboard: Tab through actual controls/nodes/edges, Enter/Space select, Escape dismiss, directional graph navigation or an equivalent accessible node/edge list.
- No modal surprise, scroll lock, or hijacked mouse wheel that makes inspector unusable.

## 6. Demo storyboard — ~90 seconds, skippable and replayable

Build a controlled **Demo tour** mode and a separate **Explore freely** mode. Demo tour may animate curated existing data but must carry an honest persistent source banner. Never silently mix recorded/synthetic with live.

1. **The spark (0–10s).** Dark frame. GB10 plinth powers on. Thin Bootstrap roots appear. Ember materializes in center, blinks, and looks around. On-screen: "Your workspace, mapped locally." Real context source/fixture label.
2. **Discover (10–25s).** Nodes resolve around Ember one at a time based on an allowlisted manifest/event trace; lines trace the discovered relationships. Any unsupported codebase / Git / Slack are clearly examples, not live integrations.
3. **Spot an opportunity (25–38s).** A ghost-gold branch spans "Inference Gateway → Recovery workflow". Existing winding path remains drawn. Camera eases toward the connection. Prompt: "Ember proposes a repeatable shortcut."
4. **Inspect / prove (38–58s).** Inspector opens as the graph bifurcates into Current versus Proposed; candidate goes through lint/tests/replay/hidden suite. If playing the committed recording, label "reference skill; recorded simulation"; never claim the local model just wrote it.
5. **Human gate (58–68s).** Branch pauses at an amber review checkpoint; Ember visibly waits. If approved evidence exists, show source of host approval (and note `--by` is not identity-verified). Otherwise stay pending and do not fabricate approval.
6. **Learn and reuse (68–82s).** Reuse INC-2 on the verified short path; display `model_calls: 0` only with event evidence. Edge becomes part of the graph because the approved skill is now in the registry.
7. **Trust over theatre (82–90s).** Send INC-3 lookalike toward same route; it stops and reveals "Refused: fingerprint mismatch." Hero settles on Ember in the center surrounded by an honest living system.

Autoplay must stop at an actual pending approval (as the existing guided demo does). A judge can click the edge to inspect its evidence, and replay/skip any beat. Prefer a brief, repeatable technical proof over a longer unskippable animation.

## 7. Data architecture for UI Claude

**Do not invent a new graph write backend.** Build a pure, typed, read-only projection of existing manifest, event, skill, and OnCall data. Use existing authenticated `GET` adapters and source tags. If one additional read-only projection endpoint is truly necessary, propose its exact schema in a separate design note and keep UI implementation working with available data; do not silently alter core authorization/policy code.

Suggested frontend types (adjust to real fields after reading code; illustrative interface, not a claim that API exists):

```ts
type Provenance =
  | { kind: "live"; source: string; observedAt: string }
  | { kind: "recorded"; artifact: string; capturedAt: string | null }
  | { kind: "illustration"; label: string };
type NodeKind =
  | "ember" | "bootstrap" | "workspace" | "source" | "service"
  | "workflow" | "skill" | "verifier" | "human_gate";
type NodeState =
  | "discovered" | "configured" | "active" | "unknown"
  | "testing" | "tested" | "awaiting_approval" | "approved"
  | "applied_unverified" | "verified" | "refused" | "stale" | "unavailable";
type EdgeKind = "observed" | "proposed" | "skill_reuse" | "blocked";
interface MoonshotNode {
  id: string;
  kind: NodeKind;
  label: string;
  state: NodeState;
  provenance: Provenance;
  evidenceIds: string[];
  parentCluster?: string;
  detailRef?: { kind: "task" | "skill" | "incident"; id: string };
}
interface MoonshotEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  state: NodeState;
  provenance: Provenance;
  evidenceIds: string[];
  existingPathNodeIds?: string[]; // don't invent when unknown
  proposedPathNodeIds?: string[];
  humanApprovalRequired: boolean | null;
  independentlyVerified: boolean | null;
  modelCalls: number | null;
  latencyMs: number | null;
  improvementPct: number | null; // only if proper comparable runs exist
  reason?: string;
}
interface MoonshotGraph {
  mode: "live" | "recorded" | "illustration" | "unavailable";
  workspaceId: string | null;
  lastUpdated: string | null;
  nodes: MoonshotNode[];
  edges: MoonshotEdge[];
  evidence: Record<string, { type: string; source: string; description: string; at?: string }>;
}
```

Implementation principles:
- `projectManifestToGraph()`, `projectOnCallToGraph()`, `projectAuditToGraph()` should be pure deterministic functions with tests; no model inference in the UI and no guessed edge inference presented as fact.
- Stable IDs from authoritative workspace/run/skill identifiers. Deduplicate replayed events; out-of-order events must not prematurely turn an edge green. Unknown, stale, disconnected and refused states must fail closed.
- Persist *only ephemeral viewport / selected edge state in React*, not approvals or system truth. Reconnect must rehydrate from server.
- Use the existing `LiveEvent`, `LiveSkill`, `LiveAction` and `OnCallRun` types / adapters where possible, respecting the current provenance logic in `ui/src/data/oncall.ts`.
- Sanitized trusted projection only. Never print secrets, bearer tokens, raw private code, confidential logs, environment variables, local absolute paths, or an unredacted diff from untrusted inputs in the graph.
- Treat string fields from manifests, repos and log excerpts as **untrusted plain text**: render without interpreting markup or instructions; cap length and use accessible truncation.
- First-party graph changes must never grant permissions. Provenance and permissions are independent, explicit fields.
- No model calls inside camera state or animation. Heavy transformations run on data change, not on every frame.

## 8. Engineering approach and animation budget

Existing stack: **React 19 + TypeScript + Vite + Motion + Lucide**. Prefer custom **SVG/React graph and Motion** for the initial small curated topology, reusing `Mascot` / `MascotSprite` and existing theme tokens. It is enough for curved interactive links, halos, edge hover/select, beam travel, camera pan/zoom, and responsive storytelling.

For larger future topologies, evaluate `@xyflow/react` or a deterministic graph layout engine, but don't bring large dependencies into the hackathon branch without proving necessity. Three.js/WebGL is optional **background atmospheric rendering only**; all important state, edges, controls, labels and hit targets remain semantic HTML/SVG. Blender is for optional pre-rendered ambient assets, not the sole source of truth or interactivity.

Performance budget as **targets to measure**, not claims:
- keep initial scene bounded (roughly 10–25 purposeful nodes and 10–40 edges); lazy-reveal clusters, not hundreds of DOM nodes;
- animate transforms/opacity/path length, minimize per-frame React renders, use transforms for camera motion;
- target smooth interaction (~60 fps on a judge laptop; verify by measurement), minimal idle CPU/GPU so the GB10 local model retains resources;
- account for browser background tabs; pause particle RAF/timers when hidden/offscreen;
- cap glow/bloom layers and particle counts; graceful SVG fallback if WebGL is absent;
- honor `prefers-reduced-motion`: instant settled graph, zero flashing/pulsing, identical functional inspections and source labels;
- offer high contrast, generous edge/node click targets, SVG title/ARIA, focus indicators, and no color-only status.

Design language: make **Ember** expressive but small and charming; don't replace it with a photorealistic face, a huge generic AI orb, or a distracting full-screen animation. Preserve the "Forge" metaphor: roots discover, Ember investigates, verification tempers, approved skills become enduring branches.

## 9. Concrete repo-level implementation plan

**P0 — Build the demonstrable, truthful vertical slice (highest priority).**
1. Create a new isolated UI module (suggest `ui/src/moonshot/`) containing graph types, projections, fixture adapter, layout geometry, visual canvas, Ember hub, inspectors, replay controller, styles, tests. Add the route `#/world/moonshot` through the existing router without breaking current routes.
2. Reuse `Mascot` and its state machine. Set it centrally; animate subtle eye/halo/particle attention tied to the current beat/state.
3. Build a curated graph over the **actual OnCall recording** and available SkillForge backend data. Explicitly tag recorded source, hand-written reference skill and simulated approval. Include INC-2 deterministic path and INC-3 refusal.
4. Implement click/hover/focus on a real edge and a **Before / Proposed** inspector. At least one path comparison, one test/evidence breakdown, one refusal reason.
5. Add a skippable cinematic intro and event-driven branch growth. Timeline allows manually stepping and replaying every beat.
6. Add honest empty/disconnected/pending/failed states and mobile/reduced-motion fallbacks.

**P1 — Attach read-only Bootstrap Lite discovery.**
7. Project known allowlisted workspace manifest into source/workflow nodes; use `experiments/bootstrap_lite/lite.py` and existing read-only APIs; status labels mirror `ui/BOOTSTRAP_LITE.md`. Display no false Git/codebase/Slack integration. Draw sample integrations only in a visibly separate illustration mode.
8. Project skill/audit changes from `useLive`, including staged/tested/approved/refused/stale states. Cross-links open existing console evidence views.
9. Show "This connection is suggested because…" from real `proposed_workflows` and actual evidence. A suggested relation is *never* displayed as active merely because a model said it.

**P2 — Future capability, not today's claim.**
10. A read-only, owner-approved repo adapter (paths/tree, workflows and automation discovery) with allowlisting, secrets redaction, scope-aware IDs and a secure trusted host boundary.
11. An opportunity planner that compares validated existing workflow traces with proposed plans and runs proper independent tests. Only then consider automatic *suggestion* generation or multi-hop skill composition; never automatic authorization.
12. Large graph layout, clusters, historical evolution, and actual measured A/B optimization reports.

If time is constrained, deliver **P0 first**. One interactive, impeccable edge inspector with one real recorded source is more persuasive than an elaborate graph of invented integrations.

## 10. Must-pass acceptance criteria

**Functional**
- Ember remains visibly central in desktop layout and is recognizable as the existing mascot.
- A root-to-branches Bootstrap animation finishes in an interactive graph, not a video.
- Clicking a node opens real details; clicking a connection opens Before / Proposed / Evidence / Permissions with stable selection.
- At least one proposal clearly contrasts existing and proposed paths; unknown baseline is labeled conceptual, not measured.
- INC-2 visual reuse shows exactly `model_calls: 0` only when the source proves it; INC-3 visually **refuses** and clearly explains why.
- A pending host approval visibly stops progress, doesn't masquerade as a completed promotion, and cannot be bypassed by autoplay.
- The graph never calls any approval, execution, mutation, or network-exfiltration endpoint.

**Evidence and safety**
- Persistent accurate LIVE / RECORDED / ILLUSTRATION / STALE badges; a simulated approval cannot be shown as a person's.
- Code-generated status versus hand-written reference status not conflated; demo mode does not misrepresent GB10 evidence.
- Verification passed ≠ host-approved ≠ action executed ≠ independently verified. Distinct visual states and tests.
- Wrong fingerprints, stale contracts, unauthorized skills and missing/verifier-unavailable states stay blocked.
- No fabricated latency/cost/speedup data; unknown values are shown as "Not measured"; claims link to evidence.
- New code does not touch `app/tools.py`, `app/skillforge.py`, approval gates, policy checks, secret handling, or runner configuration.

**Quality**
- `npm --prefix ui run typecheck`, `npm --prefix ui run lint`, `npm --prefix ui run build` pass.
- Add Playwright tests for hover/focus/click, keyboard, viewport 1440 and 390, reduced motion, provenance, refusal, and pending approval. Existing `ui/e2e` / `ui/e2e-live` suites remain green.
- Screenshot checks at intro, full map, selected edge inspector, refused branch and 390px. No unreadable labels or inspector overlap.
- Prove visible truthful behavior when API is unreachable, cookie unauthorized, events duplicated/reordered, and system reconnects.
- Measure animation performance with local tooling; document results and known limitations, not assumed performance.

## 11. Proposed component breakdown

```text
ui/src/moonshot/
  types.ts                  authoritative projection types and status map
  projection.ts             manifest + OnCall + audit -> graph (pure)
  fixtures.ts               explicitly labelled recorded/illustration adapters
  layout.ts                 deterministic root/Ember/cluster positions
  LivingSystem.tsx          route-level controller / provenance
  LivingCanvas.tsx          SVG graph scene, camera, branch animation
  EmberCore.tsx             existing Mascot + hub visuals / focus states
  GraphNode.tsx             node visual + accessible hit area
  GraphEdge.tsx             existing/proposed/refused visual + selection
  ConnectionInspector.tsx  before/proposed/evidence/permissions comparison
  ReplayTimeline.tsx       beat selection, pause/step/replay
  moonshot.css             visual skin, containment, reduced motion

ui/e2e/moonshot.spec.ts
ui/e2e/moonshot-truth.spec.ts
```

These are suggested names, not a demand to refactor current working routes. Prefer small, well-tested, removable additions over re-platforming the app. The handoff is **not** permission to implement arbitrary repo scanning, a new agent, or host write APIs.

## 12. Final instruction to UI Claude

You are the **UI implementation owner** for SkillForge's "Ember's Living System" moonshot.

1. Read this file, the repo truth/evidence files, and the listed existing UI modules first. Check current `main` before changes.
2. Build a **new isolated UI experience** in a feature branch; don't overwrite the Daylight World or existing six-scene demo. Reuse Ember, Bootstrap presentation idioms, existing type definitions and GET-only APIs.
3. Deliver the **P0 vertical slice** before expanding scope: Ember at the center of a visually gorgeous organic graph, Bootstrap roots, discovered/proposed edges, clickable **Before vs Proposed** inspector, tests, human gate, skill reuse and refusal.
4. Every visual success state must map to real evidence; keep mock/recorded/illustrative/life-of-run boundaries unmistakable. Use no deceptive "LIVE" connectors, fake approval buttons or invented performance wins.
5. If actual codebase discovery / autonomous opportunity planning is absent, do **not** quietly fake it as active. Show it as a differentiated future capability or prototype with a source banner.
6. Run build/lint/typecheck and relevant existing/new browser tests; capture desktop/mobile screenshots. Include a short list of changed files, verified tests, screenshots, and remaining honest limitations in your PR.
7. **Do not get stuck iterating indefinitely on tiny polish.** Ship a coherent, impressive, interactable first complete journey, then tune motion, lighting and performance once behavior/provenance pass.

**Definition of done:** In under 90 seconds, a judge can understand Ember as SkillForge's heart, watch an actual provenance-labeled workspace graph grow from Bootstrap, click one proposed workflow, compare current vs proposed paths, inspect what testing and permission really mean, see a proven deterministic reuse path, and see a lookalike incident correctly refused.

**One-line creative imperative:** Make the intelligence of the system *visible*, without ever animating a claim that the evidence does not support.
