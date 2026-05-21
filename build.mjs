// build.mjs — the orchestrator. The ONLY file that does I/O: it fetches
// Airtable, downloads photos, and writes the static site to dist/.
// Everything it computes is delegated to the pure functions in lib/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.mjs';
import { weekendWindow, localToday, localTime, formatLabel } from './lib/dates.mjs';
import { toPublicData } from './lib/project.mjs';
import { renderPage } from './lib/render.mjs';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const MAX_PAGES = 50; // pagination safety stop — 5000 records, far above the cap

// ---- Airtable fetch ----------------------------------------------------

async function fetchTable(fetchImpl, apiKey, baseId, table) {
  const records = [];
  let offset;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Airtable ${table} fetch failed: HTTP ${res.status} ${detail}`.trim(),
      );
    }
    const json = await res.json();
    records.push(...(json.records || []));
    offset = json.offset;
    if (!offset) break;
  }
  return records;
}

// ---- Record mapping ----------------------------------------------------

function mapBike(rec) {
  const f = rec.fields || {};
  const photo = Array.isArray(f.Photo) && f.Photo.length > 0 ? f.Photo[0] : null;
  return {
    id: rec.id,
    name: typeof f.Name === 'string' && f.Name.trim() ? f.Name.trim() : 'Unnamed bike',
    type: typeof f.Type === 'string' ? f.Type : '',
    engine: typeof f.Engine === 'string' ? f.Engine : '',
    price: typeof f['Price per day'] === 'number' ? f['Price per day'] : null,
    photoAttachment: photo,
    displayOrder: typeof f['Display order'] === 'number' ? f['Display order'] : 0,
    active: f.Active === true,
  };
}

function mapBooking(rec) {
  const f = rec.fields || {};
  const link = f.Bike;
  return {
    id: rec.id,
    bikeId: Array.isArray(link) && link.length > 0 ? link[0] : null,
    start: f.Start ?? null,
    end: f.End ?? null,
    // Read here, but deliberately never passed into the public model.
    renterNote: f['Renter note'] ?? null,
  };
}

// ---- Photos ------------------------------------------------------------

function extFor(attachment) {
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  if (attachment.type && byType[attachment.type]) return byType[attachment.type];
  const m = (attachment.filename || '').match(/(\.[a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '.jpg';
}

// Prefer Airtable's server-resized "large" thumbnail (~512px) so the page
// stays light; fall back to the original. Either way the bytes are saved
// locally — Airtable attachment URLs expire, the local copy does not.
function photoSourceUrl(attachment) {
  const large = attachment.thumbnails && attachment.thumbnails.large;
  return (large && large.url) || attachment.url;
}

// Download one bike's photo. A failure here NEVER fails the build — the
// bike falls back to the placeholder and a warning is recorded.
async function downloadPhoto(fetchImpl, bike, outDir, warnings) {
  const att = bike.photoAttachment;
  if (!att || !att.url) {
    warnings.push(`${bike.name}: no photo in Airtable — using the placeholder.`);
    return 'placeholder.svg';
  }
  try {
    const res = await fetchImpl(photoSourceUrl(att));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error('empty file');
    const filename = `photos/${bike.id}${extFor(att)}`;
    fs.writeFileSync(path.join(outDir, filename), bytes);
    return filename;
  } catch (err) {
    warnings.push(
      `${bike.name}: photo download failed (${err.message}) — using the placeholder.`,
    );
    return 'placeholder.svg';
  }
}

// ---- Build -------------------------------------------------------------

/**
 * Run a full build into `outDir`.
 *
 * @param apiKey     Airtable read token.
 * @param baseId     Airtable base ID.
 * @param outDir     directory to write the static site into (must exist).
 * @param rootDir    project root (holds the template, css, assets/).
 * @param fetchImpl  fetch implementation — injected by tests.
 * @param now        build instant — injected by tests.
 */
export async function runBuild({
  apiKey,
  baseId,
  outDir,
  rootDir,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  if (!apiKey || !baseId) throw new Error('apiKey and baseId are required');

  // 1. Fetch. A fetch failure throws — the build exits non-zero and the
  //    last successful deploy stays live.
  const bikeRecords = await fetchTable(fetchImpl, apiKey, baseId, config.airtable.bikesTable);
  const bookingRecords = await fetchTable(
    fetchImpl,
    apiKey,
    baseId,
    config.airtable.bookingsTable,
  );

  // Map; keep active bikes; sort for display.
  const bikes = bikeRecords
    .map(mapBike)
    .filter((b) => b.active)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  const bookings = bookingRecords.map(mapBooking);

  fs.mkdirSync(path.join(outDir, 'photos'), { recursive: true });

  // 2. Photos — one bad photo must never fail the build.
  const warnings = [];
  for (const bike of bikes) {
    bike.photo = await downloadPhoto(fetchImpl, bike, outDir, warnings);
  }

  // 4. Display window, in the business timezone.
  const weekends = weekendWindow(now, config.timezone, config.weekendCount);

  // 3, 5, 6, 7. Public model — validates bookings, computes free/busy and
  // the overlap/bad-data flags, and excludes every private field.
  const { bikes: publicBikes } = toPublicData(bikes, bookings, weekends);
  for (const b of publicBikes) {
    for (const w of b.warnings) warnings.push(`${b.name}: ${w}`);
  }

  const data = {
    generatedAt: now.toISOString(),
    timezone: config.timezone,
    bikes: publicBikes,
  };
  fs.writeFileSync(
    path.join(outDir, 'data.json'),
    JSON.stringify(data, null, 2) + '\n',
  );

  // 8. HTML.
  const template = fs.readFileSync(path.join(rootDir, 'index.template.html'), 'utf8');
  const updatedLabel =
    `${formatLabel(localToday(now, config.timezone))}, ` +
    `${localTime(now, config.timezone)}`;
  const html = renderPage(data, template, {
    businessName: config.businessName,
    tagline: config.tagline,
    contactPhone: config.contactPhone,
    footerNote: config.footerNote,
    updatedLabel,
  });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  // Static assets.
  fs.copyFileSync(path.join(rootDir, 'styles.css'), path.join(outDir, 'styles.css'));
  fs.copyFileSync(
    path.join(rootDir, 'assets', 'placeholder.svg'),
    path.join(outDir, 'placeholder.svg'),
  );
  // .nojekyll tells GitHub Pages to serve the output verbatim.
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

  return { data, html, warnings, bikeCount: bikes.length };
}

// ---- CLI entry ---------------------------------------------------------

function isMain() {
  return (
    Boolean(process.argv[1]) &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  );
}

if (isMain()) {
  const apiKey = process.env.AIRTABLE_TOKEN;
  const baseId = config.airtable.baseId;
  if (!apiKey) {
    console.error('ERROR: set the AIRTABLE_TOKEN environment variable.');
    process.exit(1);
  }
  if (!baseId || baseId.startsWith('appXXXX')) {
    console.error('ERROR: set airtable.baseId in config.mjs.');
    process.exit(1);
  }

  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(rootDir, 'dist');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  runBuild({ apiKey, baseId, outDir, rootDir })
    .then((result) => {
      console.log(`Built ${result.bikeCount} bike(s) -> ${outDir}`);
      if (result.warnings.length > 0) {
        console.warn(`\n${result.warnings.length} warning(s):`);
        for (const w of result.warnings) console.warn(`  - ${w}`);
      }
    })
    .catch((err) => {
      // Exit non-zero: the deploy step is skipped, last good deploy stays live.
      console.error(`\nBUILD FAILED: ${err.message}`);
      process.exit(1);
    });
}
