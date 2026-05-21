// lib/render.mjs — turn the public model into the HTML page.
// Pure: public model + template string in, HTML string out. No I/O.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for safe insertion into HTML text or an attribute. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function formatPrice(price) {
  if (price == null || price === '') return '';
  const n = Number(price);
  if (Number.isNaN(n)) return '';
  const amount = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `$${amount}/day`;
}

function specLine(bike) {
  return [bike.type, bike.engine].filter(Boolean).join(' · ');
}

function smsHref(phone, bikeName) {
  const body = `Hi, is the ${bikeName} available this weekend?`;
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

function renderDay(day) {
  const free = day.status === 'FREE';
  const cls = free ? 'day day--free' : 'day day--booked';
  const mark = free ? '●' : '✕';
  const word = free ? 'Free' : 'Booked';
  return (
    `<li class="${cls}">` +
    `<span class="day__label">${escapeHtml(day.label)}</span>` +
    `<span class="day__status">` +
    `<span class="day__mark" aria-hidden="true">${mark}</span> ${word}` +
    `</span></li>`
  );
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) return '';
  const items = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  return (
    `<div class="bike__warn" role="status">` +
    `<span class="bike__warn-icon" aria-hidden="true">⚠</span>` +
    `<ul class="bike__warn-list">${items}</ul>` +
    `</div>`
  );
}

function renderBike(bike, opts) {
  const price = formatPrice(bike.price);
  const spec = specLine(bike);
  const days = bike.weekends.flatMap((w) => w.days).map(renderDay).join('');
  return `<article class="bike">
  <div class="bike__photo-wrap">
    <img class="bike__photo" src="${escapeHtml(bike.photo)}" alt="${escapeHtml(bike.name)}" loading="lazy" width="800" height="500">
  </div>
  <div class="bike__body">
    <div class="bike__head">
      <h2 class="bike__name">${escapeHtml(bike.name)}</h2>
      ${price ? `<span class="bike__price">${escapeHtml(price)}</span>` : ''}
    </div>
    ${spec ? `<p class="bike__spec">${escapeHtml(spec)}</p>` : ''}
    <ul class="days">${days}</ul>
    ${renderWarnings(bike.warnings)}
    ${opts.contactPhone ? `<a class="bike__cta" href="${escapeHtml(smsHref(opts.contactPhone, bike.name))}">Text to book this bike</a>` : ''}
  </div>
</article>`;
}

/**
 * Render the whole page.
 *
 * @param data      { generatedAt, bikes } — toPublicData output + timestamp.
 * @param template  the index.template.html contents.
 * @param opts      { businessName, tagline, contactPhone, footerNote,
 *                    updatedLabel }.
 * @returns the full HTML document string.
 */
export function renderPage(data, template, opts) {
  const bikes = data.bikes ?? [];
  const body =
    bikes.length === 0
      ? '<p class="empty">Fleet list coming soon.</p>'
      : bikes.map((b) => renderBike(b, opts)).join('\n');

  // Function-form replacements: the values are inserted literally, with no
  // special treatment of `$` sequences (prices contain `$`).
  return template
    .replaceAll('{{TITLE}}', () => escapeHtml(opts.businessName))
    .replaceAll('{{TAGLINE}}', () => escapeHtml(opts.tagline))
    .replaceAll('{{UPDATED}}', () => escapeHtml(opts.updatedLabel))
    .replaceAll('{{FOOTER}}', () => escapeHtml(opts.footerNote))
    .replaceAll('{{BIKES}}', () => body);
}
