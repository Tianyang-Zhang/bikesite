import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBooking, dayStatus, hasOverlap } from '../lib/availability.mjs';

// ---- validateBooking ---------------------------------------------------

test('validateBooking accepts a well-formed multi-day row', () => {
  const r = validateBooking({ start: '2026-05-23', end: '2026-05-24' });
  assert.deepEqual(r, { valid: true, start: '2026-05-23', end: '2026-05-24' });
});

test('validateBooking accepts a single-day booking', () => {
  const r = validateBooking({ start: '2026-05-23', end: '2026-05-23' });
  assert.equal(r.valid, true);
});

test('validateBooking rejects missing dates', () => {
  assert.equal(validateBooking({ start: null, end: null }).valid, false);
  assert.equal(validateBooking({}).valid, false);
});

test('validateBooking rejects an unparseable start or end', () => {
  assert.match(validateBooking({ start: 'soon', end: '2026-05-24' }).reason, /start/);
  assert.match(validateBooking({ start: '2026-05-23', end: 'whenever' }).reason, /end/);
});

test('validateBooking rejects end before start', () => {
  const r = validateBooking({ start: '2026-05-24', end: '2026-05-23' });
  assert.equal(r.valid, false);
  assert.match(r.reason, /before/);
});

// ---- dayStatus ---------------------------------------------------------

test('dayStatus returns FREE when there are no bookings', () => {
  assert.equal(dayStatus('2026-05-23', []), 'FREE');
});

test('dayStatus returns BOOKED only inside the inclusive interval', () => {
  const b = [{ start: '2026-05-22', end: '2026-05-25' }];
  assert.equal(dayStatus('2026-05-22', b), 'BOOKED'); // first day
  assert.equal(dayStatus('2026-05-23', b), 'BOOKED'); // middle
  assert.equal(dayStatus('2026-05-25', b), 'BOOKED'); // last day
  assert.equal(dayStatus('2026-05-21', b), 'FREE'); // day before
  assert.equal(dayStatus('2026-05-26', b), 'FREE'); // day after
});

test('dayStatus handles a single-day booking', () => {
  const b = [{ start: '2026-05-23', end: '2026-05-23' }];
  assert.equal(dayStatus('2026-05-23', b), 'BOOKED');
  assert.equal(dayStatus('2026-05-24', b), 'FREE');
});

test('dayStatus handles a booking straddling the window edge', () => {
  // Starts before the window, ends on its first day.
  const b = [{ start: '2026-05-18', end: '2026-05-23' }];
  assert.equal(dayStatus('2026-05-23', b), 'BOOKED');
  assert.equal(dayStatus('2026-05-24', b), 'FREE');
});

test('dayStatus handles a multi-week booking', () => {
  const b = [{ start: '2026-05-01', end: '2026-06-30' }];
  assert.equal(dayStatus('2026-05-23', b), 'BOOKED');
  assert.equal(dayStatus('2026-06-14', b), 'BOOKED');
});

// ---- hasOverlap --------------------------------------------------------

test('hasOverlap is false for zero or one booking', () => {
  assert.equal(hasOverlap([]), false);
  assert.equal(hasOverlap([{ start: '2026-05-23', end: '2026-05-24' }]), false);
});

test('hasOverlap counts bookings touching on one inclusive day', () => {
  const b = [
    { start: '2026-05-20', end: '2026-05-23' },
    { start: '2026-05-23', end: '2026-05-25' },
  ];
  assert.equal(hasOverlap(b), true);
});

test('hasOverlap detects a genuine overlap', () => {
  const b = [
    { start: '2026-05-20', end: '2026-05-25' },
    { start: '2026-05-22', end: '2026-05-23' },
  ];
  assert.equal(hasOverlap(b), true);
});

test('hasOverlap is false for adjacent, non-touching bookings', () => {
  const b = [
    { start: '2026-05-20', end: '2026-05-22' },
    { start: '2026-05-23', end: '2026-05-25' },
  ];
  assert.equal(hasOverlap(b), false);
});

test('hasOverlap finds the overlapping pair among three bookings', () => {
  const b = [
    { start: '2026-05-01', end: '2026-05-02' },
    { start: '2026-05-23', end: '2026-05-24' },
    { start: '2026-05-24', end: '2026-05-25' }, // overlaps the second
  ];
  assert.equal(hasOverlap(b), true);
});
