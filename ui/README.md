# SkillForge UI

This is the cinematic product story and operator console for SkillForge. It runs entirely on the local machine: no CDN, no cloud, no tracking.

## Launch

```bash
cd ui
npm ci                       # once; dependencies are pinned in package-lock.json
npm run build                # type-check + production build into dist/
npm run preview              # http://127.0.0.1:4173
# On the GB10 without Node at demo time, any static server works (relative asset paths):
python3 -m http.server 4173 --bind 127.0.0.1 -d dist
```

**Routes:**
- `#/`: the story
- `#/console/<overview|investigations|skills|history|benchmarks|system>`
- `#/demo`: presenter mode. ←/→/Space step through it; N toggles notes.

**Product wording:** `?product=neutral|oncall|ops` (presets live in `src/config/product.ts`).

## Data sources (always labelled on screen)

| source | what it is | when to use |
|---|---|---|
| **Preview** (synthetic) | A scripted run that exercises every state. Failures can be rehearsed with the checkboxes. | Design reviews, and as the honest fallback if the GB10 run fails |
| **Recorded** | A real `result.json` from `python3 -m app bench --out <dir>`, loaded in Benchmarks. Mock runs are flagged as MOCK. | Showing measured numbers |
| **Live** | The proposed read-only operator API (`CONTRACT.md`). **It doesn't exist yet**, so the UI says "not connected". | After the host API has been reviewed and added |

- The UI never falls back from live to synthetic.
- The browser can't approve, promote or execute anything. It shows the host command instead.

## Offline asset strategy

- Fonts are self-hosted through `@fontsource-variable/*` and bundled into `dist/assets`.
- Icons are inline SVG (lucide).
- There are no remote images, video or WebGL.
- **Verified:** loading `#/`, `#/console/*` and `#/demo` with every non-localhost request blocked made **0 external requests**, and both fonts loaded locally.
- The model registry shown under System is the repository's real `data/models.json`, bundled at build time.

## Quality tooling

| command | what |
|---|---|
| `npm run typecheck`, `npm run lint` | TypeScript strict; ESLint with the React hooks rules |
| `npm run test:e2e` | Playwright in the **installed Microsoft Edge** (no browser download): workflow, failures, sources, keyboard, overflow, axe |
| `node scripts/shoot.mjs screenshots/latest [--reduced]` | screenshots at 1440, 1024, 768 and 390 for the story, console states and sections |
| `node scripts/frames.mjs` | story frames at precise scroll positions (the scrubbed choreography) |
| `node scripts/perf.mjs` | main-thread busy % when idle, scroll fps and long tasks (CDP metrics) |
| `node scripts/contrast.mjs` | WCAG contrast of every text token on every surface |

Design: `DESIGN.md` covers the tokens, storyboard, motion spec and state diagram. Integration: `CONTRACT.md`.
