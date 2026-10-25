"""python3 -m unittest tests.test_structured_output   (no pytest needed)"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from adapters import llm
from experiments.oncall_infer import oncall

CODE = 'def run(d):\n    s = "{"  # unbalanced brace in a string\n    return {"a": s}\n'


class ParseJson(unittest.TestCase):
    def test_brace_inside_json_string_value(self):
        obj = {"skill_md": "# x", "helper": CODE, "tests": "def test_a():\n    pass\n"}
        self.assertEqual(llm.parse_json("Here:\n```json\n" + json.dumps(obj) + "\n```"), obj)

    def test_prose_brace_before_object(self):
        self.assertEqual(llm.parse_json('note {not json} then {"a": {"b": "}"}}'), {"a": {"b": "}"}})

    def test_inline_think_stripped_and_absent(self):
        self.assertEqual(llm.parse_json('<think>try {"a": 1}</think>\n{"a": 2}'), {"a": 2})
        self.assertIsNone(llm.parse_json("no json"))
        self.assertIsNone(llm.parse_json('{"a": "unterminated'))

    def test_reasoning_parser_content_is_plain_json(self):  # Nemotron: thinking is in message.reasoning, content is the answer
        self.assertEqual(llm.parse_json('{"a": 1}'), {"a": 1})


def resp(content, finish="stop", reasoning="thinking", toks=100):
    return {"choices": [{"finish_reason": finish, "message": {"content": content, "reasoning": reasoning}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": toks}}


class SynthLive(unittest.TestCase):
    def run_synth(self, responses):
        bodies, log = [], []

        def fake(self_, path, body=None):
            if path == "/models":
                return {"data": [{"id": "m"}]}
            bodies.append(body)
            return responses[len(bodies) - 1]
        with mock.patch.object(llm.OpenAICompatLLM, "_req", fake), tempfile.TemporaryDirectory() as d:
            try:
                oncall.synthesize_live("http://x/v1", "m", {}, Path(d) / "s", lambda e, t: log.append((e, t)), attempts=len(responses))
                err = None
            except llm.LLMUnavailable as e:
                err = e
        return bodies, log, err

    def test_length_truncation_is_audited_and_fed_back(self):
        bodies, log, err = self.run_synth([resp(None, "length"), resp(None, "length")])
        self.assertIsNotNone(err)
        self.assertIn("finish_reason=length", dict(log)["synthesis_response"])
        self.assertIn("cut off at the token limit", bodies[1]["messages"][0]["content"])

    def test_double_escaped_code_rejected_not_repaired(self):
        bad = json.dumps({"skill_md": "# s", "helper": "def run(d):\\n    return {}\\n", "tests": "def test_a():\\n    pass\\n"})
        bodies, log, err = self.run_synth([resp(bad), resp(bad)])
        self.assertIsNotNone(err)  # never written / run: nothing was transformed
        self.assertIn("escaped twice", bodies[1]["messages"][0]["content"])
        self.assertTrue(any(e == "synthesis_parse_failed" for e, _ in log))


if __name__ == "__main__":
    unittest.main()
