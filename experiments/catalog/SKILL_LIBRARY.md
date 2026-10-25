# Skill library: catalog, artifacts, lifecycle, retrieval (EXPERIMENTAL)

Code is in `experiments/catalog/catalog.py`. Tests are in `test_catalog.py` (21 tests) and `experiments/router/test_router.py` (20 tests). All of it is MOCK-backed (see "Honesty" at the end).

## Catalog schema (added; justified field by field)

| field | why it exists | if absent |
|---|---|---|
| `skill_name`, `version` | link to the authoritative `skills` row | — |
| `namespace` (`org/unit`) | retrieval and execution visibility; one per event source | cross-team leakage |
| `owner_team` | who revalidates when it goes stale | orphaned skills |
| `domain`, `workflow` | search facets, weighted in FTS | weaker recall |
| `summary` | the SKILL.md `description`, **untrusted** | — |
| `aliases` | owner-curated vocabulary (the measured recall gain, see below) | 0.866 → recall drops |
| `data_sources` | derived from the registry signature (kinds, sources); search input only | — |
| `roles` | who may see, inspect and route to the skill | — |
| `environment` | `runners`, minimum `python`; checked by `check_exact` | runs under an untested runner |
| `dependencies` | `{key: version}` pinned at validation | silent business-rule drift |
| `freshness`, `freshness_reason`, `validated_at` | `fresh`, `stale` or `revoked`, plus why | — |
| `catalog_only` | metadata with no artifact (fixtures, OnCall); never executable | — |
| `env_versions(key, version, set_by)` | the operator-declared current world | — |

**Not added, because the registry already has them:** status, approval, hash, signature, schemas (`input_shape`, `touches`, `PROPOSAL_KEYS`), validation, execution history, rollback. **Not added, because nothing needs them yet:** dependency graphs, a per-skill ACL beyond roles, tenancy.

## Artifact storage and versioning

These rules are unchanged:
- `skills/approved/<name>/v<n>/` holds `SKILL.md`, `scripts/helper.py`, `tests/test_helper.py` and a system-written `meta.json`.
- The tree hash is pinned in `skills.sha256`.
- `run_skill`, `check_exact`, `get_skill_md`, `register` and `revalidate` all refuse a changed artifact (`test_tampered_artifact_is_refused_everywhere`).
- Old versions are never deleted. Stale, revoked and rolled-back dirs stay for audit and rollback.

**Agent Skills alignment.**
- The SKILL.md frontmatter has `name` and `description` (≤1024 characters). `register` refuses a file without them, or with a name that differs from the registry (`test_malformed_skill_md_is_not_registered`).
- One known divergence: the spec wants the folder name to equal `name`, but SkillForge stores `<name>/v<n>/`. An export step that writes `<name>/` for interchange would bridge that without changing the runtime layout. Not built, and not checked against `scripts/package_skill.sh`.

## Lifecycle, mapped onto the real state model

| lifecycle | real state | transition (who) |
|---|---|---|
| DRAFT | `candidates/<name>/v<n>`, status `failed_tests` | `propose_skill` (agent) |
| VALIDATED | status `tested` (lint, own tests, replay against the human-approved verified fixes) | `propose_skill` |
| APPROVED | status `approved` + `hidden_validation.ok` | `approve_skill` (human; hidden suite runs) |
| ACTIVE | `approved`, `active=1`, catalog `fresh`, registered in a namespace | `catalog.register` (human) |
| STALE | catalog `stale` + registry `disabled` | `set_env_version` → `refresh` (pinned dependency differs or is undeclared) |
| REVOKED | catalog `revoked` + registry `disabled`; hidden from search | `catalog.revoke` (human) |
| REVALIDATED | back to ACTIVE with dependencies re-pinned | `catalog.revalidate` (human; **current** hidden suite must pass) |
| RETIRED | `rejected`, `rolled_back`, `not_retained`, or `revoked` | existing commands |

## Dependency and freshness behaviour (implemented)

The example is a **carrier contract revision**, which the data does not show. `freight-invoice-reconcile@v1` pins `contract:kestrel-freight=rev-2026-10` and `schema:kfl-export=v2`. The sequence:

1. The operator runs `set_env_version(contract:kestrel-freight, rev-2026-11)`.
2. `refresh` marks the skill stale, records the reason, and disables it in the registry.
3. The same week-2 data arrives. Its fingerprint is still exact, so `stale_exact` matches and the router answers `needs_human: revalidation required`. Direct `run_skill` and pinned-version `run_skill` both return `not_found`.
4. `revalidate` re-runs the hidden suite as it is **now**:
   - If the human updated the suite to the new rule (detention credits no longer deductible), the old artifact **fails** and stays stale. The prior version is preserved (`test_revalidation_against_the_new_rule_fails_*`).
   - If the change does not affect the rule, it passes, the dependencies are re-pinned and the skill is reactivated (`test_revalidation_passes_and_reactivates`).
