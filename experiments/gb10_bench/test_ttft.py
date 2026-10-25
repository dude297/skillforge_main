"""Offline: a fake OpenAI-compatible streaming server on 127.0.0.1. Plumbing only, not a measurement."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from experiments.gb10_bench import ttft


class Fake(BaseHTTPRequestHandler):
    usage = True

    def log_message(self, *a):
        pass

    def do_GET(self):
        body = json.dumps({"data": [{"id": "fake-model"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert req["stream"] is True and req["model"] == "fake-model"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        send = lambda obj: (self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode()), self.wfile.flush())
        send({"choices": [{"delta": {"role": "assistant"}}]})  # role-only chunk: not a token
        time.sleep(0.05)
        send({"choices": [{"delta": {"reasoning_content": "hm"}}]})
        for w in ("1", " 2", " 3"):
            time.sleep(0.02)
            send({"choices": [{"delta": {"content": w}}]})
        if Fake.usage:
            send({"choices": [], "usage": {"prompt_tokens": 9, "completion_tokens": 4}})
        self.wfile.write(b"data: [DONE]\n\n")


def test_probe_against_fake_stream():
    srv = HTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/v1"
    try:
        res = ttft.run(url, n=3, warmup=1, label="FAKE SERVER")
        assert res["model"] == "fake-model" and res["errors"] == 0
        t = res["trials"][0]
        assert 0.04 < t["first_token_s"] < t["e2e_s"] and t["completion_tokens"] == 4 and t["decode_tok_s"] > 0
        Fake.usage = False  # server without usage -> token metrics unknown (None), never 0
        t = ttft.probe(url, "fake-model")
        assert t["completion_tokens"] is None and t["decode_tok_s"] is None and t["first_token_s"] is not None
        assert ttft.probe("http://127.0.0.1:9/v1", "x", timeout=2)["error"]  # unreachable -> error, no numbers
    finally:
        Fake.usage = True
        srv.shutdown()
