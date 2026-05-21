import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate,
  addDays,
  dayOfWeek,
  formatLabel,
  localToday,
  localTime,
  weekendWindow,
} from '../lib/dates.mjs';

test('parseDate accepts plain and ISO date strings and Dates', () => {
  assert.equal(parseDate('2026-05-23'), '2026-05-23');
  assert.equal(parseDate('2026-05-23T00:00:00.000Z'), '2026-05-23');
  assert.equal(parseDate(new Date('2026-05-23T12:00:00Z')), '2026-05-23');
});

test('parseDate rejects missing or malformed values', () => {
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(undefined), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate('2026-13-01'), null); // no month 13
  assert.equal(parseDate('2026-02-30'), null); // Feb has no 30th
  assert.equal(parseDate(42), null);
});

test('addDays rolls across months and years, forwards and back', () => {
  assert.equal(addDays('2026-05-23', 1), '2026-05-24');
  assert.equal(addDays('2026-05-30', 2), '2026-06-01'); // month roll
  assert.equal(addDays('2026-12-31', 1), '2027-01-01'); // year roll
  assert.equal(addDays('2026-03-01', -1), '2026-02-28'); // backwards
});

test('dayOfWeek and formatLabel', () => {
  assert.equal(dayOfWeek('2026-05-23'), 6); // Saturday
  assert.equal(dayOfWeek('2026-05-24'), 0); // Sunday
  assert.equal(formatLabel('2026-05-23'), 'Sat 23 May');
  assert.equal(formatLabel('2027-01-01'), 'Fri 1 Jan');
});

test('localToday / localTime respect the timezone', () => {
  // 2026-05-20 06:30 UTC is still 2026-05-19 23:30 in Los Angeles.
  const instant = new Date('2026-05-20T06:30:00Z');
  assert.equal(localToday(instant, 'America/Los_Angeles'), '2026-05-19');
  assert.equal(localToday(instant, 'UTC'), '2026-05-20');
  assert.equal(localTime(instant, 'UTC'), '06:30');
});

test('weekendWindow from a weekday build date', () => {
  // Wed 2026-05-20 → first weekend is Sat 23 / Sun 24 May.
  const w = weekendWindow(new Date('2026-05-20T12:00:00Z'), 'UTC', 4);
  assert.equal(w.length, 4);
  assert.equal(w[0].days[0].date, '2026-05-23');
  assert.equal(w[0].days[1].date, '2026-05-24');
  assert.equal(w[0].days[0].label, 'Sat 23 May');
  assert.equal(w[3].days[1].date, '2026-06-14'); // 4th weekend's Sunday
});

test('weekendWindow on a Saturday build includes that day', () => {
  const w = weekendWindow(new Date('2026-05-23T12:00:00Z'), 'UTC', 4);
  assert.equal(w[0].days[0].date, '2026-05-23');
  assert.equal(w[0].days[1].date, '2026-05-24');
});

test('weekendWindow on a Sunday build still shows that weekend', () => {
  // Sun 2026-05-24 → its Saturday (the 23rd) is still the first day shown.
  const w = weekendWindow(new Date('2026-05-24T12:00:00Z'), 'UTC', 4);
  assert.equal(w[0].days[0].date, '2026-05-23');
  assert.equal(w[0].days[1].date, '2026-05-24');
});

test('weekendWindow crosses a month boundary', () => {
  // Wed 2026-05-27 → 30-31 May, then June.
  const w = weekendWindow(new Date('2026-05-27T12:00:00Z'), 'UTC', 4);
  assert.deepEqual(
    w.map((x) => x.days[0].date),
    ['2026-05-30', '2026-06-06', '2026-06-13', '2026-06-20'],
  );
});

test('weekendWindow crosses a year boundary', () => {
  // Wed 2026-12-23 → 26-27 Dec, then into January 2027.
  const w = weekendWindow(new Date('2026-12-23T12:00:00Z'), 'UTC', 4);
  assert.deepEqual(
    w.map((x) => x.days[0].date),
    ['2026-12-26', '2027-01-02', '2027-01-09', '2027-01-16'],
  );
  assert.equal(w[3].days[1].date, '2027-01-17');
});

test('weekendWindow stays correct across a DST transition', () => {
  // US spring-forward 2026 is Sun 8 March. A window opened in late
  // February spans it; the dates must stay consecutive Sat/Sun pairs.
  const w = weekendWindow(
    new Date('2026-02-25T12:00:00Z'),
    'America/Los_Angeles',
    4,
  );
  assert.deepEqual(
    w.map((x) => x.days[0].date),
    ['2026-02-28', '2026-03-07', '2026-03-14', '2026-03-21'],
  );
  assert.deepEqual(
    w.map((x) => x.days[1].date),
    ['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22'],
  );
  // 8 March (the DST day) survives intact as a Sunday.
  assert.equal(dayOfWeek('2026-03-08'), 0);
  assert.equal(formatLabel('2026-03-08'), 'Sun 8 Mar');
});
