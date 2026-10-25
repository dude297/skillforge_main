"""SQLite persistence: schema, connection, audit, scenario loading."""
import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "app.db"
DEFAULT_SCENARIO = ROOT / "data" / "scenario.json"

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,            -- JSON object
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id),
  source TEXT NOT NULL,
  data TEXT NOT NULL,            -- JSON object: field -> value as seen by that source
  trusted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS investigations (
  id INTEGER PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id),
  findings TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id),
  type TEXT NOT NULL,
  params TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',  -- proposed|pending_approval|approved|rejected|executed|failed
  idempotency_key TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL DEFAULT 'agent',     -- 'agent' or 'skill:<name>@<version>#<run_id>'
  task_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY,
  action_id INTEGER NOT NULL UNIQUE REFERENCES actions(id),
  status TEXT NOT NULL DEFAULT 'pending',   -- pending|approved|rejected
  decided_by TEXT,
  note TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS executions (
  id INTEGER PRIMARY KEY,
  action_id INTEGER NOT NULL UNIQUE REFERENCES actions(id),  -- UNIQUE = execute at most once
  before TEXT NOT NULL,
  after TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY,
  action_id INTEGER NOT NULL REFERENCES actions(id),
  passed INTEGER NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Below: experience + skill registry. These SURVIVE scenario resets (that's the point of learning).
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  scenario TEXT,
  mode TEXT NOT NULL,                 -- real (local model) | mock (scripted) | deterministic (skill, no model/agent); never mix in one report row
  status TEXT NOT NULL DEFAULT 'open',
  input_snapshot TEXT NOT NULL,       -- dataset at task start; replayed to test generated skills
  metrics_start TEXT,                 -- inference counter snapshot, if reachable
  started_at REAL NOT NULL,
  ended_at REAL,
  latency_s REAL,
  model_calls INTEGER,                -- NULL = not measured
  tool_calls INTEGER,
  actions_executed INTEGER,
  verifications_passed INTEGER,
  verifications_failed INTEGER,
  invariant_violations INTEGER,
  success INTEGER,
  skills_used TEXT,
  skill_proposed TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id),
  tool TEXT NOT NULL,
  ok INTEGER NOT NULL,
  ms REAL NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL,
  status TEXT NOT NULL,               -- failed_tests | tested | approved | rejected | disabled | rolled_back
  active INTEGER NOT NULL DEFAULT 0,  -- at most one active version per name
  source_task INTEGER REFERENCES tasks(id),
  input_shape TEXT NOT NULL,          -- system-computed data signature; run_skill refuses other shapes
  sha256 TEXT NOT NULL,
  validation TEXT NOT NULL,
  decided_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, version)
);
CREATE TABLE IF NOT EXISTS skill_runs (
  id INTEGER PRIMARY KEY,
  skill_id INTEGER NOT NULL REFERENCES skills(id),
  task_id INTEGER REFERENCES tasks(id),
  status TEXT NOT NULL,               -- ok | error | refused
  proposals INTEGER NOT NULL DEFAULT 0,
  verified_pass INTEGER NOT NULL DEFAULT 0,
  verified_fail INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS skill_benchmarks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, version INTEGER NOT NULL, size INTEGER NOT NULL, records INTEGER NOT NULL,
  trials INTEGER NOT NULL, correct INTEGER NOT NULL,
  cold_median_ms REAL, cold_mad_ms REAL,      -- whole child process, interpreter start included
  first_call_ms REAL,                         -- first run() in a fresh process
  warm_median_ms REAL, warm_mad_ms REAL,      -- later run() calls, same process
  work_line_events INTEGER,                   -- deterministic work measure (traced line executions)
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Columns added after the first release. ALTER is idempotent here so existing DBs upgrade in place.
MIGRATIONS = [
    ("tool_calls", "args_hash", "TEXT"), ("tool_calls", "queries", "INTEGER"), ("tool_calls", "resp_bytes", "INTEGER"),
    ("tasks", "duplicate_tool_calls", "INTEGER"), ("tasks", "db_queries", "INTEGER"), ("tasks", "data_bytes", "INTEGER"),
    ("tasks", "tool_breakdown", "TEXT"), ("tasks", "phase_marks", "TEXT"),
    ("skills", "parent_version", "INTEGER"), ("skills", "profile", "TEXT"), ("skills", "optimization", "TEXT"),
    ("skills", "hidden_validation", "TEXT"),
    ("tasks", "signature", "TEXT"), ("skills", "signature", "TEXT"), ("skills", "touches", "TEXT"),
    ("tasks", "inference", "TEXT"), ("tasks", "model", "TEXT"),
]
SCHEMA_VERSION = 2  # bump with every MIGRATIONS change (v1 = pre-versioning databases, user_version 0)


def connect(path=None):
    path = path or os.environ.get("APP_DB", DEFAULT_DB)
    conn = sqlite3.connect(path, isolation_level=None)  # autocommit; use explicit BEGIN for multi-step writes
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    # WAL: the host service, bench and operator CLI share this file; readers never block the single writer.
    # Skip for ':memory:' and keep going if the filesystem refuses WAL (it falls back to the rollback journal).
    if str(path) != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        conn.close()
        raise RuntimeError(f"{path} has schema v{version}, newer than this code (v{SCHEMA_VERSION}); "
                           "use the matching code or restore a backup (python -m app db restore)")
    conn.executescript(SCHEMA)
    if version < SCHEMA_VERSION:
        conn.execute("BEGIN IMMEDIATE")  # all-or-nothing upgrade: a failed migration leaves the old schema intact
        try:
            for table, col, typ in MIGRATIONS:
                if col not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    return conn


def audit(conn, actor, event, payload):
    conn.execute("INSERT INTO audit (actor, event, payload) VALUES (?, ?, ?)",
                 (actor, event, json.dumps(payload, sort_keys=True)))


def load_scenario(conn, scenario_path=None):
    """Wipe the domain tables and load a scenario file. Repeatable: same file -> same state.
    Audit, tasks and the skill registry are kept: they are the system's memory."""
    scenario = json.loads(Path(scenario_path or DEFAULT_SCENARIO).read_text(encoding="utf-8"))
    if conn.execute("SELECT 1 FROM tasks WHERE status='open'").fetchone():
        raise RuntimeError("a task is open; run `python -m app task end` before resetting")
    conn.execute("BEGIN")
    for t in ("verifications", "executions", "approvals", "actions", "investigations", "evidence", "records", "meta"):
        conn.execute(f"DELETE FROM {t}")
    for r in scenario["records"]:
        conn.execute("INSERT INTO records (id, kind, data) VALUES (?, ?, ?)", (r["id"], r["kind"], json.dumps(r["data"])))
    for e in scenario["evidence"]:
        conn.execute("INSERT INTO evidence (record_id, source, data, trusted) VALUES (?, ?, ?, ?)",
                     (e["record_id"], e["source"], json.dumps(e["data"]), int(e.get("trusted", False))))
    conn.execute("INSERT INTO meta (key, value) VALUES ('policy', ?)", (json.dumps(scenario["policy"]),))
    conn.execute("INSERT INTO meta (key, value) VALUES ('scenario', ?)", (scenario["name"],))
    audit(conn, "system", "reset", {"scenario": scenario["name"]})
    conn.execute("COMMIT")
    return scenario
