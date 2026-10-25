# Five extension paths (pick one on the day)

You retarget the foundation in four places:
1. `data/scenario.json`: the records, the evidence and the policy
2. `app/tools.py`: add one or two domain tools and new `_validate` branches
3. `SKILL.md`: the procedure the agent follows
4. `verify_action`: domain checks

The approval gate, idempotency, audit trail and CLI stay unchanged.

## 1. Manufacturing incident agent
- **Data:** machine/line records, sensor readings (CSV to evidence), maintenance logs, SOP thresholds
- **Tools:** `query_readings(machine, window)`, `compare_to_spec`, `find_similar_incidents`
- **Needs approval:** placing a line on hold (`status=on_hold`), changing a setpoint within ±N%, opening a maintenance work order
- **Verify:** re-read the line status and setpoint, and confirm the latest readings are back inside spec
- **90-second demo:**
  1. A Telegram alert says line 3 has a scrap spike.
  2. The agent pulls the readings and finds that the temperature drifted after a setpoint change.
  3. It proposes rolling back to 182 °C.
  4. A supervisor approves.
  5. The setpoint is changed, the verifier passes, and the audit trail is shown.

## 2. Supply-chain recovery agent
- **Data:** purchase orders, inventory, shipment ASNs, supplier lead times
- **Tools:** `stock_projection(sku)`, `alternate_suppliers(sku)`, `reallocate_stock`
- **Needs approval:** moving stock between sites, expediting or reissuing a PO, any spend above a threshold
- **Verify:** recompute the projected stockout date. It must move past the demand date, and inventory must balance across sites.
- **90-second demo:**
  1. A shipment is delayed.
  2. The agent finds that SKU X runs out at site A in 3 days.
  3. Site B has surplus, so the agent proposes a transfer of 200 units.
  4. A human approves, the transfer is applied, and the verifier shows no stockout.

## 3. Engineering incident commander
- **Data:** service catalog, synthetic logs and metrics, deploy history, runbooks
- **Tools:** `grep_logs(service, pattern)`, `recent_deploys`, `runbook_lookup`, `set_feature_flag` and `rollback_deploy` (local mock services)
- **Needs approval:** a rollback, a flag flip, or a restart
- **Verify:** an error-rate query over the logs and metrics after the action, plus a health-check endpoint response
- **90-second demo:**
  1. The p95 alert fires.
  2. The agent correlates it with deploy #42 and cites log lines.
  3. It proposes a rollback.
  4. An on-call engineer approves in Slack.
  5. The rollback runs, the error rate drops, and the agent writes a postmortem timeline from the audit log.

## 4. Secure confidential-workflow agent
- **Data:** confidential documents (contracts, HR or legal records) with classification labels, plus access-control lists
- **Tools:** `search_docs` (local), `classify`, `redact`, `share_internally(doc, group)`
- **Needs approval:** any share, export or declassification. Add redaction inside `read_records` so raw text never reaches chat.
- **Verify:** check that the ACL matches the request and that the shared copy contains no PII patterns
- **90-second demo:**
  1. Someone asks over Telegram for the vendor contract terms.
  2. The agent answers with a redacted summary and proposes sharing the full document with Legal.
  3. A human approves.
  4. The ACL is updated, and `openshell term` shows zero egress. The selling point: nothing left the box.

## 5. Transaction recovery agent
- **Data:** ledger entries, bank statement lines, payment processor export (all synthetic)
- **Tools:** `match_transactions(window)`, `explain_break`, `post_adjustment`
- **Needs approval:** posting an adjusting entry above $X, or reversing a duplicate payment
- **Verify:** the ledger and the bank balance tie out to zero difference for the period, and each adjustment has an execution row
- **90-second demo:**
  1. Month-end reconciliation is off by $1,240.
  2. The agent finds a duplicate vendor payment and a fee booked to the wrong account.
  3. It proposes two adjustments.
  4. A controller approves one and rejects the other. The rejected one stays unexecuted.
  5. The verifier reports the remaining break amount, and the audit trail is ready for SOX review.

## Common pitch elements (all five)
- All inference runs on the GB10.
- The approval gate is enforced in code. The demo shows the refused execute attempt.
- Verification is independent of the agent.
- There is a full audit trail.
- Reset and repeat works.
