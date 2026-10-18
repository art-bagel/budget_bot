---
name: impl-review
description: Final review of an implemented task branch against its plan (AGENTS.md stage 5). Use when asked for «финальное ревью», implementation review, or when an author session hands you a plan file and a branch.
---

# Final implementation review (AGENTS.md, stage 5)

Input: the task report `docs/YYYY-MM-DD-*.md` (plan + what was done) and the
branch. Diff: `git diff origin/main...<branch>` (if the branch sits on an
unpushed local `main`, diff against `main` and say so).

## Steps

1. **Run checks**: full `scripts/check.sh` must be green. Report the summary
   lines, not «looks fine».
2. **`/code-review`** on the diff; **`/security-review`** when the diff
   touches auth, money, SQL functions, secrets, CI or the prod host.
3. **Acceptance criteria**: for every numbered criterion find the code and
   the test that proves it. A criterion without a test that would fail
   without the change is a finding.
4. **Callers and siblings**: for every changed function, SQL function,
   endpoint, CSS selector or component, grep all other users and check they
   still work. (2026-10-17: renaming `.hero__row dt/dd` broke the Credits
   hero, which nobody tested.)
5. **Tests are honest**: new tests fail on the old code (ask the author how
   they checked, or check yourself by reverting the fix locally); snapshots
   were regenerated on purpose and the PNGs look right; `KNOWN` in
   `a11y.spec.ts` only shrinks.
6. **Docs**: report sections (what was found, what was done, rollback, open
   questions, known risks); reference docs updated when behaviour changed
   (`docs/*.md` without a date, `DEVELOPMENT_GUIDELINES.md` for a rule from a
   bug, `docs/design-guide.md` for tokens/patterns); `docs/TODO.md`.
7. **Process**: one logical step per commit, English imperative messages, no
   `--no-verify` without a reason in the report, no secrets or real data in
   the diff.

## Output

Append `## Финальное ревью` to the report, in Russian:

- what was run (check.sh result, review tools);
- a table: criterion → ок / замечание → evidence (file, test);
- numbered findings marked **исправить**, **исправить (по желанию)** or
  **вопрос владельцу**;
- verdict: are there blockers.

Commit it. Do not fix code yourself (typos in docs are fine). After the
author's fixes, re-check only those fixes and append the result. Never push
or merge.
