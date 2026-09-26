# Field tests

Every real project built with Ultimate Frontend Skills is also a test of it.
When a project shows something UFS got wrong, left out, or said badly, the
lesson comes back here as a dated record, the fix goes into UFS, and a check
goes into the test suite so the same thing cannot quietly come back.

Gev's rule, 2026-09-24: "if you see anything that UFS did wrong or need to
improve on, fix it first, then work on the game." A fix made only in the
project leaves the next project to repeat it.

## Records

| Record | Project | Dates | Lessons |
|---|---|---|---|
| [doodle-voyager.md](doodle-voyager.md) | Doodle Voyager, a first-person doodle space shooter (D:/doodle-voyager, doodle-voyager.vercel.app) | 2026-09-22 to 2026-09-26 | 30 |
| [gev-hq.md](gev-hq.md) | HQ, a key-gated shared dashboard with a shader and PBR Lab (D:/gev-hq, gev-hq.vercel.app) | 2026-09-23 to 2026-09-24 | 11 |

## The method

1. **Build the project with UFS, and keep the evidence.** The project's own
   git log, TODO list, test logs and docs are the record of what happened.
   Keep the owner's reviews word for word: Gev's nine-point critique of HQ and
   his seventeen-item review of Doodle Voyager after playing it (DV-14 to
   DV-28) are the most useful things in these records, and neither was
   findable by any check. His instruction on the second one, 2026-09-25: "Put
   everything that im saying that you did wrong to be recorderd and see how
   you can improve UFS off that and teach other claudes from other people."
   A lesson that stops at the record teaches nobody, so every one of them also
   ships as a numbered rule in a reference, and a test fails if the two drift
   apart.
2. **Mine it when the project pauses, not from memory.** Read the project's
   git log and docs; grep (never read whole) the session transcripts for
   `UFS`, `ultimate-frontend`, `games.md`, `webdesign` and the owner's review
   messages; read what the building session wrote about UFS at the time
   (for Doodle Voyager, the `ufsLessons` in its build report).
3. **Write one lesson per mistake, in five parts.** Each lesson is a
   `### <ID>. <title>` heading (`DV-3`, `HQ-8`; the ID never changes once
   written) followed by five bold-labelled paragraphs:
   - **What happened.** The project's own facts: file, commit, symptom, date.
   - **What UFS said or did.** Quote the reference or the tool output. Say
     "nothing" when UFS had nothing; that is usually the lesson.
   - **What it should have said or done.** The behaviour, stated so someone
     could check it.
   - **The UFS fix.** What changed in UFS: the reference section (written as
     `references/<file>.md`, section "<heading text>" so the suite can find
     it), the script, the audit rule, the commit.
   - **Regression check.** Either the test that holds it, written exactly as
     `test/<file>.test.mjs`, "<exact test title>", or a line that starts
     "Not testable:" (or "Not testable automatically:") and says why.
4. **Fix UFS before the project.** References for judgement, scripts and
   audit rules for anything a machine can see. Prefer a rule that runs on the
   real project's files: every new check here was run on the project's own
   before-and-after code, not only on a made-up fixture.
5. **Prove the check would have caught it.** Run the new test against the
   UFS code from before the fix and watch it fail for the reason in the
   record. A check that passes on the old code is not a regression check.
6. **Commit the record, the fix and the check together**, and run the whole
   suite (`npm test`).

## What holds the records to this

`test/field-tests.test.mjs` fails the suite when:

- a record has fewer than five lessons, or a lesson lacks one of the five
  parts, or two lessons share an ID;
- a regression check names a test file or test title that does not exist
  (so renaming a test without updating its record fails loudly);
- a regression check neither names a test nor starts with "Not testable";
- a fix names a reference section that is not a heading in that file.

The same file carries the browser regressions from these two projects that
had no better home: a game title screen in fixed layers, a squeezed date
field, a key screen typed through, and the exported `CANVAS_INIT`.

## Adding the next project

Copy the shape of `gev-hq.md`: a short header (what the project is, where it
lives, the UFS version it was built with, the sources the record was mined
from), then the lessons, oldest first. Add a row to the table above. The
suite picks up any new `.md` file in this folder.
