// lib/availability.mjs — free/busy, overlap detection, booking validation.
// Pure functions. No I/O.
//
// 'YYYY-MM-DD' strings compare lexically in the same order as they compare
// chronologically, so plain <= / >= are correct date comparisons here.

import { parseDate } from './dates.mjs';

/**
 * Validate one raw booking (build logic step 3 — the malformed-data rule).
 *
 * @returns {{valid: true, start: string, end: string}}
 *          with normalised dates, or
 *          {{valid: false, reason: string}}
 *          with a short, renter-safe explanation.
 */
export function validateBooking(booking) {
  const start = parseDate(booking?.start);
  const end = parseDate(booking?.end);
  if (!start && !end) {
    return { valid: false, reason: 'a booking is missing its dates' };
  }
  if (!start) {
    return { valid: false, reason: 'a booking has a bad start date' };
  }
  if (!end) {
    return { valid: false, reason: 'a booking has a bad end date' };
  }
  if (end < start) {
    return { valid: false, reason: 'a booking ends before it starts' };
  }
  return { valid: true, start, end };
}

/**
 * Status of one day for one bike (build logic step 5).
 *
 * @param date           a 'YYYY-MM-DD' string.
 * @param validBookings  array of { start, end } — already validated.
 * @returns 'BOOKED' if the day falls inside any booking's inclusive
 *          interval, otherwise 'FREE'. Inclusive on both ends, so a
 *          long booking straddling the window edge marks its in-window
 *          days correctly.
 */
export function dayStatus(date, validBookings) {
  for (const b of validBookings) {
    if (b.start <= date && date <= b.end) return 'BOOKED';
  }
  return 'FREE';
}

/**
 * True if any two of the given valid bookings overlap (build logic
 * step 6). Bookings touching on a single inclusive day DO count as
 * overlapping — the same bike cannot be in two places that day.
 *
 * @param validBookings  array of { start, end } — already validated.
 */
export function hasOverlap(validBookings) {
  for (let i = 0; i < validBookings.length; i++) {
    for (let j = i + 1; j < validBookings.length; j++) {
      const a = validBookings[i];
      const b = validBookings[j];
      if (a.start <= b.end && b.start <= a.end) return true;
    }
  }
  return false;
}
