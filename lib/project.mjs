// lib/project.mjs — project raw fleet data into the public page model.
// Pure. No I/O.
//
// THIS IS THE PRIVACY CHOKEPOINT. The public model is built field by field
// below — the raw booking objects (which carry `renterNote`) are read only
// for their dates and never spread or copied wholesale. A private field can
// reach the page only if someone adds it to this file by hand. The
// ★CRITICAL test in test/project.test.mjs guards exactly that.

import { validateBooking, dayStatus, hasOverlap } from './availability.mjs';

function tidy(reason) {
  return reason.charAt(0).toUpperCase() + reason.slice(1) + ' — fix in Airtable.';
}

/**
 * Build the public page model (build logic steps 3, 5, 6, 7).
 *
 * @param bikes     [{ id, name, type, engine, price, photo }] — already
 *                  filtered to active and sorted for display.
 * @param bookings  [{ bikeId, start, end, renterNote }] — raw. `renterNote`
 *                  is deliberately read NOWHERE in this function.
 * @param weekends  output of weekendWindow().
 * @returns {{ bikes: Array }} — a fresh, public-fields-only model.
 */
export function toPublicData(bikes, bookings, weekends) {
  const publicBikes = bikes.map((bike) => {
    const own = bookings.filter((b) => b.bikeId === bike.id);
    const checked = own.map(validateBooking);
    const valid = checked.filter((c) => c.valid); // { valid, start, end }

    // Warnings drive the ⚠ marker — overlaps first, then bad rows.
    const warnings = [];
    if (hasOverlap(valid)) {
      warnings.push('Overlapping bookings on this bike — fix in Airtable.');
    }
    for (const c of checked) {
      if (!c.valid) warnings.push(tidy(c.reason));
    }

    const weekendsOut = weekends.map((w) => ({
      index: w.index,
      days: w.days.map((d) => ({
        date: d.date,
        label: d.label,
        status: dayStatus(d.date, valid),
      })),
    }));

    // Explicit, public-only construction — no spread of `bike`, no `id`.
    return {
      name: bike.name,
      type: bike.type ?? '',
      engine: bike.engine ?? '',
      price: bike.price ?? null,
      photo: bike.photo,
      weekends: weekendsOut,
      warnings: [...new Set(warnings)],
    };
  });

  return { bikes: publicBikes };
}
