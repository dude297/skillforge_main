---
name: records-ops
description: Investigate discrepancies in local business records, propose bounded fixes, request human approval, execute only approved fixes, verify results, and learn reusable deterministic skills from verified solutions. Use for any question about records, discrepancies, corrections, approvals, learned skills or the audit trail.
metadata: {"openclaw": {"requires": {"bins": ["python3"]}}}
---

# records-ops

You run every tool by passing one shell command to your `exec` tool. Each command prints JSON. If the output has `"ok": false`, the call failed and `error.code` says why.

```
python3 {baseDir}/client.py <tool> '<json-args>'
```

The tools run in a trusted service outside your sandbox. You only see what each tool returns. If you get `service_unreachable`, report it and stop; don't try to reach the data some other way.

## Tools

| tool | args | purpose |
|---|---|---|
| search_skills | `{"query": "..."}` | List learned skills. `compatible: true` means a skill fits the data currently loaded. |
| run_skill | `{"name": "...", "propose": true}` (optional `"version": N`) | Run an approved, deterministic skill. It files proposals that still need human approval, and returns `outcomes` per record and `needs_person` (records it refused). |
| read_records | `{}` or `{"record_id": "..."}` | Read the current records. |
| investigate | `{"record_id": "..."}` | Return the record, its evidence, and any direct field mismatches. |
| freight_invoice | `{"record_id": "PO-..."}` | Read-only: the PO's trusted carrier invoice parsed into header, lines, trailer, `lines_net` and `issues` (currency, PO, trailer, unknown codes). |
| propose_action | `{"record_id": "...", "action_type": "set_field", "params": {"field": "...", "value": ...}, "reason": "..."}` | Propose a fix. Policy limits which fields and values are allowed. |
| request_approval | `{"action_id": N}` | Ask a human to approve a proposed fix. |
| execute_action | `{"action_id": N}` | Apply a fix. This only works after a human has approved it. |
| verify_action | `{"action_id": N}` | Re-check the stored state independently. |
| propose_skill | `{"name": "...", "path": "/sandbox/skill-drafts/<name>", "description": "...", "tags": [...]}`, optionally `"optimizes": N` | Submit a reusable helper you wrote, after a verified solve (or ONE optimized revision of version N). |
| get_audit | `{"limit": 20}` | Show the audit trail. |

## Procedure

1. **Check for a learned skill first.** Call `search_skills`.
   - If a skill is `compatible: true`, call `run_skill` with `propose: true` and go to step 4.
   - If no skill is compatible, do not force one to run.
2. **Investigate with your own reasoning.** Call `read_records` and `investigate`.
   - A record can be wrong even when `findings` is empty. Look at the evidence and work out how the record's values should follow from it.
   - For calculations, you may write a one-off Python snippet and run it with `exec`. This is scratch work, not a skill.
   - If the trusted sources conflict, or the evidence doesn't support a single answer, report that and propose nothing.
   - Freight POs: call `freight_invoice`. If it lists `issues` (for example another currency), propose nothing for that PO and ask a person to decide.
   - If a skill proposes nothing for a record the user reported, investigate that record yourself before answering.
   - Report every `needs_person` record by id with its reason. Never call a refused or `not_reported` record fixed or fine.
3. **Propose fixes.** Call `propose_action` for each record that needs a fix, then call `request_approval`.
   - Tell the user the action ids and what will change, then wait.
   - You cannot approve fixes yourself.
4. **After the user says "approved":** call `execute_action`, then `verify_action`, for each approved action.
   - Report what `verify_action` returns. Never claim success unless `passed` is `true`.
   - If `verify_action` returns a `hint` saying a skill failed, investigate that record manually. Then submit a revised skill under the same name.
5. **Learn (only after step 4 passed), and only if the fix followed a rule that will apply to future data.** Do this when the same computation fixed several records, and the rule depends only on the records and their evidence.
   1. Write a draft in `/sandbox/skill-drafts/<name>/` containing three files:
      - `SKILL.md`: frontmatter with `name` and `description`, then one paragraph on when to use the skill.
      - `scripts/helper.py`: `def run(dataset) -> {"proposals": [{"record_id", "field", "value", "reason"}]}`.
        - `dataset` is `{"records": [{id, kind, data}], "evidence": [{record_id, source, trusted, data}]}`.
        - Use only pure Python. Allowed imports: `json`, `math`, `decimal`, `fractions`, `statistics`, `collections`, `itertools`, `functools`, `re`, `datetime`, `typing`, `dataclasses`, `operator`, `copy`.
        - Do not use files, network, `os`, `eval` or `getattr`.
      - `tests/test_helper.py`: `from helper import run`, plus at least two `test_*` functions using small hand-built datasets.
        - Include one case that should change a record and one that should not.
        - Work out the expected values by hand. Do not compute them by calling `run`.
   2. Call `propose_skill`. The system then:
      - lints the helper
      - runs your tests
      - replays the helper on this task's original data
      - checks that its proposals exactly match the fixes the human approved and the verifier confirmed
   3. If `status` is `failed_tests`, read the `validation` output, fix the draft and propose it again.
   4. If `status` is `tested`, tell the user the skill is waiting for human approval. A human also runs hidden tests that you cannot see. Make the helper general (for example, read the scale from the data) rather than tuned to this dataset.
   5. **Optimize at most once, and only when the system suggests it.** Do this only if `profile.recommended` is `true`.
      - Use `profile.evidence` (for example "superlinear work" or "repeated identical calls") to write one improved draft.
      - A typical fix is to index records in a dict instead of scanning, and to compute each value once.
      - Submit it with `propose_skill` and `optimizes: <version>`.
      - The system re-runs every check and benchmarks both versions on identical inputs. It keeps your revision only if it is still correct and measurably faster.
      - Do not try a second time.
6. **Chat hygiene.** In chat, send only record ids, field names and before/after values. End every answer with one of: `verified` (verify_action passed), `waiting for approval` (with action ids), or `needs a person` (with the reason). Do not paste evidence payloads or code unless the user asks.
7. **Don't work around refusals.** If you get `not_approved`, `policy_violation`, `incompatible_input` or `integrity_error`, report it. Do not retry with different values to get around it.
