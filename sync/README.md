# SkillForge sync mailbox (Windows laptop ⇄ Dell GB10)

Text-only handoff channel. No code, no models, no secrets, no evidence blobs (put those on the SSD; record their SHA256 here).

```
to-dell/NNN-<topic>.md      laptop -> Dell: work orders, release notices
from-dell/NNN-<topic>.md    Dell -> laptop: status packets (DONE / STANDBY / BLOCKED / PROGRESS)
```

Numbering is per direction and only increases. Never edit a packet after pushing it; send a new one.

## Packet header (every packet)
```
SYNC PACKET <dir>-<NNN>
Origin: Windows laptop | Dell GB10
UTC: 2026-10-25T..Z
State: DONE | STANDBY | BLOCKED | PROGRESS
Running commit (GB10): <hash>  (the hardware source of truth)
Branch/commit referenced: <branch> @ <hash>
What changed:
Artifacts (path : sha256):
Tests / measured evidence (exact command -> result):
Important failures (verbatim error, first lines):
Dell must restart/replace anything? NO | YES: <exactly what>
Next command for the other machine:
```

## Dell: how to report
```bash
cd ~/skillforge-mailbox            # first time: git clone https://github.com/dude297/skillforge.git ~/skillforge-mailbox
git pull -q
$EDITOR sync/from-dell/NNN-<topic>.md   # fill the header above; PUBLIC repo: no hostnames, usernames, tokens, private paths
git pull --rebase -q && git add sync/from-dell && git commit -qm "dell NNN <state>" && git push -q
```
If the Dell cannot push, print the packet and the operator pastes it into the laptop Claude session.
