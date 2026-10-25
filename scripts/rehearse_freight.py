"""Freight rehearsal: employee message -> agent -> approval -> verification -> reply, on the REAL backend.

  python scripts/rehearse_freight.py [--ui] [--approve auto|manual] [--pace 0.8]     (same flags as rehearse.py)

What is real: `python -m app serve` + agent token + POST /call, every tool (incl. the read-only `freight_invoice`
tool), policy, CLI approvals, the verifier's own `carrier_invoice_net` check, skill sandbox + 12-case hidden suite,
audit, console. What is NOT:
  - the channel. Messages are SIMULATED (printed + data/rehearsal/messages.jsonl), not Slack/Telegram.
  - the agent. A fixed script decides (no model; model_calls stay null). On the GB10 the same tool calls come from
    OpenClaw + the local model, and NemoClaw's channel carries the messages.
  - the data. SYNTHETIC freight POs and carrier invoices (data/freight/).
The learned skill is the human-written fixture tests/fixtures/freight_skill.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rehearse  # noqa: E402  reuse the harness: service, CLI approvals, console, arg handling
from rehearse import client, log  # noqa: E402

FREIGHT = rehearse.ROOT / "data" / "freight"
rehearse.SKILL = "freight-invoice-reconcile"
rehearse.FIXTURE = rehearse.ROOT / "tests" / "fixtures" / "freight_skill"


class FreightRehearsal(rehearse.Rehearsal):
    messages = []

    def say(self, who, text):
        """SIMULATED channel message. On the GB10 this is NemoClaw's Slack/Telegram channel, not this function."""
        m = {"ts": time.strftime("%H:%M:%S"), "channel": "SIMULATED", "from": who, "text": text}
        self.messages.append(m)
        with open(Path(self.a.db).parent / "messages.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(m) + "\n")
        log(f"  [{'employee' if who == 'employee' else 'agent   '} @ simulated channel] {text}")

    def _check_pos(self):
        """MOCK reasoning over the agent tools: what a model would have to work out from freight_invoice."""
        proposals, needs_person = [], []
        for rec in self.call("read_records")["records"]:
            inv = self.call("freight_invoice", {"record_id": rec["id"]})["invoices"]
            if not inv:
                continue
            if inv[0]["issues"]:
                needs_person.append((rec["id"], "; ".join(inv[0]["issues"])))
            elif round(inv[0]["lines_net"], 2) != rec["data"]["freight_accrued"]:
                proposals.append((rec, inv[0]))
        ids, changes = [], []
        for rec, inv in proposals:
            p = self.call("propose_action", {"record_id": rec["id"], "action_type": "set_field",
                                             "params": {"field": "freight_accrued", "value": inv["lines_net"]},
                                             "reason": f"carrier invoice {inv['header']['invoice_id']} net "
                                                       f"{inv['lines_net']:.2f} {inv['header']['currency']}"})
            if p.get("ok"):
                self.call("request_approval", {"action_id": p["action"]["id"]})
                ids.append(p["action"]["id"])
                changes.append(f"{rec['id']} freight_accrued {rec['data']['freight_accrued']:.2f} -> {inv['lines_net']:.2f}")
        return ids, changes, needs_person

    def _report(self, ids, verified, changes):
        ok = [v for v in verified if v["passed"]]
        if not ids or not verified:  # nothing applied is never "done and verified"
            self.say("agent", "No change was applied, so nothing was verified. A person should look at this request.")
            return
        self.say("agent", ("Done and independently verified: " + "; ".join(changes)) if len(ok) == len(ids) else
                 f"Verification FAILED for {[v['action_id'] for v in verified if not v['passed']]}: a person must "
                 "review; I did not retry.")

    def act_learn(self):
        log("ACT 1  employee reports a discrepancy; the (scripted) agent investigates; a person approves; verifier checks")
        self.host("reset", "--scenario", str(FREIGHT / "case_primary.json"))
        self.say("employee", "PO-7731's freight accrual doesn't match the Kestrel invoice. Can you check this week's POs?")
        tid = self.host("task", "begin", "Freight accrual check (reported: PO-7731)", "--mode", "mock")["task_id"]
        self.call("search_skills", {"query": "freight accrual carrier invoice"})
        ids, changes, _ = self._check_pos()
        self.say("agent", f"Found {len(ids)} discrepancy: {'; '.join(changes)}. Waiting for an authorized approver "
                          f"(action {ids}). I can't approve changes myself.")
        self.call("execute_action", {"action_id": ids[0]})  # acting before approval must be refused
        self.await_approvals(ids)
        verified = self.execute_and_verify(ids)
        self._report(ids, verified, changes)
        sk = self.call("propose_skill", {"name": rehearse.SKILL, "description": "MOCK-AUTHORED fixture: freight accrual "
                                         "= carrier invoice net, same currency only", "tags": ["freight", "mock"]},
                       files=client.draft_files(rehearse.FIXTURE))
        self.host("task", "end")
        if sk.get("status") == "tested":
            self.await_skill_promotion(sk["version"])
        return {"task_id": tid, "actions": ids, "verified": verified, "skill": {k: sk.get(k) for k in ("version", "status")}}

    def act_reuse(self):
        log("ACT 2  next week's POs: the approved skill proposes, a person approves, the verifier checks (no model)")
        self.host("reset", "--scenario", str(FREIGHT / "week2.json"))
        self.say("employee", "Weekly freight accrual check, please.")
        tid = self.host("task", "begin", "Freight accrual check, week 2", "--mode", "mock")["task_id"]
        hit = self.call("search_skills", {"query": "freight accrual carrier invoice"})
        best = next((h for h in hit.get("skills", []) if h.get("compatible")), None)
        run = self.call("run_skill", {"name": best["name"], "propose": True}) if best else {}
        ids = [x["id"] for x in run.get("actions", [])]
        changes = [f"{x['record_id']} freight_accrued -> {x['params']['value']:.2f}" for x in run.get("actions", [])]
        self.say("agent", f"Approved skill {run.get('skill')} proposed {len(ids)} change(s): {'; '.join(changes)}. "
                          f"Waiting for approval (action {ids}).")
        self.await_approvals(ids)
        verified = self.execute_and_verify(ids)
        self._report(ids, verified, changes)
        self.host("task", "end")
        return {"task_id": tid, "skill_used": run.get("skill"), "actions": ids, "verified": verified,
                "intervention": self.act_intervention()}

    def act_intervention(self):
        log("ACT 3  a case outside the approved rule: nothing is changed, a person is asked to decide")
        self.host("reset", "--scenario", str(FREIGHT / "case_incompatible.json"))
        self.say("employee", "PO-9902's accrual looks off against the cross-border invoice.")
        tid = self.host("task", "begin", "Freight accrual check (reported: PO-9902)", "--mode", "mock")["task_id"]
        hit = self.call("search_skills", {"query": "freight accrual carrier invoice"})
        best = next((h for h in hit.get("skills", []) if h.get("compatible")), None)
        run = self.call("run_skill", {"name": best["name"], "propose": True}) if best else {}
        ids, _, needs_person = self._check_pos() if not run.get("actions") else ([], [], [])
        self.say("agent", "I changed nothing. Needs a person: " + "; ".join(f"{r}: {why}" for r, why in needs_person)
                 + ". No approved rule covers this (e.g. currency conversion).")
        self.host("task", "end")
        return {"task_id": tid, "skill_proposals": len(run.get("proposals", [])), "actions": ids,
                "needs_person": needs_person}


if __name__ == "__main__":
    rehearse.Rehearsal = FreightRehearsal
    (rehearse.ROOT / "data" / "rehearsal").mkdir(parents=True, exist_ok=True)
    sys.exit(rehearse.main())
