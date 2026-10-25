"""EXPERIMENT: read-only GET /ui/demo/oncall for the operator console (same auth/host check as every /ui route).
Serves the latest local run (data/unified/demo/oncall-run.json) if present, else the committed RECORDED artifact."""
import json
import re

from app import db, ui_api

LIVE = db.ROOT / "data" / "unified" / "demo" / "oncall-run.json"
RECORDED = db.ROOT / "ui" / "public" / "demo" / "oncall-run.recorded.json"


def _oncall(_conn, _m, _q):
    for p in (LIVE, RECORDED):
        if p.is_file():
            return {**json.loads(p.read_text(encoding="utf-8")), "served_from": p.relative_to(db.ROOT).as_posix()}
    raise ui_api.ApiError(404, "not_found", "no OnCall run yet: python -m experiments.oncall_infer run")


ROUTES = [(re.compile(r"^/ui/demo/oncall$"), _oncall)]


def install():
    for r in ROUTES:
        if all(r[0].pattern != p.pattern for p, _ in ui_api.ROUTES):
            ui_api.ROUTES.append(r)
