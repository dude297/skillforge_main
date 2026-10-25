SYNC PACKET to-dell-002
Origin: Windows laptop
UTC: 2026-10-25
State: PROGRESS
Running commit (GB10): keep c040cd5 running. This packet does not require a restart.
Branch/commit referenced: release/integration @ 2dca477 (laptop release branch; delivered as a bundle)

## 1. STANDING RULE: do not touch `ui/`
A teammate now owns `ui/`. **Do not edit anything under `ui/`** on the GB10: no source, config or screenshot changes, and no rebuilding `ui/dist` to "fix" something.
- If you see a UI defect during D5 or a rehearsal, write it in a `from-dell` packet (screen, route, steps, what you expected). The laptop routes it to the teammate.
- Running the console (`sf-gb10.sh demo`) and viewing it is fine.

## 2. New bundle available (optional, side-by-side, after your current item)
`skillforge-gb10-2dca477.tar.gz`
sha256 `01180194049325749ab4fe16f90e547e5f3128c5e5e2ad50310d8ec51831fbe8`
The operator copies it to `/media/dell/Extreme SSD/SkillForge/bundles/`. If it isn't there yet, skip this section and carry on with the queue.

What it adds over c040cd5:
- `oncall.py`: a failed strict `--live` run no longer wipes the previous registry state; it is restored. A tampered approved skill is now a recorded refusal instead of a crash at `reuse`.
- 35 offline reliability tests (`experiments/oncall_infer/test_reliability.py`).
- `experiments/gb10_bench/evidence_report.py`: turns your evidence dirs into the judge report, with provenance and SHA256 for every number. It rejects mock input, and missing values print as "not measured".
- `docs/EVIDENCE_PROTOCOL.md` (first-time LLM vs deterministic reuse procedure), `docs/SYNC_PACKET.md` (side-by-side install and rollback).
- UI copy: "faster"/"milliseconds" claims removed. Built into `ui/dist`; you don't edit it.

Install **side by side only**. Never inside `~/skillforge-live`:
```bash
mkdir -p ~/skillforge-next && cd ~/skillforge-next
cp "/media/dell/Extreme SSD/SkillForge/bundles/skillforge-gb10-2dca477.tar.gz"* .
sha256sum -c skillforge-gb10-2dca477.tar.gz.sha256        # must say OK, else stop and report
mkdir src && tar -xzf skillforge-gb10-2dca477.tar.gz -C src && cd src
cat COMMIT                                                # must print 2dca477
bash deploy/gb10/sf-gb10.sh preflight                     # read-only
python3 -m pytest -q -p no:cacheprovider tests/test_contracts.py tests/test_bakeoff.py experiments/oncall_infer
```
Report the results in a packet. **Do not switch** the live deployment yet. The switch happens only on a later numbered packet, following docs/SYNC_PACKET.md §4, with a rollback dir kept.

## 3. Evidence report (once D2–D4 have real evidence)
From `~/skillforge-next/src`, point it at your evidence dirs (read-only on them):
```bash
python3 -m experiments.gb10_bench.evidence_report <evidence-dir> [<dir2> <dir3>] --out /media/dell/Extreme\ SSD/SkillForge/evidence/evidence_report.md
```
If it exits 2, the input was flagged as mock or non-GB10. Report that verbatim and don't use `--allow-mock` to bypass it. Send the report's SHA256 and its summary table in a packet.

Next command for Dell: finish your current queue item, `git pull` this mailbox, then do section 2 if the bundle is on the SSD.
