# SkillForge UI: design brief (SIGNAL / NOIR, refined)

**Subject:** a local agent that turns one verified investigation into a reusable, verified skill.

**Audience:** hackathon judges first, operators second.

**Primary job:** in 10 seconds, show that *work done once becomes a capability*, and show which parts are still waiting for a human.

## 1. Visual direction (moodboard in words)

The look is a dark instrument panel at night: the light comes *from the work itself*, not from decoration.

| reference | technique we adapt | what we do *not* copy |
|---|---|---|
| Linear (app) | quiet hierarchy: one weight of hairline, content-first density, a keyboard-first list/detail split | their purple palette, logo marks, layouts |
| Vercel Geist | a strict token scale (gray steps, 4 px spacing grid), mono only for real machine output, generous negative space | the Geist typeface, the triangle mark, page structure |
| Apple product pages | one idea per viewport, pinned stages where the *scroll* drives the reveal, headline-first pacing | product imagery, copy, exact layouts |
| Motion / GSAP examples | `useScroll` + `useTransform` for scrubbed stages; sticky containers instead of scroll hijacking | — |

**Refinements to the proposed SIGNAL / NOIR:**
- **Colour has meaning, never decoration.**
  - cyan = the agent is acting
  - green = an independent verifier passed
  - amber = a human is needed, or something is degraded
  - rose = failure
  - A screen with nothing happening is grey.
- **No glass blur on large animated surfaces.** Panels use a 1 px hairline and a 2 % lighter fill; blur is reserved for the small sticky status bar, and only when it's static.
- **Rejected defaults:** ALL-CAPS eyebrows, `A · B · C` meta strings, `→` on buttons, mono for small labels, one radius everywhere, fade-up on every section.

**The one bold element:** *the trace*. A single hairline follows the agent's tool calls. In Act 3 it collapses into a compiled skill artifact that carries its sha256. Everything else stays quiet.

## 2. Tokens (`src/styles/tokens.css`)

| token | value | use | contrast on canvas |
|---|---|---|---|
| `--canvas` | `#080C12` | page | — |
| `--surface` | `#121A24` | panels | — |
| `--surface-2` | `#18222E` | raised / selected | — |
| `--line` | `#223040` | hairlines | non-text |
| `--text` | `#F3F7FC` | primary text | 18.2 : 1 |
| `--text-2` | `#9CADBA` | secondary text | 8.5 : 1 |
| `--text-3` | `#8193A0` | tertiary/meta | 6.2 : 1 (5.1 on surface-2) |
| `--signal` | `#82D8FF` | agent activity, focus ring | 12.3 : 1 |
| `--verified` | `#65E9B7` | verified outcomes only | 13.0 : 1 |
| `--warn` | `#F1AD64` | human needed / degraded | 10.2 : 1 |
| `--fail` | `#FF8A94` | failure | 8.7 : 1 |

The contrast ratios were computed with the WCAG formula (`scripts/contrast.mjs`); all text tokens are ≥ 4.5 : 1 on canvas, surface and surface-2. The first check failed `--text-3` at 4.1 : 1 on surface-2, so it was lightened from #71838F.

**Type:**
- **Schibsted Grotesk Variable** for display and UI. Display 72–112 px, −0.035 em, weight 600. UI 15 px, line-height 1.5.
- **JetBrains Mono Variable** only for tool calls, hashes and code (13 px).
- **Scale:** 13 / 15 / 18 / 24 / 36 / 56 / 88 (a modular ~1.5 progression, adjusted by eye).

**Space:** a 4 px base (4, 8, 12, 16, 24, 32, 48, 72, 120).

**Radius** follows hierarchy: 4 px chips, 10 px panels, 16 px stage frame.

## 3. Layout sketches

```
DESKTOP story (1440)                                     MOBILE story (390)
┌──────────────────────────────────────────────┐         ┌──────────────┐
│ SkillForge        Story  Console  [Open console]        │ SF  [Console]│
│                                               │        │              │
│  Work done once                    ┌────────┐ │        │ Work done    │
│  becomes a capability.             │ trace  │ │        │ once becomes │
│  (left aligned, 7/12 cols)         │ stage  │ │        │ a capability │
│  [Open live console] [Watch story] └────────┘ │        │ [Open console]│
├──────────────── act 1..5: sticky stage right, copy scrolls left ──────┤
```