5. An undeclared dependency counts as changed (`test_undeclared_dependency_counts_as_changed`).

## Retrieval

| call | returns | never returns |
|---|---|---|
| `search(q, principal, limit≤10)` | name, version, namespace, domain, workflow, `{untrusted_text}` summary (240 characters), freshness, registry state, score; `authority: none` | code, paths, hashes, validation/replay data, hidden cases, other namespaces, revoked versions |
| `inspect(name, principal)` | org metadata, dependencies, environment, approver, `hidden_validation_ok` (bool), input/output schema, run counts | replay expectations, hidden cases |
| `get_skill_md(name, principal)` | one hash-verified SKILL.md as `{untrusted_text}` | revoked, catalog-only or tampered skills |
| `check_exact(name, principal)` | `{executable, reasons}` from authoritative rows | — |

Further behaviour:
- **Same answer for absent and not-yours.** A name that doesn't exist and one in another namespace both get `not_found`, so there is no existence oracle (`test_cross_namespace_*`).
- **Inert queries.** Queries are tokenised and quoted, so FTS and SQL syntax does nothing (`test_prompt_injection_*`).
- **The index is disposable.**
  - Each query does a cheap row-count check, then rebuilds and retries if the query fails.
  - `verify_index()` runs the full integrity check, meant for startup.
  - Promotion and revocation are effective without a reindex because authority filters join the live tables.

### Retrieval benchmark (`python -m experiments.catalog.retrieval_bench`)

- **Catalog:** 21 hand-written synthetic entries.
  - 9 supply-chain, including a revoked v1.
  - 2 finance and 2 HR (all unauthorized for this principal).
  - 1 records entry.
  - 1 prompt-injection entry in `acme/evil`.
  - 6 OnCall.
- **Queries:** 31 hand-labelled. They cover exact names, paraphrases, abbreviations, jargon, "no lexical overlap" queries, unauthorized-only queries and one broad query.
- **Setup:** k=5, Windows dev box, no model.

| variant | recall@5 | P@3 | top-1 correct | wrong top-1 | auth failures | median / max ms | median context | index build (21 entries) | DB size |
|---|---|---|---|---|---|---|---|---|---|
| FTS5 text only | 0.866 | 0.322 | 0.828 | 0.161 | 0 | 0.74 / 5.2 | 1.4 KB | 27 ms | 143 KB |
| FTS5 + curated aliases | **0.969** | 0.356 | **0.966** | 0.065 | 0 | 0.59 / 0.73 | 1.4 KB | 30 ms | 160 KB |

How to read this:
- **P@3 tops out at 0.333** here because most queries have exactly one relevant skill.
- **The "wrong top-1" left with aliases:** "my shipper invoiced the same load two times" returns freight-reconcile first (duplicate-detect ranks second). The other case is the unauthorized-only finance query, which returns *authorized* neighbours. Neither is a leak.
- **Caveat: aliases and queries were written by the same person in the same session.** The alias gain is optimistic until the queries come from real users, who are held out.
- **Scale** (catalog-only entries, same machine): 10,500 entries take 7.8 MB, about 1.2 KB per entry. Median search is 23 ms. A full index rebuild takes 4.7 s.
- The first version ran the FTS integrity check on every query. That measured ~600 ms at 10.5k entries, so the full check moved to `verify_index()`.

### RAG and vector search recommendation

**Do not add embeddings now.**
- Lexical FTS5 with owner-curated aliases reached 0.969 recall@5, with zero authorization failures and sub-millisecond queries, with no model, download or new service.
- The failures without aliases were pure vocabulary gaps: "three way match", "server ran out of space", "carrier bill … accrual". Curating synonyms per skill fixes those, and the skill owner already has to write metadata.
- No local embedding library or model is installed. Adding one needs an approved download, which was not done.

Revisit only if **held-out real queries** show recall well below this. Then run a local, version-pinned embedding index as a *second ranker over the same filtered candidate set*, with search authority only. Either way, nothing retrieved authorizes anything.

**Terminology:** this is search. It becomes RAG only when a retrieved SKILL.md or document is placed in the agent's prompt, in the `queued_for_agent` path. It must stay `untrusted_text` there too.

## Honesty
- Both executable skills are **MOCK-authored by a human**, and their "solves" were scripted. They were promoted only through the unchanged core rules: verified fix, replay, own tests, hidden suite, human approval.
- The OnCall entries and the other supply-chain capabilities (PO quantity, duplicate charges, contract rates) are **catalog-only metadata**. They have no artifact and are **not** validated skills.
- Supply-chain correctness is judged by the ops fixture's independent `hidden_validation.verify`, not by the core verifier, because the core verifier ignores this rule.
