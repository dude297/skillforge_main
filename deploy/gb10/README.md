# SkillForge on the GB10

The procedure (build the bundle, transfer, preflight, live OnCall, known risks, rollback) is in
[docs/GB10_SETUP.md](../../docs/GB10_SETUP.md#portable-bundle-path). The deep runbook is
[docs/GB10_RUNBOOK.md](../../docs/GB10_RUNBOOK.md).

```bash
bash deploy/gb10/make_bundle.sh          # dev box: build the bundle
bash deploy/gb10/sf-gb10.sh preflight    # GB10: read-only checks; must PASS before `oncall`
```
