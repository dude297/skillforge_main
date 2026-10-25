# oncall-serving-config-revert

RECORDED REFERENCE: written by hand (by an agent) for the demo, not model output. A `--live` run replaces it with
a skill the served model wrote.

Diagnoses a vLLM-style serving incident from trusted evidence (`log`, `config_before`, `config_after`, `deploy`):
- GPU OOM in the engine log and exactly one memory-relevant key (`max_num_seqs`, `max_model_len`,
  `gpu_memory_utilization`) changed by the deploy: propose `revert_config` of that key to its baseline value.
- No OOM: `not_applicable`. OOM with zero or several such changes: `requires_review`. Missing config: `insufficient_evidence`.

It only computes a proposal. Nothing is applied; a person approves every change.
