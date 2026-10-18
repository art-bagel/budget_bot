---
name: plan-review
description: Review a task plan in docs/YYYY-MM-DD-*.md before implementation (AGENTS.md stage 2, level L). Use when asked to review a plan, «ревью плана», or when an author session hands you a plan file without chat context.
---

# Plan review (AGENTS.md, stage 2)

You get only the plan file and the repository. No chat history: if something
needed to judge the plan is not in the file, that is a finding.

## Read first

- the plan file you were given;
- `AGENTS.md` (process), `BUSINESS_LOGIC.md`, `DATA_MODEL.dbml`,
  `DEVELOPMENT_GUIDELINES.md`;
- the code the plan names: open every file, function and table it touches,
  and grep for other callers of what it changes.

## Checklist

1. **Required sections** (AGENTS.md «План — один файл»): goal and what is
   out of scope; numbered, checkable acceptance criteria; which test proves
   which criterion; affected areas, migrations, rollback; for UI — screens,
   states, reused components; questions to the owner.
2. **Matches the docs**: domain rules in `BUSINESS_LOGIC.md`, schema in
   `DATA_MODEL.dbml`, the rules in `DEVELOPMENT_GUIDELINES.md`. Quote the rule
   the plan breaks.
3. **Callers and siblings**: every place that uses what the plan changes
   (SQL function, router, CSS class, component) is listed. A change in one
   screen that silently changes another is a finding.
4. **Edge cases**: empty data, zero and negative amounts, rounding, other
   currencies, family vs personal, concurrent requests, repeated requests
   (idempotency), cancelled/archived entities.
5. **Security**: authorization on every new endpoint or SQL function
   (`_user_id` scoping), no secrets in code/args/logs, prod writes only with
   the owner's approval.
6. **Money and DB**: failing test first; migration is forward-only and safe
   on the live DB; rollback is real (not just `git revert` if data changes).
7. **Simpler option**: is there a smaller change that meets the goal? Say
   which and what it gives up.
8. **Tests**: each criterion has a runnable test; UI tests use only the
   synthetic seed (`scripts/seed_ui_test.py`).

## Output

Append to the plan file a section `## Ревью плана` in Russian:

- what was read and checked;
- numbered findings, each marked **исправить** or **вопрос владельцу**, with
  file/line or doc reference;
- a one-line verdict.

Commit it on the task branch. One round; a second only if the plan was
substantially rewritten. Do not change the plan's own sections and do not
write code.
