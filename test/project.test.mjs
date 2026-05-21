import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicData } from '../lib/project.mjs';
import { weekendWindow } from '../lib/dates.mjs';

// First weekend in this window: Sat 2026-05-23 / Sun 2026-05-24.
const WEEKENDS = weekendWindow(new Date('2026-05-20T12:00:00Z'), 'UTC', 4);

function ducati(over = {}) {
  return {
    id: 'b1',
    name: 'Ducati Monster',
    type: 'Naked',
    engine: '937cc',
    price: 90,
    photo: 'photos/b1.jpg',
    ...over,
  };
}

test('★ CRITICAL: the renter note never reaches the public model', () => {
  const bookings = [
    {
      bikeId: 'b1',
      start: '2026-05-23',
      end: '2026-05-24',
      renterNote: 'SECRET-RENTER-PHONE-5551234',
    },
  ];
  const out = toPublicData([ducati()], bookings, WEEKENDS);
  const json = JSON.stringify(out);
  assert.equal(
    json.includes('SECRET-RENTER-PHONE-5551234'),
    false,
    'the private renter note value leaked into the public model',
  );
  assert.equal(json.includes('renterNote'), false);
  assert.equal(json.includes('Renter note'), false);
});

test('output shape: one entry per bike, per-day FREE/BOOKED status', () => {
  const bookings = [{ bikeId: 'b1', start: '2026-05-24', end: '2026-05-24' }];
  const out = toPublicData([ducati()], bookings, WEEKENDS);
  assert.equal(out.bikes.length, 1);
  const bike = out.bikes[0];
  assert.equal(bike.weekends.length, 4);
  assert.equal(bike.weekends[0].days[0].status, 'FREE'); // Sat 23
  assert.equal(bike.weekends[0].days[1].status, 'BOOKED'); // Sun 24
  assert.equal(bike.weekends[0].days[0].label, 'Sat 23 May');
});

test('a bike with no bookings shows every day FREE and no warnings', () => {
  const out = toPublicData([ducati()], [], WEEKENDS);
  const statuses = out.bikes[0].weekends.flatMap((w) =>
    w.days.map((d) => d.status),
  );
  assert.equal(statuses.length, 8);
  assert.ok(statuses.every((s) => s === 'FREE'));
  assert.deepEqual(out.bikes[0].warnings, []);
});

test('a malformed booking is dropped from the calc and its bike flagged', () => {
  const bookings = [{ bikeId: 'b1', start: '2026-05-23', end: 'not-a-date' }];
  const out = toPublicData([ducati()], bookings, WEEKENDS);
  // Dropped: Sat 23 May is still FREE despite the bad row.
  assert.equal(out.bikes[0].weekends[0].days[0].status, 'FREE');
  // ...but the bike carries a reason-bearing warning.
  assert.equal(out.bikes[0].warnings.length, 1);
  assert.match(out.bikes[0].warnings[0], /bad end date/i);
});

test('overlapping bookings raise an overlap warning', () => {
  const bookings = [
    { bikeId: 'b1', start: '2026-05-23', end: '2026-05-24' },
    { bikeId: 'b1', start: '2026-05-24', end: '2026-05-25' },
  ];
  const out = toPublicData([ducati()], bookings, WEEKENDS);
  assert.equal(out.bikes[0].warnings.length, 1);
  assert.match(out.bikes[0].warnings[0], /overlap/i);
});

test('bookings are matched to their own bike only', () => {
  const bikes = [
    ducati(),
    { id: 'b2', name: 'Enfield', type: 'Cruiser', engine: '349cc', price: 55, photo: 'p2' },
  ];
  const bookings = [{ bikeId: 'b2', start: '2026-05-23', end: '2026-05-24' }];
  const out = toPublicData(bikes, bookings, WEEKENDS);
  assert.equal(out.bikes[0].weekends[0].days[0].status, 'FREE'); // b1 untouched
  assert.equal(out.bikes[1].weekends[0].days[0].status, 'BOOKED'); // b2 booked
});

test('price is null when absent and preserved when present', () => {
  const bikes = [
    ducati({ price: 90 }),
    ducati({ id: 'b2', price: null }),
  ];
  const out = toPublicData(bikes, [], WEEKENDS);
  assert.equal(out.bikes[0].price, 90);
  assert.equal(out.bikes[1].price, null);
});

test('zero bikes yields an empty model', () => {
  assert.deepEqual(toPublicData([], [], WEEKENDS), { bikes: [] });
});
