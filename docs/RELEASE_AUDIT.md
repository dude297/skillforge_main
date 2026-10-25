# Release audit (2026-10-25)

Scope: the public tree (`public/main` = `633b030`, plus the fixes on branch `docs/public-release`), and for the
privacy scan also the engineering trees `demo/oncall` (`c040cd5`) and `demo/judge-kit` (`16c1a73`). Done by reading the
docs against the code, running the documented commands, and pattern-scanning trees and history. Secret values are never
printed here; only file:line and the token type.

**Verdict: GO to publish the public tree after the "before you push" items below. NO-GO to publish `demo/oncall`
or `demo/judge-kit` as they are. Live GB10 OnCall is not verified, and nothing in the public docs says it is.**

## Before you push (process, not content)

1. **Treat the previously exposed GitHub token as compromised.** Revoke it and use fresh credentials. No token was
   found in any tree or in any commit of any branch (pattern scan for `ghp_`, `gho_`, `ghs_`, `github_pat_` over all
   history). Remote URLs contain no embedded credentials.
2. **Push one ref only** (`git push public docs/public-release:main` or equivalent). Never `--all`, `--mirror` or a
   branch from the engineering line: about 105 commits there (114 counted at the end of this audit, as other work
   continues) carry a personal email address, derived from the owner's name, as author and committer, and the author
   name is "unknown". `public/main` uses the `SkillForge team` / `users.noreply.github.com` identity. **Commits made
   with the default local git config carry that personal address too**; the commits on `docs/public-release` were
   re-authored to the public identity (check with `git log --format='%an %ae %ce'` before pushing).
3. Decide the licence question below.

## Findings

### Blocker

None in the public tree. The following would be blockers **only** if the engineering trees were published:

- B1. `demo/judge-kit:CLAUDE.md:10` and `demo/oncall:CLAUDE.md:10` name the private repository and internal rules;
  internal docs (`docs/TEAM.md`, `docs/ORGANIZER_MESSAGE.md`, `docs/PRE_EVENT_REVIEW.md`, `docs/OVERNIGHT_PROGRESS.md`,
  `docs/UNIFIED_ALPHA.md`, `docs/HACKATHON_DAY.md`, `docs/RELEASE_RC1.md`, `docs/UX_REVIEW.md`) are not meant for
  publication, and `docs/ORGANIZER_MESSAGE.md` is an unsent draft to the organisers.
- B2. `demo/judge-kit:deploy/gb10/README.md:12` contains the GB10's SSH user and hostname (`dell@promaxgb10-...`).
  The public tree replaced it with a placeholder (`docs/GB10_SETUP.md:22`).

### Should-fix

- S1. **Stale screenshots, 347 PNGs, about 40 MB, in `ui/screenshots/`** (everything except `ui/screenshots/demo/`
  predates the copy fix `16c1a73`). Example: `ui/screenshots/live/system-1440.png` shows the status text "Live reads the
  GB10", which the UI no longer says. Not private (a pixel review of samples and a string scan found no username, host or
  path), but they contradict the "nothing measured on the GB10" message. Mitigation applied: a note in
  `docs/LIMITATIONS.md` (Launchers section). Better: delete all but `ui/screenshots/demo/` (only `scene-4` and `scene-5`
  are referenced from `README.md:103`) before publishing. Not done here because other docs list these folders.
