# Router and catalog acceptance (EXPERIMENTAL, dev box, MOCK-backed)

```bash
python -m pytest -q -p no:cacheprovider experiments/catalog/test_catalog.py   # 21 tests, ~10 s (library built once)
python -m pytest -q -p no:cacheprovider experiments/router                    # 20 tests, ~40-70 s
python -m pytest -q -p no:cacheprovider experiments/ops_discrepancy           # 5 tests (fixture's own proofs)
```

Run them one at a time; the dev host was recently low on memory. Correctness oracles are independent of the code under test:
- `bench.correct`: scenario invariants.
- `hidden_validation.verify`: a raw-line regex re-count that shares no code with the skill.
- Hand-written retrieval labels.

## Security and acceptance matrix

| case | expected | test |
|---|---|---|
| exact compatible skill | proposes → human approves → executes → verifies; oracle confirms | `test_supply_chain_known_unknown_changed`, `test_exact_match_proposes_only_and_needs_human_approval` |
| unknown skill | no execution; bounded suggestions; queued (model up) or deferred (down) | `test_supply_chain_*` (unknown), `test_lookalike_never_runs_the_skill` |
| similar name, different semantics | lookalike and unrelated data never run the skill; same-named skill in another namespace invisible | `test_lookalike_*`, `test_cross_namespace_*`, retrieval rows |
| overlapping candidates | two exact matches → `needs_human` (ambiguous); search returns several, none executable from search | `test_ambiguous_exact_matches_go_to_human`, `test_search_is_bounded_summaries_without_authority` |
| revoked skill | gone from search without reindex; `run_skill` (also pinned) refused; router does not execute | `test_revoked_version_*` |
| stale dependency | refused even though the fingerprint is exact; `needs_human: revalidation required`; with the model down, still a human (not deferred) | `test_supply_chain_*` (changed), `test_changed_rule_with_model_down_*`, `test_undeclared_dependency_*` |
| revalidation | current hidden suite must pass; new-rule suite fails the old artifact, which stays preserved | `test_revalidation_*` (2) |
| malformed SKILL.md | not registered | `test_malformed_skill_md_is_not_registered` |
| tampered artifact | refused by `check_exact`, `get_skill_md`, `run_skill` and the router | `test_tampered_artifact_is_refused_everywhere` |
| missing validation record | not executable; not registrable | `test_missing_validation_record_*` |
| hidden-test data exposure | search, inspect and SKILL.md carry no replay data, hidden case names, host paths or token file name | `test_no_hidden_or_secret_data_in_any_retrieval_output` |
| cross-namespace retrieval | invisible; same `not_found` as nonexistent | `test_cross_namespace_and_wrong_role_get_the_same_not_found` |
| unauthorized inspection (role) | same | same |
| prompt injection in retrieved text | stored and returned as `untrusted_text`; no state change; FTS/SQL syntax in queries is inert | `test_prompt_injection_in_retrieved_text_changes_nothing` |
| environment incompatibility | runner not allowed → `needs_human` | `test_environment_incompatibility_blocks_execution` |
| duplicate event | stored decision returned; reused id with a different body refused | `test_duplicate_and_reused_ids` |
| failed execution verification | `needs_review`, never auto-redone | `test_failed_verification_needs_review` |
| policy auto-approval | not treated as human authorization; nothing executes | `test_policy_auto_approval_is_not_human_authorization` |
| conflicting open change | `needs_human`, no execution | `test_conflicting_open_change_goes_to_human` |
| database restart | catalog, entries and routing unchanged after reconnect; mid-route crash resumes without duplicates | `test_catalog_survives_restart`, `test_restart_mid_route_*` |
| search index corruption / loss | rebuilt from entries; identical results; audited | `test_index_corruption_and_loss_are_rebuilt` |
| index stale after promotion / revocation | new entries searchable and revoked ones hidden with no reindex | `test_new_registration_*`, `test_revoked_version_*` |
| model unavailable | known task never consults inference; unknown deferred; changed rule goes to a human | `test_known_task_never_consults_inference`, `test_lookalike_*`, `test_changed_rule_with_model_down_*` |
| untrusted events | wrong source or type, extra keys, path traversal, unknown fixture, oversize id → refused | `test_untrusted_events_refused` (7 cases) |
| portability | the same catalog API serves OnCall; no conditional in catalog or router code mentions a domain | `test_same_interfaces_serve_oncall_with_no_domain_branching` |
| bootstrap read-only | manifest, catalog procedures and unverified assumptions; DB hash unchanged | `test_bootstrap_*` (2) |

## Performance (dev box; see `experiments/catalog/SKILL_LIBRARY.md` for retrieval)

Router comparison (`python -m experiments.router.compare --trials 3`, MOCK agent, 9 cases × 3 variants, catalog gate on):

| variant | correct | done without inference | to agent | to human / review | deferred | false skill match | model calls | energy |
|---|---|---|---|---|---|---|---|---|
| A always-agent | 24/27 | 0 | 27 | 0 | 0 | 0 | unknown | unknown |
| B deterministic-first | 24/27 | 9 | 15 | 3 | 0 | 0 | unknown | unknown |
| C B, model down | 15/27 (12 deferred, left unchanged) | 9 | 0 | 3 | 15 | 0 | **0** (structural) | unknown |

- **The 3 "wrong" rows in B and C** are the injected post-execution drift. The verifier catches it and the event ends `needs_review`.
- **Mock latencies are not a model comparison.** The mock agent costs about 0 s.
- **Model calls are 0 only where the code path has no inference.** That is asserted, not inferred. A scripted agent cannot tell how many calls a real model needs.
- **No energy claims.** There is no wattage source on this host.
