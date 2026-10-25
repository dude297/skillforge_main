"""python -m experiments.bootstrap_lite [--port 8766]: the operator console (`python -m app ui`) + Bootstrap Lite routes."""
import argparse

from app import ui_api
from experiments.bootstrap_lite import lite

p = argparse.ArgumentParser()
p.add_argument("--port", type=int, default=8766)
a = p.parse_args()
lite.install()
ui_api.serve("127.0.0.1", a.port)
