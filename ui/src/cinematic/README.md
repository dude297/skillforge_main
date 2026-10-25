# The Forge (cinematic layer)

A lazily loaded 3D layer (three.js + React Three Fiber) that tells SkillForge's story: the GB10 wakes, incident
evidence is investigated, a person decides at the review desk, an independent gate verifies, the fix is forged into a
hash-pinned skill, and the next compatible incident takes the short path (no model) while a mismatch is refused.

- `contract.ts`: shared types (`CineVisual`, `Quality`), world `LAYOUT`, semantic colours. Read this first.
- `adapters/`: SceneState (world/events.ts fold) -> `CineVisual`; illustration and recorded OnCall event scripts.
- `scenes/`, `materials/`, `assets/`: the set (GB10, review desk, verification gate, library) and post-processing.
- `actors/`: what moves (evidence fragments, the proposal, the skill artifact, packets, Ember).
- `timeline/`, `overlay/`, `fallback/`, `Cinematic.tsx`: sequencing, camera, typography, controls, WebGL/reduced-motion fallback.
- `dev/` + `ui/cinematic-dev.html`: a dev-server harness. Not part of the production build (Vite builds index.html only).

Truth rule: progress and status come from the fold, never from elapsed time. Time only animates between known states.
