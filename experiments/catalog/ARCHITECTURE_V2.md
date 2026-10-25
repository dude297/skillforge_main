# SkillForge V2 architecture: organizational skill library (EXPERIMENTAL, `exp/router`)

This is an experimental branch. Nothing in `app/`, `adapters/`, `tests/`, `data/`, `scripts/` or `validation/` changed: `git diff integ/live -- app adapters tests data scripts validation` is empty. Core never imports `experiments/`.

## 1. What the existing storage already provides (audit)

| # | concern | where it lives today | supports org discovery? |
|---|---|---|---|
| 1 | skill identity | `skills.name` (`^[a-z][a-z0-9_-]{2,40}$`), `UNIQUE(name, version)` | yes, stable id = name |
| 2 | code and SKILL.md | `skills/candidates/<name>/v<n>/` → copied to `skills/approved/<name>/v<n>/` on approval; `meta.json` system-written | yes, read-only after approval |
| 3 | versions and hashes | `skills.version` (monotonic per name), `skills.sha256` = tree hash of the dir; `run_skill` refuses on mismatch | yes, immutable version = (name, version, sha256) |
| 4 | approval status | `skills.status` (`failed_tests`, `tested`, `approved`, `rejected`, `disabled`, `rolled_back`, `not_retained`), `skills.active` (one per name), `decided_by` | yes |
| 5 | validation evidence | `skills.validation` (lint, own tests, replay incl. expected fixes), `skills.hidden_validation` (hidden-suite result), `profile`, `optimization` | partly: `validation.replay` contains **business data** and must not be exposed by search |
| 6 | structural fingerprint | `skills.signature` (shape, kinds, sources, writable, invariants, id), `input_shape`, `touches` | yes: exact matching only |
| 7 | execution history | `skill_runs` (status, proposals, verified_pass/fail), `actions.origin = skill:<name>@v<n>#<run>`, `verifications`, `executions` | yes: last verified execution is derivable |
| 8 | rollback | `rollback_skill` re-activates the newest earlier approved version; old dirs kept | yes |
| 9 | ownership and permissions | **none**: no namespace, owner, roles or dependency record. The agent token reaches every agent tool (`APP_AGENT_TOOLS` can only narrow) | **no: the gap** |

### What was missing for an organizational library
- namespace, owning team and role visibility
- purpose metadata that can be searched (domain, workflow, curated aliases)
- dependency pins and freshness, because unchanged code is not evidence of a compatible environment
- environment compatibility (runner, Python)
- a rebuildable search index that has no authority
- an explanation of why a candidate is not executable

## 2. Six operations, kept separate

| operation | owner | code | authority |
|---|---|---|---|
| creation | agent (or human) during a task with a verified fix | `sf.propose_skill`: lint, own tests, replay | none: produces a `tested` candidate |
| storage | system | `skills` row + `approved/` dir + `meta.json` + `catalog_entries` | none |
| retrieval | anyone visible to a namespace and role | `catalog.search`, `inspect`, `get_skill_md` | **none**: summaries and untrusted text |
| selection | trusted code | `sf.match_skills` (exact fingerprint) + `catalog.check_exact` | none: says "eligible" |
| authorization | named human | `tools.decide_approval` per action; `approve_skill`, `register`, `revalidate`, `revoke`, `set_env_version` | the only grant |
| execution | trusted host | `run_skill(propose)` → policy → approval → `execute_action` (one transaction) → `verify_action` | runs only human-approved actions |

## 3. Layering

