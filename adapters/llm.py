"""Local inference boundary: an OpenAI-compatible endpoint (vLLM / NIM / Ollama) or an explicit MOCK.

Env:
  LLM_BASE_URL  e.g. http://localhost:8000/v1   (unset or "mock" -> MockLLM)
  LLM_MODEL     model id served by the endpoint (default: first one from /models)
  LLM_API_KEY   optional; local servers usually ignore it
  LLM_TIMEOUT   seconds, default 30
"""
import json
import os
import time
import urllib.error
import urllib.request


class LLMUnavailable(Exception):
    pass


class MockLLM:
    """DETERMINISTIC MOCK. Not a model. Exists so dev/tests run without a GPU."""
    is_mock = True
    model = "MOCK (no inference)"

    def health(self):
        return {"ok": True, "mock": True, "model": self.model}

    def chat(self, messages, **_):
        return '{"mock": true, "note": "MockLLM returns a fixed reply; no reasoning happened"}'

    def chat_message(self, messages, **_):
        return {"role": "assistant", "content": self.chat(messages)}  # never a tool call: probes must fail


class OpenAICompatLLM:
    is_mock = False

    def __init__(self, base_url, model=None, api_key=None, timeout=30):
        self.base_url, self.model, self.api_key, self.timeout = base_url.rstrip("/"), model, api_key, timeout

    def _req(self, path, body=None):
        # opt-in: e.g. LLM_CHAT_TEMPLATE_KWARGS='{"enable_thinking": false}' for Qwen3.x served with thinking on by default
        if body and path == "/chat/completions" and os.environ.get("LLM_CHAT_TEMPLATE_KWARGS"):
            body = {**body, "chat_template_kwargs": json.loads(os.environ["LLM_CHAT_TEMPLATE_KWARGS"])}
        req = urllib.request.Request(self.base_url + path, data=json.dumps(body).encode() if body else None,
                                     headers={"Content-Type": "application/json",
                                              **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {})})
        retries = int(os.environ.get("LLM_RETRIES", 2))
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:  # 4xx = config problem (auth, model id): retrying won't help
                if e.code < 500 or attempt == retries:
                    raise LLMUnavailable(f"{self.base_url}{path}: HTTP {e.code}") from e
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
                if attempt == retries:  # bounded: transient errors escalate after LLM_RETRIES
                    raise LLMUnavailable(f"{self.base_url}{path}: {e} (after {attempt + 1} attempts)") from e
            time.sleep(min(2 ** attempt, 8))  # inference calls have no business side effects: safe to resend

    def health(self):
        models = [m["id"] for m in self._req("/models").get("data", [])]
        if self.model and self.model not in models:
            raise LLMUnavailable(f"model '{self.model}' not served; available: {models}")
        self.model = self.model or (models[0] if models else None)
        if not self.model:
            raise LLMUnavailable("endpoint serves no models")
        return {"ok": True, "mock": False, "model": self.model, "models": models}

    def chat(self, messages, temperature=0, max_tokens=2048):  # reasoning models (Lightning) need >=1024
        if not self.model:
            self.health()
        out = self._req("/chat/completions", {"model": self.model, "messages": messages,
                                              "temperature": temperature, "max_tokens": max_tokens})
        try:
            return out["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMUnavailable(f"malformed response: {str(out)[:200]}") from e

    def chat_message(self, messages, tools=None, temperature=0, max_tokens=2048):
        """Full assistant message (content, tool_calls, reasoning) using native OpenAI tool calling."""
        if not self.model:
            self.health()
        body = {"model": self.model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        if tools:
            body |= {"tools": tools, "tool_choice": "auto"}
        out = self._req("/chat/completions", body)
        try:
            return out["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as e:
            raise LLMUnavailable(f"malformed response: {str(out)[:200]}") from e


def from_env():
    url = os.environ.get("LLM_BASE_URL", "mock")
    if url == "mock":
        return MockLLM()
    return OpenAICompatLLM(url, os.environ.get("LLM_MODEL") or None, os.environ.get("LLM_API_KEY") or None,
                           float(os.environ.get("LLM_TIMEOUT", "30")))


def parse_json(text):
    """Pull the first JSON object out of model text (handles ```json fences / chatter). None if absent."""
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    break
        start = text.find("{", start + 1)
    return None


def smoke_test(llm):
    """Readiness: endpoint up, model answers, and can emit a parseable structured tool call."""
    info = llm.health()
    t0 = time.monotonic()
    reply = llm.chat([
        {"role": "system", "content": "Reply with only a JSON object, no prose."},
        {"role": "user", "content": 'Call tool "investigate" for record "REC-001". Format: {"tool": "...", "args": {"record_id": "..."}}'},
    ])
    elapsed = round(time.monotonic() - t0, 2)
    parsed = parse_json(reply)
    structured_ok = bool(parsed) and parsed.get("tool") == "investigate" and parsed.get("args", {}).get("record_id") == "REC-001"
    return {**info, "reply_preview": reply[:200], "structured_output_ok": structured_ok, "elapsed_s": elapsed}
