import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, escapeHtml } from '../lib/render.mjs';

// A compact stand-in template — the real index.template.html is exercised
// end-to-end by the build integration test.
const TEMPLATE =
  '<!doctype html><title>{{TITLE}}</title>' +
  '<p id="tag">{{TAGLINE}}</p><p id="up">{{UPDATED}}</p>' +
  '<main>{{BIKES}}</main><footer>{{FOOTER}}</footer>';

const OPTS = {
  businessName: 'Weekend Bike Rentals',
  tagline: 'Tap a bike, then text to book.',
  contactPhone: '+15551234567',
  footerNote: 'Pickup at the shop.',
  updatedLabel: 'Wed 20 May, 09:05',
};

function bike(over = {}) {
  return {
    name: 'Ducati Monster',
    type: 'Naked',
    engine: '937cc',
    price: 90,
    photo: 'photos/b1.jpg',
    weekends: [
      {
        index: 0,
        days: [
          { date: '2026-05-23', label: 'Sat 23 May', status: 'FREE' },
          { date: '2026-05-24', label: 'Sun 24 May', status: 'BOOKED' },
        ],
      },
    ],
    warnings: [],
    ...over,
  };
}

test('escapeHtml neutralises HTML metacharacters', () => {
  assert.equal(
    escapeHtml('<script>"&\'</script>'),
    '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
  );
});

test('zero bikes renders the empty state', () => {
  const html = renderPage({ bikes: [] }, TEMPLATE, OPTS);
  assert.match(html, /Fleet list coming soon/);
});

test('the build timestamp is rendered', () => {
  const html = renderPage({ bikes: [bike()] }, TEMPLATE, OPTS);
  assert.match(html, /Wed 20 May, 09:05/);
});

test('a free day and a booked day render distinctly', () => {
  const html = renderPage({ bikes: [bike()] }, TEMPLATE, OPTS);
  assert.match(html, /day--free/);
  assert.match(html, /day--booked/);
  assert.match(html, /Sat 23 May/);
  assert.match(html, /Booked/);
});

test('zero bookings renders every day free', () => {
  const allFree = bike({
    weekends: [
      {
        index: 0,
        days: [
          { date: '2026-05-23', label: 'Sat 23 May', status: 'FREE' },
          { date: '2026-05-24', label: 'Sun 24 May', status: 'FREE' },
        ],
      },
    ],
  });
  const html = renderPage({ bikes: [allFree] }, TEMPLATE, OPTS);
  assert.equal(/day--booked/.test(html), false);
  assert.equal((html.match(/day--free/g) || []).length, 2);
});

test('price is shown when present and omitted when absent', () => {
  const withPrice = renderPage({ bikes: [bike({ price: 90 })] }, TEMPLATE, OPTS);
  assert.match(withPrice, /\$90\/day/);
  const noPrice = renderPage({ bikes: [bike({ price: null })] }, TEMPLATE, OPTS);
  assert.equal(noPrice.includes('/day'), false);
});

test('an overlap warning renders with the warning marker', () => {
  const b = bike({
    warnings: ['Overlapping bookings on this bike — fix in Airtable.'],
  });
  const html = renderPage({ bikes: [b] }, TEMPLATE, OPTS);
  assert.match(html, /⚠/);
  assert.match(html, /Overlapping bookings/);
  assert.match(html, /bike__warn/);
});

test('a bad-data warning renders its reason', () => {
  const b = bike({
    warnings: ['A booking has a bad end date — fix in Airtable.'],
  });
  const html = renderPage({ bikes: [b] }, TEMPLATE, OPTS);
  assert.match(html, /bad end date/);
  assert.match(html, /⚠/);
});

test('a bike with no photo uses the placeholder image', () => {
  const html = renderPage({ bikes: [bike({ photo: 'placeholder.svg' })] }, TEMPLATE, OPTS);
  assert.match(html, /src="placeholder\.svg"/);
});

test('the text-to-book link targets the configured phone', () => {
  const html = renderPage({ bikes: [bike()] }, TEMPLATE, OPTS);
  assert.match(html, /sms:\+15551234567/);
});

test('no text-to-book link is rendered when the phone is empty', () => {
  const html = renderPage({ bikes: [bike()] }, TEMPLATE, { ...OPTS, contactPhone: '' });
  assert.equal(html.includes('bike__cta'), false);
  assert.equal(html.includes('Text to book'), false);
});

test('bike data is HTML-escaped', () => {
  const html = renderPage(
    { bikes: [bike({ name: 'Ducati <Monster> & "Co"' })] },
    TEMPLATE,
    OPTS,
  );
  assert.equal(html.includes('<Monster>'), false);
  assert.match(html, /Ducati &lt;Monster&gt;/);
});
