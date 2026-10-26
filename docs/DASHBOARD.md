# Ember dashboard

The default route is now the personal workspace (`#/dashboard`, also `#/`). The existing story is at `#/story`; console, guided demo, office, onboarding, and living-map routes remain available.

The dashboard reuses the original animated Ember sprite. Its near-black canvas, emerald glow, thin connections, and human-review gold follow the SkillForge demo video. The main screen has one demo journey and four concise stages. Select a node for its explanation, or start the demo: it pauses at human review until **Continue demo** is selected. This is a browser demonstration, with no execution or approval request. Task creation and setup details live in their own views.

## Available now

- Desktop-first overview, task drafts with editing/search/deletion, skill library, activity, run evidence, and connection settings.
- Drafts persist in browser storage under `sf.dashboard.drafts.v1` (maximum 100). They are browser-local, not account-scoped or submitted to a model. Storage failures are reported when saving.
- Explicit **Demo workspace / Local system** selection. Local mode reuses `useLive` and the existing authenticated GET-only operator API. A failed connection stays offline; no sample tasks or approved skills fill in missing live data.
- Ember's live pose reflects reported open tasks or pending reviews. Its demo pose follows the example's current stage.
- The complete example includes human review, verification, a saved skill, reuse, and a refused lookalike. Its steps remain visible in Activity during the visit.
- Run evidence lazily loads the repository's archived GB10 record, with hidden checks, host approval, the measured reuse trial, and fingerprint refusal. It is labelled as a recorded run and does not imply current host health. The existing run inspector provides code, exact test names, and the source approval command.
- `gb10-record.display.json` is a display copy of `docs/evidence/gb10/reuse-oncall-run.json`, with the local model endpoint omitted from model and audit text. The original source record remains linked and unchanged. Recorded task history and the archived skill keep the demo useful without a current model connection.
- The full-width preview strip has been removed. Small source labels remain within relevant controls and views.
- Reduced-motion settings stop sprite/CSS animation; existing console and host approval behavior is unchanged.

## Continue backend work

The dashboard does not add account authentication, task submission, model orchestration, connector setup, or a browser approval endpoint. Those are separate backend work. For live reading, serve the build through the existing operator service and open its host login link. `VITE_PREVIEW=1` builds continue to make no operator API requests.

## Local development

From `ui/`, install dependencies with `npm ci`, then run `npm run dev`. Open the local URL printed by Vite. For a hosted static build use `npm run build:preview`; for the local operator use `npm run build`.

Validation commands: `npm run build`, `npm run typecheck:qa`, and the existing hosted-preview tests (`npm run build:preview`, then `PW_CHANNEL=msedge npm run test:preview`, setting the environment variable in the syntax of your shell). Preview checks now assert that the global strip is absent, and include the new dashboard routes.
