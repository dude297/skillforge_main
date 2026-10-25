# SkillForge World: three-person comprehension test (script)

**Status: NOT RUN YET. No participant feedback exists.** The results table below is empty on purpose. Fill it in only from real sessions.

## Setup

- **Participants:** 3, non-technical, who have never seen SkillForge. Recruit people like the judges: business-minded, not engineers.
- **Build:** `exp/world`, served by `npm run preview`, Edge at 1440×900. One session also on a phone if possible.
- **Duration:** 10 minutes each, think-aloud.
- **Moderator's rules:**
  - Don't explain anything, and answer questions only with "what do you think?"
  - Record answers in your own words.
- **Data:** no names, no recording; participant codes P1–P3 only.

## Script

1. **Five-second test.** Open `#/world`. After 5 s, cover the screen.
   - Ask: "What is this product for?"
   - Ask: "Who or what is the little character?"
2. **Story.** "Scroll at your own pace until the end of the story." Then ask, with no going back:
   - **Q1:** Who does the work of investigating the problem?
   - **Q2:** Can the AI change the data on its own? What has to happen first?
   - **Q3:** What does the gate in the middle do?
   - **Q4:** What does a green block on the library shelf mean?
   - **Q5:** Why is the second problem handled faster?
3. **Evidence.** In "Watch a real run": "Find out who approved the first change." Success means they open the review desk or step to the approval event.
4. **Provenance.** "Is what you just watched real, or an illustration? How can you tell?" Success means they mention the "Recorded run" tag or the mock-agent note.
5. **Hand-off.** "Open the same task in the operator console." Success means they use a "Replay task N in the console" link and land in History with "Recorded run" shown.
6. **Close.** "One thing that confused you? One thing you'd tell a colleague about it?"

## Session kit (moderator, before each participant)

```bash
git checkout exp/world && cd ui && npm ci --offline && npm run build && npm run preview   # http://127.0.0.1:4173 (npm ci only once)
npx playwright test e2e/world-truth.spec.ts -g "usability script"   # the UI still matches this script (fails if it drifted)
```

- **Between participants:** close the tab and open `http://127.0.0.1:4173/#/world` fresh (the page keeps no state). Scroll to the top.
- **Browser:** Edge at 100 % zoom, 1440×900 window, OS reduced motion **off** unless the participant uses it. Note it if they do.
- **Read aloud (consent):** "We're testing the page, not you. There are no wrong answers. We won't record your name, voice or screen; I'll only write short notes. You can stop at any time."
- **Timing:** start a stopwatch at each task prompt and stop it at success or at 90 s (then say "let's move on" and mark it as not completed).
- **Notes:** write what they *said* (quotes) and *did* (clicks). Don't write your interpretation in the quote column.

### Printable answer sheet (one per participant)

```
Participant: P__   Date: ____   Device: desktop / phone   Reduced motion: yes / no

5-s purpose: ____________________________________________   correct? Y / N
Ember is:    ____________________________________________   correct? Y / N
Q1 who investigates: ____________________________________   Y / N
Q2 can AI change data alone? ____________________________   Y / N
Q3 the gate does: _______________________________________   Y / N
Q4 green block means: ___________________________________   Y / N
Q5 why faster: __________________________________________   Y / N
Task 3 (who approved): done Y / N   time ___ s   path: desk popover / stepping / other
Task 4 (real or illustration?): answer ________ cue used: tag / note / other    correct? Y / N
Task 5 (open in console): done Y / N   time ___ s   landed on Recorded History? Y / N
Confused by (quote): ____________________________________
Would tell a colleague (quote): _________________________
```

**After three sessions:** fill in the results table above **only from these sheets** and keep the sheets. Don't change the UI until all three sessions are done, so every participant sees the same build.

## Scoring (per participant)

| | correct = a reasonable paraphrase of |
|---|---|
| 5-s purpose | an AI that fixes data problems, with people approving, and learns |
| Q1 | Ember / the AI agent |
| Q2 | no; a person must approve first |
| Q3 | checks the change / the skill independently |
| Q4 | a skill that passed its checks and a person approved |
| Q5 | it reuses a learned skill, with no model needed |
| Task 4 | "a recording of a real run of the system" (real backend events; the agent in it was scripted, per the note), **not** the illustration. Saying "it's all fake" or "it's live right now" is incorrect |
| Tasks 3–5 | completed without help, and in how many seconds |

## Results (empty until real sessions are run)

| | P1 | P2 | P3 |
|---|---|---|---|
| 5-s purpose | | | |
| Q1–Q5 correct | | | |
| Task 3 (s) | | | |
| Task 4 | | | |
| Task 5 (s) | | | |
| Quote: confused by | | | |

**Pass bar:**
- at least 2 of 3 participants get Q2, Q3 and Q5 right
- Task 4 is answered correctly by everyone

If Task 4 fails for anyone, provenance labelling is the first thing to change.
