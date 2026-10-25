"""EXPERIMENT: the smallest contract from an inbound business message to SkillForge's EXISTING authority chain.
Not a messaging framework: no transport, no tokens, nothing is sent. A host-side adapter (NOT BUILT) would call
accept() when a message arrives and status() to build the reply. Whether NemoClaw/OpenClaw can hand inbound
messages and a sender id to the host is UNVERIFIED (inspect on the GB10), so `meta` is what such an adapter would
have to produce from channel-authenticated data, never from message text or the model.

  message -> accept(): trusted meta (channel, workspace, conversation, message_id, sender, assurance)
          -> router event (event_id = stable hash of channel/workspace/message_id; source from HOST config)
          -> approvals (host CLI, named person) -> execution -> verifier -> status(): reply + correlation chain
"""
import hashlib
import json

from app import db
from experiments.router import router

# Host-owned configuration: which channel workspaces exist and which conversation may raise which router source.
# ponytail: a dict; a config file when a second deployment needs different values.
CHANNELS = {("slack", "T0ACME"): {"#freight-ops": "freight-feed", "#records": "ops-fixture"}}
ACCEPTED = {"channel_verified", "allowlist_only"}  # "unverified" senders never reach the router
MESSAGE_KEYS = {"text", "ref"}  # untrusted: `ref` names a host-owned dataset and is validated by the router


def event_id(meta):
    return "msg-" + hashlib.sha256(f"{meta['channel']}|{meta['workspace']}|{meta['message_id']}".encode()).hexdigest()[:32]


def accept(conn, message, meta):
    """message: untrusted {text, ref}. meta: produced by the host adapter from channel-authenticated data."""
    source = CHANNELS.get((meta.get("channel"), meta.get("workspace")), {}).get(meta.get("conversation"))
    why = ("unknown channel, workspace or conversation" if source is None else
           "sender identity not established by the channel" if meta.get("assurance") not in ACCEPTED else
           "message must be exactly {text, ref}" if not isinstance(message, dict) or set(message) != MESSAGE_KEYS else
           "missing sender or message id" if not (meta.get("sender") and meta.get("message_id")) else None)
    if why:
        db.audit(conn, "channel", "inbound_refused", {"reason": why, "channel": str(meta.get("channel"))[:40]})
        return {"status": "refused", "reply": router.explain(None)}
    eid = event_id(meta)
    if not conn.execute("SELECT 1 FROM audit WHERE event='channel_inbound' AND json_extract(payload, '$.event_id')=?",
                        (eid,)).fetchone():  # attribution, recorded once per message; never an authorization
        db.audit(conn, "channel", "channel_inbound", {"event_id": eid, **{k: meta[k] for k in (
            "channel", "workspace", "conversation", "message_id", "sender", "assurance")}})
    ev = router.route(conn, {"event_id": eid, "source": source, "type": "reconcile.requested", "scenario": message["ref"]})
    return {"status": ev["status"], "correlation_id": eid, "reply": router.explain(ev)}


def status(conn, correlation_id):
    """Outbound: the reply plus the chain a reviewer can audit, from the authoritative tables only."""
    ev = router._row(conn, correlation_id)
    if not ev:
        return {"status": "unknown", "reply": "I have no record of that request."}
    inbound = conn.execute("SELECT payload FROM audit WHERE event='channel_inbound' AND json_extract(payload, "
                           "'$.event_id')=?", (correlation_id,)).fetchone()
    sender = json.loads(inbound["payload"])["sender"] if inbound else None
    chain = []
    for aid in ev["actions"]:
        ap = conn.execute("SELECT status, decided_by FROM approvals WHERE action_id=?", (aid,)).fetchone()
        ver = conn.execute("SELECT passed FROM verifications WHERE action_id=? ORDER BY id DESC LIMIT 1", (aid,)).fetchone()
        chain.append({"action_id": aid, "approval": ap and ap["status"], "approved_by": ap and ap["decided_by"],
                      "self_approved": bool(ap and sender and ap["decided_by"] == sender),
                      "executed": bool(conn.execute("SELECT 1 FROM executions WHERE action_id=?", (aid,)).fetchone()),
                      "verified": None if ver is None else bool(ver["passed"])})
    return {"status": ev["status"], "correlation_id": correlation_id, "requested_by": sender, "chain": chain,
            "reply": router.explain(ev)}
