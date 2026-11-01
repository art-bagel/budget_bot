import assert from 'node:assert/strict';
import test from 'node:test';
import { isoDate } from '../src/utils/format.ts';
import { todayIso } from '../src/utils/portfolioPosition.ts';

// CI runs in UTC, where local and UTC dates match: pin a zone east of Greenwich,
// where toISOString() falls on the previous day until 03:00.
function inMoscow(check: () => void) {
  const savedZone = process.env.TZ;
  process.env.TZ = 'Europe/Moscow';
  try {
    check();
  } finally {
    if (savedZone === undefined) delete process.env.TZ;
    else process.env.TZ = savedZone;
  }
}

test('today is the local calendar date, not the UTC one', () => {
  inMoscow(() => {
    const justAfterMidnight = new Date(2026, 10, 1, 0, 30);
    assert.equal(justAfterMidnight.toISOString().slice(0, 10), '2026-10-31', 'still Oct 31 in UTC');
    assert.equal(isoDate(justAfterMidnight), '2026-11-01');
    assert.equal(todayIso(justAfterMidnight), '2026-11-01', 'the copy used by the crypto sheets');
  });
});

test('period bounds built from local dates keep their day', () => {
  inMoscow(() => {
    // Quarter IV as Portfolio builds it: new Date(year, month, 1) .. new Date(year, month + 3, 0).
    assert.equal(isoDate(new Date(2026, 9, 1)), '2026-10-01');
    assert.equal(isoDate(new Date(2026, 12, 0)), '2026-12-31');
  });
});
