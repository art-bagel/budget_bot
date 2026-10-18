---
name: ui-review
description: Design review of an implemented UI change in the browser (AGENTS.md UI/UX track, step 2). Use when asked for «дизайн-ревью», UI review, or after an author finished a task that changes the interface, before the final review.
---

# Design review (AGENTS.md, UI/UX track step 2)

Runs after the author and before the final review, never in parallel with
it. You fix visual issues yourself; logic issues go back to the author.

## Setup

- Read the report `docs/YYYY-MM-DD-*.md` and `docs/design-guide.md`.
- Only synthetic data: the stand from `scripts/browser-tests.sh` (throwaway
  `postgres:17`, `scripts/seed_ui_test.py`). Never the dev DB copied from
  prod: real balances must not reach screenshots or git.
- Viewport 390×844, light and dark theme. Also check 375px for long amounts
  and names.

## Checklist

1. **Before/after screenshots** of every changed screen and sheet, both
   themes. Compare with the report's own before/after.
2. **Every screen that shares the change**: grep the changed classes and
   components and open each screen that uses them, not only the one in the
   task.
3. **Design guide**: tokens instead of raw colors (no new hex outside
   `:root`/`[data-theme]`), existing patterns (`BottomSheet`, `.sh-btn`,
   `.field`/`.fl`, `.amt`, `.op-row`), spacing and type scale from the guide.
4. **States**: empty, loading, error, long amounts and names, family vs
   personal where relevant.
5. **Themes**: dark values exist both under `[data-theme="dark"]` and the
   `prefers-color-scheme` block.
6. **Accessibility**: axe (`frontend/browser-tests/a11y.spec.ts`), keyboard
   (Tab stays inside a sheet, Escape closes the top sheet, focus returns to
   the opener), visible `:focus-visible`, text contrast ≥ 4.5:1, real
   `<button>` for actions.
7. **Texts**: Russian, short verbs on buttons, consequence in confirm
   questions, «…» not «...», no internal ids or English labels
   (design-guide §8).
8. **Safe area and width**: nothing under the Telegram header or the home
   indicator; works at 375–430px.

## Fixing

- Visual fixes (CSS, markup, texts, the guide) — do them, one commit per fix.
- Snapshots changed by your fix: regenerate (`--update-snapshots=all` for a
  token change, the default threshold misses soft color shifts) and look at
  the PNGs before committing.
- Full `scripts/check.sh` green at the end.

## Output

Append `## Дизайн-ревью` to the report, in Russian: what was checked (with
screenshot names), what was fixed (commits), what goes back to the author.
Screenshots of synthetic data may go to `docs/assets/<report-name>/`.
