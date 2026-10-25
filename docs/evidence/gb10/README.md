# GB10 live OnCall evidence (2026-10-25)

Run records from live synthesis on the Dell Pro Max GB10. Qwen3.6-35B-A3B-NVFP4 served locally by vLLM as `skillforge-qwen`, at GB10 commit `35d5820`.
They were relayed from the GB10 and sanitized by replacing only `host` with `<gb10-host>`. Each file is the canonical form
`json.dumps(obj, indent=1) + "\n"`, which reproduces the GB10-side sha256 exactly.

| File | Attempt | Result | sha256 (this file) | sha256 on the GB10 before sanitization |
|---|---|---|---|---|
| `attempt4-oncall-run.json` | 4 (thinking on, disclosed prompt revision) | hidden 9/9, regression 5/5, **passed**, staged for human approval | `712dbf7827e0f7c1bf16890d8efcb2758398bcfcd888eeb3766e12369f634b58` | `6683d26bbed1e0b8ce4d6f7508a309498da9c0b5aefbe8585e0b67769fec87a1` |
| `attempt5-oncall-run.json` | 5 (same config, repeatability) | hidden 8/9, **rejected**, never staged | `f95121b01f36373f43d06ccc377bc739987841b17576883db04879ee6a2ee01d` | `0448b065e6c7d0982f71e27c7920379a216198e9393674a1a907ae7578c90272` |

Attempts 1–3 (5/9, 7/9, and a lint failure; all rejected) and the GPU telemetry stay on the GB10/SSD evidence store.
`telemetry.note` "no GPU telemetry on this host" in these files is an old harness default. For attempt 5 the GB10 sampled
`gpu.csv` separately (util p50 96%, temp max 67 C, power max 44.0 W). For attempt 4 no telemetry was captured.

Verify: `sha256sum docs/evidence/gb10/*.json`
