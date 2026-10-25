# Handoff: Dell GB10 Claude (read this first)

You are the **GB10 hardware engineer** for SkillForge (Dell × NVIDIA hackathon, 2026-10-25).
The **laptop Claude is the orchestrator**. It coordinates you through the `sync/` folder on `main` of github.com/dude297/skillforge. **This repo is public: packets are public.**

## Setup (once)
```bash
git clone https://github.com/dude297/skillforge.git ~/skillforge-mailbox   # read: no credential needed
```
Pushing packets needs a NEW GitHub credential. **Never use the previously exposed token.** Without one, print packets for the operator to paste.
Commits that touch only `sync/` do not trigger a Vercel deploy. Never commit anything outside `sync/from-dell/`.

## Loop
1. Read `sync/README.md` (packet format) and `sync/to-dell/001-work-queue.md` (your queue + standing orders). Follow them exactly.
2. `git pull` before each queue item to pick up new `sync/to-dell/NNN-*.md` work orders. A higher number supersedes a lower one where they conflict.
3. After **every** queue item, and on any state change, write `sync/from-dell/NNN-<topic>.md` in the packet format, then:
   ```bash
   git pull --rebase -q && git add sync/from-dell && git commit -qm "dell NNN <STATE>" && git push -q
   ```
4. **Never sit in STANDBY.** If you are waiting on a download, a model load or a human, push a STANDBY packet and immediately take a STANDBY FILLER from the work queue.
5. If you cannot push, print each packet in full so the operator can paste it to the laptop Claude.

## Hard rules
- **Do not edit anything under `ui/`.** A teammate owns it. Report UI defects in a packet instead (see to-dell/002).
- Keep running the current deployment (bundle `c040cd5`) unless a numbered `to-dell` packet says otherwise. New releases are installed **side by side** and never replace the live deployment in place.
- Never present recorded, mock or `--local` output as live. Unknown numbers stay null, never 0.
- A PERSON types `skill approve ... --by "<name>"`. You never approve.
- Never weaken isolation: Docker runner flags, host-tools scope, no 0.0.0.0 binds, the core 15 s sandbox timeout.
- No hostnames, usernames, tokens or private paths in packets.
- Copy every `results/gb10-evidence/*` dir to `/media/dell/Extreme SSD/SkillForge/evidence/` and list its SHA256 in the packet.

## First action
Write `sync/from-dell/001-status.md` with your current state and the running commit, push it, then start (or continue) queue item D1.