- S2. **Licence decision: resolved 2026-10-25, MIT** (owners' decision). `LICENSE` is now MIT plus the third-party
  notices, and the README licence section says the same.
- S3. `deploy/gb10/make_bundle.sh:14-15` leak check covers only the hostname, `git config user.email` and `C:\Users`.
  It does not check the Windows username, runs before `ui/dist` is built and copied in, and `grep -I` skips binaries.
  The bundle also carries internal docs and the tracked `ui/tsconfig.tsbuildinfo` (see N3). Fine for a private
  transfer to the GB10; do not publish a bundle.
- S4. **Test coverage of this audit.** The full `pytest` suite (about 3 min) and the Playwright e2e suites (mock 78/78)
  were not re-run. The claims that cite them remain "reported" (see `docs/DEVELOPMENT_LOG.md`, Part 3).
- S5. `docs/SECURITY.md:105-110` tells reporters to use GitHub private vulnerability reporting. That only works if it is
  enabled in the repository settings; enable it, or give a contact.

### Fixed in `docs/public-release` (were should-fix)

- F1. `README.md` §3 "what is new" and "differentiator ... do not give that guarantee": reworded to "what is different",
  marked as a design claim not benchmarked against other systems. Same for `docs/JUDGE_QA.md` ("What's novel?" and
  "Most tool-calling agents ...").
- F2. `README.md` §8 and `docs/JUDGE_PITCH.md:17`, `docs/JUDGE_QA.md` ("Why the GB10?"): "Nothing leaves the box" and
  "never leave the box" stated as fact. The OpenShell egress policy is not verified (`docs/SECURITY.md`, Network
  exposure). Reworded as design intent.
- F3. `README.md` §12 said generated code runs "in a subprocess or Docker runner (no network)". The subprocess runner's
  network block is a Python-level socket patch (`app/_runner.py:28`), not isolation; `--network none` applies to the
  Docker runner only (`app/skillforge.py:214`). Reworded.
- F4. `docs/SKILLFORGE.md:3` "provably reuses it": replaced by "evidence, not formal proof", consistent with
  `docs/CLAIMS.md` claim 27.
- F5. `README.md` §11 and `docs/DEVELOPMENT_LOG.md` presented all listed work as "done during the hackathon". The core
  runtime, UI console, router, catalog and runbooks were developed 2026-10-20 to 2026-10-23. Now split into pre-event
  foundations and event-day work with commit hashes.
- F6. `docs/DEVELOPMENT_LOG.md` GB10 section is a "pending, not yet measured" placeholder with empty rows; anchors in
  `docs/BENCHMARKS.md` and `docs/GB10_SETUP.md` updated. `ui/.gitignore` now ignores `*.tsbuildinfo`.

### Note

- N1. No secrets in the public tree. Matches reviewed: `docs/WORKFLOW_FREIGHT.md:47` (`xoxb-...` placeholder with an
  ellipsis, Slack bot-token type), `tests/test_ui_api.py:13`, `experiments/bootstrap_lite/test_lite.py:16`,
  `ui/e2e-live/live.spec.ts:17`, `ui/e2e-live/bootstrap-lite.spec.ts:18`, `ui/e2e-live/provenance.spec.ts:18` (all fake
  test tokens), `scripts/unified.py:178` (`dana@acme.example`, a synthetic address). `demo/*:docs/DEMO.md:48` mentions
  `nvapi-` only as a grep pattern.
- N2. No personal identifiers in the three trees: no `C:\Users` paths except the generic mentions at
  `docs/SECURITY.md:103` and `experiments/oncall_infer/README.md:49`; no hostname, email or Windows username; the
  recorded run uses `"host": "<dev-box>"` (`ui/public/demo/oncall-run.recorded.json:5`). Hardware fingerprints of the dev
  box remain in `experiments/perf/results/devbox.json:3-4` (`Windows-11-10.0.26200-SP0`, `AMD64`) and
  `ui-experiments/WORLD_EXPERIMENT.md:45` (Intel Arc GPU); low risk.
- N3. `ui/tsconfig.tsbuildinfo` is tracked in `demo/oncall` and `demo/judge-kit` (relative paths only, no private
  data) but not in the public tree. It is regenerated by every UI build; now gitignored in the public branch.
- N4. No `node_modules`, `__pycache__`, `.env`, `*.db`, `data/.agent_token`, `data/.operator_token`, keys or logs are
  tracked in the public tree or either engineering tree. Largest tracked file is a 540 KB PNG; no large binaries.
- N5. `docs/GB10_SETUP.md:22,29` contain `/media/dell/Extreme SSD/...`, the SSD mount path on the GB10; generic, but
  it identifies the venue hardware.
- N6. The public tree code (`app/`, `adapters/`, `experiments/`, `ui/src`) is identical to `demo/judge-kit` except
  two label changes in `ui/src/console/ConsoleShell.tsx` and `ui/src/world/World.tsx` (they add the recording date)
  and file renames. Doc differences are the intended exclusions.
- N7. `docs/ENTERPRISE_SLICE.md:98-109` has a "GO / NO-GO (dev box)" table. It is labelled dev box and lists real-model
  learning and GB10 hardware as NO-GO; keep that label if the file is quoted.
- N8. Intermittent failures under load are documented (`docs/LIMITATIONS.md`, Reliability); not investigated.
- N9. `README.md` and `docs/DEVELOPMENT_LOG.md` say commits carry a `Co-Authored-By: Claude` trailer. Checked: every
  commit on every local branch (122 at the time) has one.

## Verification run (this audit, Windows 11, Python 3.14.3, Node 24.15.0)

| check | result |
|---|---|
| `python -m app demo --yes` | exit 0, `verification PASSED` (MOCK) |
| `pytest` contracts + oncall + gb10_bench | 33 passed, 1 skipped |
| `pytest` contracts + bakeoff + oncall + gb10_bench | 36 passed, 1 skipped |
| `cd ui && npm ci && npm run lint && npm run build` | OK (build artifacts removed afterwards, not committed) |
| `bash start-demo.sh --no-open --port 8799` | console up, `/ui/health` 200; stopped |
| relative Markdown links | 0 dead; plain-text path references to files missing from the tree are only runtime outputs (`results/`, `data/`, gitignored) |
| spot-checks of README/SECURITY claims vs code | `0.0.0.0` refusal (`app/server.py:130`), UI loopback-only and GET-only (`app/ui_api.py:42,503,564`), `UNIQUE(name, version)` (`app/db.py:119`), Docker flags (`app/skillforge.py:214-217`), approver names rejected (`app/tools.py:428`): all match |
| GB10 behaviour, live inference, egress policy, UI e2e, full suite | not verified here |
