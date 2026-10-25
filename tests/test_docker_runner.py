"""SKILL_RUNNER=docker end to end; run with pytest (python -m pytest tests/test_docker_runner.py). Skipped unless docker and the runner image are usable (GB10/Linux)."""
import os
import shutil
import subprocess

import pytest

from app import skillforge as sf
from experiments.oncall_infer import oncall


def _docker_ok():
    if not shutil.which("docker"):
        return False
    r = subprocess.run(["docker", "image", "inspect", "python:3.12-slim"], capture_output=True)
    return r.returncode == 0


@pytest.mark.skipif(not _docker_ok(), reason="docker or python:3.12-slim not available")
def test_reference_skill_runs_in_docker(monkeypatch):
    monkeypatch.setenv("SKILL_RUNNER", "docker")
    r = sf.sandbox("test", oncall.REFERENCE, timeout=60)
    assert r["ok"], r
    assert r.get("tests_run", 0) >= 1
