// BikeSite v2 — public booking page.
//
// Responsibilities:
//   * load the bikes + the contact-free availability view (anon SELECT, RLS-fenced)
//   * render a bike card per bike + a date picker / booking form modal
//   * insert bookings via Supabase (no_overlap and the public INSERT CHECKs do the validation)
//   * stay live: when *anyone* books, every open page refreshes availability
//     (we use Realtime BROADCAST, not postgres_changes, because the anon role
//     intentionally has no SELECT on `bookings` — so postgres_changes events
//     would be filtered out by RLS. Broadcast has no RLS check; it's pub/sub.)

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- DOM ---
const $ = (id) => document.getElementById(id);
const bikesEl       = $('bikes');
const loadingEl     = $('loading');
const emptyEl       = $('empty');
const loadErrorEl   = $('load-error');
const modal         = $('booking-modal');
const form          = $('booking-form');
const modalBikeName = $('modal-bike-name');
const messageEl     = $('booking-message');
const cancelBtn     = $('booking-cancel');
const submitBtn     = $('booking-submit');
const toastEl       = $('toast');

// --- state ---
let bikes        = [];      // [{id, name, type, engine, price_per_day, photo_url, ...}]
let availability = [];      // [{bike_id, start_date, end_date}]
let selectedBike = null;

// --- live channel (broadcast — no RLS gating) ---
const liveChannel = supabase.channel('availability-changes', {
  config: { broadcast: { self: false } },
});
liveChannel
  .on('broadcast', { event: 'changed' }, async () => {
    await reloadAvailability();
    await applySettings();
    render();
  })
  .subscribe();

// --- boot ---
cancelBtn.addEventListener('click', () => modal.close());
form.addEventListener('submit', handleSubmit);
applySettings();   // fire-and-forget — replaces hardcoded title/tagline once loaded
reloadAll();

// Pull the site name + tagline from site_settings and apply them to the page.
// Falls back silently to the hardcoded HTML if the table isn't reachable.
async function applySettings() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('site_name, tagline')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return;
  document.title = data.site_name;
  const h1 = document.querySelector('header h1');
  const tag = document.querySelector('header .tagline');
  if (h1)  h1.textContent  = data.site_name;
  if (tag) tag.textContent = data.tagline || '';
}

// --- loaders ---
async function reloadAll() {
  const [bikesRes, availRes] = await Promise.all([
    supabase.from('bikes').select('*').eq('active', true).order('display_order', { ascending: true }).order('id'),
    supabase.from('availability').select('*'),
  ]);
  loadingEl.hidden = true;

  if (bikesRes.error) {
    showLoadError('Could not load bikes: ' + bikesRes.error.message);
    return;
  }
  if (availRes.error) {
    showLoadError('Could not load availability: ' + availRes.error.message);
    return;
  }

  bikes        = bikesRes.data || [];
  availability = availRes.data || [];
  render();
}

async function reloadAvailability() {
  const { data, error } = await supabase.from('availability').select('*');
  if (!error) availability = data || [];
}

// --- render ---
function render() {
  loadErrorEl.hidden = true;
  if (bikes.length === 0) {
    emptyEl.hidden = false;
    bikesEl.innerHTML = '';
    return;
  }
  emptyEl.hidden = true;
  bikesEl.innerHTML = bikes.map(bikeCard).join('');
  bikesEl.querySelectorAll('[data-book]').forEach((btn) => {
    btn.addEventListener('click', () => openBooking(Number(btn.dataset.book)));
  });
}

function bikeCard(bike) {
  const taken = availability
    .filter((a) => a.bike_id === bike.id)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const photo = bike.photo_url
    ? `<img src="${esc(bike.photo_url)}" alt="${esc(bike.name)}" loading="lazy">`
    : '<div class="photo-placeholder">No photo yet</div>';

  const meta = [bike.type, bike.engine].filter(Boolean).map(esc).join(' · ');
  const price = `$${Number(bike.price_per_day).toFixed(0)}/day`;

  const takenLine = taken.length
    ? `<p class="taken-dates">Taken: ${taken
        .map((t) => `${fmtDate(t.start_date)}–${fmtDate(t.end_date)}`)
        .join(', ')}</p>`
    : '<p class="taken-dates">Open all dates</p>';

  return `
    <article class="bike">
      ${photo}
      <h2>${esc(bike.name)}</h2>
      <p class="meta">${meta}</p>
      <p class="price">${price}</p>
      ${takenLine}
      <button type="button" data-book="${bike.id}">Book this bike</button>
    </article>
  `;
}

// --- booking modal ---
function openBooking(bikeId) {
  selectedBike = bikes.find((b) => b.id === bikeId);
  if (!selectedBike) return;

  modalBikeName.textContent = selectedBike.name;
  form.reset();
  messageEl.textContent = '';
  messageEl.className = 'message';
  submitBtn.disabled = false;

  const today = new Date().toISOString().slice(0, 10);
  form.start_date.min = today;
  form.end_date.min = today;

  modal.showModal();
}

async function handleSubmit(e) {
  e.preventDefault();
  messageEl.textContent = '';
  messageEl.className = 'message';

  const fd = new FormData(form);
  const start = fd.get('start_date');
  const end   = fd.get('end_date');
  const name  = (fd.get('renter_name') || '').trim();
  const contact = (fd.get('renter_contact') || '').trim();

  // Client-side checks — friendlier errors before the server says no.
  if (!start || !end) return setMsg('Pick both dates.', 'error');
  if (end < start)    return setMsg('End date can\'t be before start date.', 'error');
  if (!name)          return setMsg('Your name is required.', 'error');
  if (!contact)       return setMsg('Your WeChat ID is required so we can reach you.', 'error');

  submitBtn.disabled = true;

  const { error } = await supabase.from('bookings').insert({
    bike_id: selectedBike.id,
    start_date: start,
    end_date: end,
    renter_name: name,
    renter_contact: contact,
    // status defaults to 'confirmed'; the public RLS policy enforces that anyway.
  });

  submitBtn.disabled = false;

  if (error) {
    // The two interesting failure modes:
    //   23P01 — the no_overlap exclusion constraint kicked in: dates were just taken.
    //   42501 — the public INSERT policy CHECK failed (past date, empty fields, etc.)
    if (error.code === '23P01' || /no_overlap/i.test(error.message)) {
      return setMsg('Sorry — those dates were just taken on this bike. Pick different dates.', 'error');
    }
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      return setMsg('Booking rejected — the dates must start today or later, end within 30 days, and name + WeChat ID must be filled in.', 'error');
    }
    return setMsg('Could not save: ' + error.message, 'error');
  }

  setMsg('Booked! ✓', 'success');
  await reloadAvailability();
  render();
  // Tell other open tabs/devices to refresh.
  liveChannel.send({ type: 'broadcast', event: 'changed', payload: { bike_id: selectedBike.id } });

  setTimeout(() => {
    modal.close();
    showToast('Booked! ✓');
  }, 700);
}

// --- helpers ---
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function fmtDate(iso) {
  // "2026-07-12" -> "Jul 12"
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function setMsg(text, kind) {
  messageEl.textContent = text;
  messageEl.className = 'message' + (kind ? ' ' + kind : '');
}
function showLoadError(msg) {
  bikesEl.innerHTML = '';
  emptyEl.hidden = true;
  loadErrorEl.hidden = false;
  loadErrorEl.textContent = msg;
}
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toastEl.hidden = true), 2400);
}
