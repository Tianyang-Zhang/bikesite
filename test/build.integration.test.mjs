import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../build.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

const bikesFixture = fs.readFileSync(path.join(FIXTURES, 'airtable.bikes.json'), 'utf8');
const bookingsFixture = fs.readFileSync(
  path.join(FIXTURES, 'airtable.bookings.json'),
  'utf8',
);

// A real 1x1 PNG — enough bytes to stand in for a downloaded photo.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const NOW = new Date('2026-05-20T16:05:00Z'); // a Wednesday

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function pngResponse() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(PNG_1x1).buffer,
  };
}

function notFound() {
  return {
    ok: false,
    status: 404,
    text: async () => 'not found',
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

// A fetch stub: routes Airtable table calls and photo URLs to fixtures.
function makeFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes('/Bikes')) return jsonResponse(bikesFixture);
    if (u.includes('/Bookings')) return jsonResponse(bookingsFixture);
    if (u.includes('airtable-cdn.test')) return pngResponse();
    return notFound();
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bikesite-'));
}

test('integration: a full build produces the page, data file, and assets', async () => {
  const outDir = tmpDir();
  try {
    const result = await runBuild({
      apiKey: 'test-key',
      baseId: 'appTest',
      outDir,
      rootDir: ROOT,
      fetchImpl: makeFetch(),
      now: NOW,
    });

    // Every expected file was written.
    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'data.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'styles.css')));
    assert.ok(fs.existsSync(path.join(outDir, 'placeholder.svg')));

    // Active bikes only; the retired bike is excluded.
    assert.equal(result.bikeCount, 3);
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(html, /Ducati Monster/);
    assert.match(html, /Royal Enfield Classic/);
    assert.match(html, /Honda CRF250L/);
    assert.equal(html.includes('Retired Scooter'), false);

    // The Ducati photo downloaded; the Honda (no photo) used the placeholder.
    assert.ok(fs.existsSync(path.join(outDir, 'photos', 'recDucati.png')));
    const data = JSON.parse(fs.readFileSync(path.join(outDir, 'data.json'), 'utf8'));
    const honda = data.bikes.find((b) => b.name === 'Honda CRF250L');
    assert.equal(honda.photo, 'placeholder.svg');

    // Booking math: the Ducati is BOOKED on Sun 24 May, FREE on Sat 23.
    const ducati = data.bikes.find((b) => b.name === 'Ducati Monster');
    const ducatiDays = ducati.weekends.flatMap((w) => w.days);
    assert.equal(ducatiDays.find((d) => d.date === '2026-05-24').status, 'BOOKED');
    assert.equal(ducatiDays.find((d) => d.date === '2026-05-23').status, 'FREE');

    // Overlap + bad-data warnings surfaced on the right bikes.
    const enfield = data.bikes.find((b) => b.name === 'Royal Enfield Classic');
    assert.ok(enfield.warnings.some((w) => /overlap/i.test(w)));
    assert.ok(honda.warnings.some((w) => /bad/i.test(w)));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('integration ★: no private renter data reaches the output', async () => {
  const outDir = tmpDir();
  try {
    await runBuild({
      apiKey: 'test-key',
      baseId: 'appTest',
      outDir,
      rootDir: ROOT,
      fetchImpl: makeFetch(),
      now: NOW,
    });
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    const json = fs.readFileSync(path.join(outDir, 'data.json'), 'utf8');
    for (const blob of [html, json]) {
      assert.equal(blob.includes('Renter note'), false);
      assert.equal(blob.includes('renterNote'), false);
      assert.equal(blob.includes('555-0142'), false);
      assert.equal(blob.includes('paid deposit'), false);
      assert.equal(blob.includes('Priya'), false);
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('integration: a fetch failure makes the build throw (non-zero exit)', async () => {
  const outDir = tmpDir();
  try {
    const failing = async (url) => {
      if (String(url).includes('/Bikes')) return notFound();
      return makeFetch()(url);
    };
    await assert.rejects(
      runBuild({
        apiKey: 'k',
        baseId: 'appTest',
        outDir,
        rootDir: ROOT,
        fetchImpl: failing,
        now: NOW,
      }),
      /fetch failed/,
    );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('integration: a failed photo download still yields a successful build', async () => {
  const outDir = tmpDir();
  try {
    const photosFail = async (url) => {
      const u = String(url);
      if (u.includes('airtable-cdn.test')) return notFound();
      return makeFetch()(u);
    };
    const result = await runBuild({
      apiKey: 'k',
      baseId: 'appTest',
      outDir,
      rootDir: ROOT,
      fetchImpl: photosFail,
      now: NOW,
    });
    const data = JSON.parse(fs.readFileSync(path.join(outDir, 'data.json'), 'utf8'));
    assert.ok(data.bikes.every((b) => b.photo === 'placeholder.svg'));
    assert.ok(result.warnings.some((w) => /placeholder/i.test(w)));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