```
              ┌──────────── untrusted text ────────────┐
 query / event│  SKILL.md descriptions, fixture labels  │  (stored, indexed, returned wrapped; never parsed for meaning)
              └─────────────────────────────────────────┘
                     │                                  
   RETRIEVAL         ▼   catalog_fts (FTS5, rebuildable, NO authority)
   catalog.search ──▶ JOIN catalog_entries ─ filter: namespace, role, not revoked ─▶ ≤10 summaries
                                                                                    │ suggestion only
   SELECTION         sf.match_skills (exact fingerprint over CURRENT data)          ▼
   catalog.check_exact: catalog visible? fresh? registry approved+active? hidden validation ok?
                        artifact hash ok? environment ok? fingerprint exact and unique?
                     │ eligible
   AUTHORIZATION     ▼  run_skill(propose) ─▶ policy ─▶ request_approval ─▶ HUMAN decide_approval
   EXECUTION            router.complete: executes only human-approved actions ─▶ ops.fastpath ─▶ verify_action
   VERIFICATION         core verifier + domain oracle (independent of the skill)
   AUTHORITATIVE     skills, skill_runs, actions, approvals, executions, verifications, audit, catalog_entries,
   (SQLite, WAL)     env_versions      |  business data: records, evidence, meta  |  artifacts: skills/approved/
```

## 4. Minimal extension plan (what was built; nothing replaced)

- **Two tables plus one index, in the same SQLite file:** `catalog_entries`, `env_versions`, and the `catalog_fts` virtual table (`experiments/catalog/catalog.py`). Every authoritative fact is **read from the existing rows at decision time**: status, active, hash, signature, hidden validation, runs. The catalog copies none of them except `data_sources`. That one is a search input derived from the signature, and it is never used for decisions.
- **Staleness reuses existing registry states.**
  - A stale or revoked version is set to `disabled` and `active=0`, so **core `run_skill` refuses it on every path**: the router, the agent tool, and pinned versions.
  - Revalidation re-runs the *current* hidden suite on the unchanged artifact, then restores `approved` with `active=1`.
- **The router gained a catalog gate, not a second implementation.** `experiments/router/router.py` added four things:
  1. each event source maps to one namespace
  2. `check_exact` runs before `run_skill`
  3. `stale_exact` sends "used to be routine" work to a human
  4. bounded suggestions for agent escalations

### Proposed core changes, NOT made (each needs review because it touches the frozen core)
1. A `skills.namespace` column, or a view over `catalog_entries`, so the agent tool `search_skills` filters by namespace too. Today it shows every approved skill to every agent.
2. An `escalate` channel in the skill output contract. `_valid_proposals` accepts exactly `{proposals}`, so a skill that correctly *refuses* a CAD invoice cannot say so. The router then reports "nothing to change", which is misleading.
3. Verifier support for `carrier_invoice_net`. `invariant_violations` silently ignores unknown rules. The demo uses the fixture's independent `hidden_validation.verify` as the oracle instead.
4. A system actor for staleness. `_human` only rejects the literal names agent, system and policy. The catalog writes `disabled` directly and audits it as `catalog:freshness`.

## 5. Coordinator integration plan (no new routing implementation)

The coordinator wraps `router.route` and `router.complete`. Its responsibilities, in order:
1. **Receive.** Unix socket or file-drop. Each source is allowlisted to its own types and **one namespace**.
2. **Normalize.** The router's exact-key event schema: `event_id`, `source`, `type`, and a reference to host-owned data.
3. **Check the exact registry.** `match_skills` + `check_exact`. No model, no index.
4. **Consult search.** Only after the exact check fails. Suggestions are stored with the event (`router_events.suggestions`) as agent context.
5. **Run approved skills.** Nothing runs before a human approves each action. `complete` refuses policy auto-approval.
6. **Escalate.** Write `queued_for_agent`, then dispatch one `OpenClawAgent.turn` when inference is up. A retrieved SKILL.md given to the agent at this point is RAG; it stays untrusted and grants nothing.
7. **Persist deferred work.** `router_events` *is* the queue. Redelivering a `deferred` event re-routes it.
8. **Wake.** Advisory only (`experiments/router/power.py`). Model serving has its own lifecycle (NemoClaw/vLLM, `switch_model.sh`). The coordinator never stops or starts a model.
9. **Offline inference.** Exact work completes. Stale or ambiguous work goes to a human. Unfamiliar work is deferred. Search keeps working because it is SQLite.

**Known ceiling:** one event at a time, because scenario loading replaces the domain tables. Per-record locking comes when events reference live records.
