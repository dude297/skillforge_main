# GB10 live OnCall evidence (2026-10-25)

Run records from live synthesis on the Dell Pro Max GB10. Qwen3.6-35B-A3B-NVFP4 served locally by vLLM as `skillforge-qwen`, at GB10 commit `35d5820`.
They were relayed from the GB10 and sanitized by replacing only `host` with `<gb10-host>`. Each file is the canonical form
`json.dumps(obj, indent=1) + "\n"`, which reproduces the GB10-side sha256 exactly.

| File | Attempt | Result | sha256 (this file) | sha256 on the GB10 before sanitization |
|---|---|---|---|---|
| `attempt4-oncall-run.json` | 4 (thinking on, disclosed prompt revision) | hidden 9/9, regression 5/5, **passed**, staged for human approval | `712dbf7827e0f7c1bf16890d8efcb2758398bcfcd888eeb3766e12369f634b58` | `6683d26bbed1e0b8ce4d6f7508a309498da9c0b5aefbe8585e0b67769fec87a1` |
| `attempt5-oncall-run.json` | 5 (same config, repeatability) | hidden 8/9, **rejected**, never staged | `f95121b01f36373f43d06ccc377bc739987841b17576883db04879ee6a2ee01d` | `0448b065e6c7d0982f71e27c7920379a216198e9393674a1a907ae7578c90272` |
| `reuse-oncall-run.json` | reuse, `sf-gb10.sh reuse` at 2026-10-25T20:25:08Z, after a person approved the skill on the GB10 host CLI (name redacted to `<operator>`; not identity-verified) | INC-2 reused, **0 model calls**, 27.0 ms; INC-3 **refused** (incident fingerprint differs) | `029bb68463e95c4628ad3acf2dc96e34724155ae8aa3f06c17b796605b974260` | `1e32985ef4bffa612f5c36879ec1dbdbe9415d1badee85059f5f29eef84086d2` |

Attempts 1–3 (5/9, 7/9, and a lint failure; all rejected) and the GPU telemetry stay on the GB10/SSD evidence store.
`telemetry.note` "no GPU telemetry on this host" in these files is an old harness default. For attempt 5 the GB10 sampled
`gpu.csv` separately (util p50 96%, temp max 67 C, power max 44.0 W). For attempt 4 no telemetry was captured.

The reuse row is the first of 6 reuse trials (fresh processes, p50 28.2 ms, 0 model calls each, INC-3 refused each time); the other 5 are not committed. vLLM Prometheus counters were unchanged across the 5 extra trials (Qwen 44713 -> 44713, Nemotron 78758 -> 78758), so no request reached either model server. Latency is the reuse decision plus the sandboxed run in the subprocess runner (no Docker isolation). GB10-side only: `console.txt` sha256 `c0f70c5f042379aa9269c3b83ca4b2124074069ed95e2d796fd4b45beb2abcfc`; SSD `SHA256SUMS` (57 lines, 0 failures) sha256 `e40e446bdffa6c1d6a515da803cafc9953f6295a9364c36362d0881a3906895e`.

Verify: `sha256sum docs/evidence/gb10/*.json`