```
DESKTOP console (1440)
┌ status bar: data source badge | model | sandbox | host service | DB ───────────┐
├ tasks (280) ──┬ run timeline (fluid) ───────────────────┬ inspector (380) ─────┤
│ ● Investigate │ 1 read_records        ✓ 42 ms           │ Approval needed      │
│   Reuse skill │ 2 investigate A-102   ✓                 │ A-102 total 18.00→   │
│   Lookalike   │ 3 propose_action      ✓                 │ 17.40  (reason)      │
│               │ 4 human approval      ◐ waiting         │ [Approve] [Reject]   │
│               │ 5 execute · 6 verify  ○                 │ evidence / skill tabs│
└───────────────┴─────────────────────────────────────────┴──────────────────────┘
MOBILE console: status bar collapses to one line; tasks become a select; the inspector stacks under the timeline.
```

## 4. Component and interaction inventory

| component | states |
|---|---|
| `SourceBadge` | live, recorded, synthetic, mock (always visible, never hidden) |
| `HealthPill` | ok, degraded, down, unknown |
| `TaskList` | items, empty, selected, keyboard-navigable |
| `StepRow` | queued, running, done, failed, waiting-human, skipped |
| `ApprovalPanel` | waiting, approving, approved, rejected, error. In live mode it shows the **host command** (no browser approval endpoint exists by design). |
| `SkillArtifact` | drafting, testing, hidden-validation, approved, refused |
| `MetricCompare` | measured, pending (null), synthetic-example |
| `Banner` | model offline, connection lost, reconnecting, escalated |

## 5. Five-act storyboard (scroll-scrubbed; sticky stage on the right, copy on the left)

| act | copy (left) | stage (right) | scroll-driven change |
|---|---|---|---|
| 1. Unfamiliar problem | "Five records. One is wrong. Nobody wrote a rule for this." | 5 record rows; one row's total is amber | the amber row lifts slightly as the act enters |
| 2. Investigation | "A local model reads the evidence and proposes a fix. A person approves it." | the trace draws through tool calls, step by step | `pathLength` 0 → 1 tied to scroll |
| 3. Compile | "The fix becomes a skill: code, tests, and a hash." | tool-call rows collapse into one artifact card with its sha256 and tests | rows translate and scale into the artifact; the card's border turns green when the hidden suite passes |
| 4. Reuse | "Next week, new data. The skill handles it without the model." | a comparison of model calls before and after; values are **labelled example** | bars fill; label: "Synthetic example. Measured numbers come from the GB10 run." |
| 5. Into the product | "This is the console your team uses." | the stage frame expands into a console preview | scale 0.92 → 1, then a CTA to the console |

A "Skip to console" link sits in the top bar at all times, and the hero has an "Open live console" button.

## 6. Motion specification (`src/lib/motion.ts`)

| token | ms | easing | used for |
|---|---|---|---|
| `micro` | 160 | `[0.2, 0, 0, 1]` | hover, press, focus, pill colour |
| `panel` | 300 | `[0.2, 0, 0, 1]` | inspector tabs, expand/collapse, list insert |
| `major` | 600 | `[0.16, 1, 0.3, 1]` | step completion, artifact compile, route change |
| scroll | — | linear (scrubbed) | acts 1–5 |

- **Triggers:** user actions and state changes only. There are **no infinite loops**, except a 1 Hz opacity pulse on the single "running" step, and that pulse is disabled under reduced motion.
- **Reduced motion:** every scrubbed transform becomes a static end state; durations go to 0; the trace is drawn fully.
- Only `transform` and `opacity` are animated. `pathLength` is the one SVG exception, a stroke-dashoffset on a short path.

## 7. Console state diagram (one task)

```
           ┌──────────── model offline ─────────────┐
           ▼                                        │
 idle → investigating → proposing → WAITING_APPROVAL → executing → verifying ─► completed
           │               │            │  reject              │           │
           │               │            └──► cancelled         │           └─► needs_review (verify failed)
           └─ tool error ──┴──► escalated (human)              └─ connection lost → reconnecting → (resume, idempotent)
 completed → learning? → skill drafted → tests → hidden validation → awaiting promotion → approved skill
 later task + exact match → reuse (no model) → approval → execute → verify
```

These map 1:1 onto the backend's derived states (`app/ops.py`: PENDING, WAITING_APPROVAL, READY, VERIFYING, COMPLETED, NEEDS_REVIEW, CANCELLED).
