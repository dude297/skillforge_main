"""Independent-validation integrity regressions (plain unittest; pytest is not required):
  python3 -m unittest experiments.oncall_infer.test_verify_integrity
Approval here is typed by the test into a tmp registry, labelled 'unittest (not a human)'."""
import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

from app import db, skillforge as sf
from experiments.oncall_infer import oncall

ENV_KEYS = ("APP_DB", "HIDDEN_DIR", "LLM_RETRIES", "SKILL_RUNNER", "PATH")


class Base(unittest.TestCase):
    def setUp(self):
        self._env = {k: os.environ.get(k) for k in ENV_KEYS}
        self._skills = sf.SKILLS_DIR
        self.tmp = Path(tempfile.mkdtemp(prefix="oncall-verify-"))
        self.addCleanup(self._restore)

    def _restore(self):
        for k, v in self._env.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        sf.SKILLS_DIR = self._skills
        shutil.rmtree(self.tmp, ignore_errors=True)

    def staged(self):
        out = self.tmp / "run.json"
        doc = oncall.run(state=self.tmp / "state", out=out)
        return self.tmp / "state", out, doc

    def approve(self, state):
        conn = db.connect(str(state / "app.db"))
        sf.approve_skill(conn, oncall.NAME, 1, "unittest (not a human)")
        conn.close()


class HiddenCheckEmptySuite(Base):
    def test_zero_cases_is_not_a_pass(self):
        hd = self.tmp / "hid"
        hd.mkdir()
        (hd / "empty.py").write_text("SCENARIOS = ['zero']\ndef cases():\n    return []\n")
        os.environ["HIDDEN_DIR"] = str(hd)
        res = sf.hidden_check(oncall.REFERENCE, "zero", "{}")
        self.assertFalse(res["ok"])
        self.assertEqual(res["cases"], [])

    def test_verify_requires_nine_cases(self):
        real = sf.hidden_check
        sf.hidden_check = lambda *a, **k: {**real(*a, **k), "cases": real(*a, **k)["cases"][:8]}
        try:
            os.environ["HIDDEN_DIR"] = str(oncall.HIDDEN_DIR)
            ver, _ = oncall.verify(oncall.REFERENCE, {"records": [], "evidence": []}, "{}")
        finally:
            sf.hidden_check = real
        self.assertFalse(ver["passed"])
        self.assertTrue(any("at least 9" in x["name"] and not x["pass"] for x in ver["hidden"]))


class LintAliasing(Base):
    def _lint(self, helper):
        d = self.tmp / "s"
        shutil.copytree(oncall.REFERENCE, d)
        (d / "scripts" / "helper.py").write_text(helper)
        return sf.lint(d)[0]

    def test_alias_of_banned_builtin_rejected(self):
        self.assertTrue(self._lint("o = open\ndef run(d):\n    return {'proposals': [], 'x': o('/etc/hostname').read()}\n"))

    def test_attrgetter_rejected(self):
        self.assertTrue(self._lint("import operator\ndef run(d):\n    f = operator.attrgetter('__class__')\n"
                                   "    return {'proposals': []}\n"))

    def test_reference_skill_still_clean(self):
        self.assertEqual(sf.lint(oncall.REFERENCE)[0], [])


@unittest.skipUnless(os.name == "posix", "fake docker is a shell script")
class DockerRunnerFailsClosed(Base):
    def test_unusable_docker_never_falls_back_to_subprocess(self):
        bindir = self.tmp / "bin"
        bindir.mkdir()
        fake = bindir / "docker"
        fake.write_text("#!/bin/sh\necho 'permission denied while trying to connect to the docker API' >&2\nexit 1\n")
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        os.environ["SKILL_RUNNER"] = "docker"
        os.environ["PATH"] = f"{bindir}:{os.environ['PATH']}"
        r = sf.sandbox("test", oncall.REFERENCE, timeout=10)
        self.assertFalse(r["ok"])
        self.assertIn("runner crashed", r["error"])
        self.assertNotIn("tests_run", r)  # the subprocess runner would have returned test results


class StagingAndReuse(Base):
    def test_failing_candidate_is_never_registered(self):
        bad = self.tmp / "bad"
        shutil.copytree(oncall.REFERENCE, bad)
        (bad / "scripts" / "helper.py").write_text(
            "def run(dataset):\n    return {'proposals': [{'record_id': r['id'], 'field': 'max_num_seqs', 'value': 128,"
            " 'action_type': 'revert_config', 'reason': 'x'} for r in dataset['records']], 'refused': []}\n")
        real, oncall.REFERENCE = oncall.REFERENCE, bad
        try:
            state, out, doc = self.staged()
        finally:
            oncall.REFERENCE = real
        self.assertFalse(doc["verification"]["passed"])
        self.assertEqual(doc["approval"]["state"], "rejected")
        conn = db.connect(str(state / "app.db"))
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM skills").fetchone()[0], 0)
        conn.close()
        self.assertFalse((state / "skills").exists())
        self.assertEqual(oncall.reuse(state, out)["reuse"]["state"], "refused")

    def test_staged_hash_equals_verified_hash(self):
        state, _, doc = self.staged()
        conn = db.connect(str(state / "app.db"))
        row = conn.execute("SELECT status, sha256 FROM skills").fetchone()
        conn.close()
        self.assertEqual((row["status"], row["sha256"]), ("tested", doc["synthesis"]["skill_hash"]))

    def test_tampered_approved_skill_is_refused_and_recorded(self):
        state, out, _ = self.staged()
        self.approve(state)
        h = state / "skills" / "approved" / oncall.NAME / "v1" / "scripts" / "helper.py"
        h.write_text(h.read_text() + "\n# tampered\n")
        doc = oncall.reuse(state, out)  # must not raise
        self.assertEqual(doc["reuse"]["state"], "refused")
        self.assertIn("integrity_error", doc["reuse"]["reason"])
        self.assertIsNone(doc["reuse"]["diagnosis"])

    def test_approved_flag_without_hidden_validation_is_refused(self):
        state, out, _ = self.staged()
        conn = db.connect(str(state / "app.db"))
        conn.execute("UPDATE skills SET status='approved', active=1, decided_by='x'")
        conn.commit()
        conn.close()
        doc = oncall.reuse(state, out)
        self.assertEqual(doc["reuse"]["state"], "refused")
        self.assertEqual(doc["refusal"]["state"], "refused")

    def test_reuse_zero_model_calls_and_inc3_refused(self):
        state, out, _ = self.staged()
        self.approve(state)
        doc = oncall.reuse(state, out)
        self.assertEqual((doc["reuse"]["state"], doc["reuse"]["model_calls"]), ("done", 0))
        self.assertEqual(doc["refusal"]["state"], "refused")
        self.assertIn("fingerprint differs", doc["refusal"]["reason"])


class WipeGuard(Base):
    def test_foreign_directory_is_not_deleted(self):
        d = self.tmp / "precious"
        d.mkdir()
        (d / "notes.txt").write_text("keep")
        with self.assertRaises(ValueError):
            oncall.run(state=d, out=self.tmp / "o.json")
        self.assertEqual((d / "notes.txt").read_text(), "keep")

    def test_own_previous_state_is_wiped(self):
        state, out, _ = self.staged()
        oncall.run(state=state, out=out)  # second run over our own state dir is allowed


if __name__ == "__main__":
    unittest.main()
