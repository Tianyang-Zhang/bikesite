// Rental tab — book a bike for a date range.
//
// Responsibilities:
//   * load the bikes + the contact-free availability view (anon SELECT, RLS-fenced)
//   * render a bike card per bike + a date picker / booking form modal
//   * insert bookings via Supabase (no_overlap and the public INSERT CHECKs do the validation)
//   * stay live: when *anyone* books, every open page refreshes availability
//     (we use Realtime BROADCAST, not postgres_changes, because the anon role
//     intentionally has no SELECT on `bookings` — so postgres_changes events
//     would be filtered out by RLS. Broadcast has no RLS check; it's pub/sub.)

import {
  supabase, liveChannel,
  $, esc, fmtDate, money, setMsg, showToast, broadcastChange,
} from './lib.js';

// --- state (module-scoped — initRentalTab is called once) ---
let bikes        = [];      // [{id, name, type, engine, price_per_day, photo_url, ...}]
let availability = [];      // [{bike_id, start_date, end_date}]
let selectedBike = null;

// DOM refs (resolved on init so the module can be safely tree-shaken before
// its tab is shown).
let bikesEl, loadingEl, emptyEl, loadErrorEl;
let modal, form, modalBikeName, messageEl, cancelBtn, submitBtn;

export function initRentalTab() {
  bikesEl       = $('bikes');
  loadingEl     = $('rental-loading');
  emptyEl       = $('rental-empty');
  loadErrorEl   = $('rental-error');
  modal         = $('booking-modal');
  form          = $('booking-form');
  modalBikeName = $('modal-bike-name');
  messageEl     = $('booking-message');
  cancelBtn     = $('booking-cancel');
  submitBtn     = $('booking-submit');

  cancelBtn.addEventListener('click', () => modal.close());
  form.addEventListener('submit', handleSubmit);

  // Refresh availability whenever any other open page broadcasts a change.
  liveChannel.on('broadcast', { event: 'availability' }, async () => {
    await reloadAvailability();
    render();
  });

  reloadAll();
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
  const price = `${money(bike.price_per_day)}/day`;

  const takenLine = taken.length
    ? `<p class="taken-dates">Taken: ${taken
        .map((t) => `${fmtDate(t.start_date)}–${fmtDate(t.end_date)}`)
        .join(', ')}</p>`
    : '<p class="taken-dates">Open all dates</p>';

  return `
    <article class="card-item">
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
  setMsg(messageEl, '');
  submitBtn.disabled = false;

  const today = new Date().toISOString().slice(0, 10);
  form.start_date.min = today;
  form.end_date.min = today;

  modal.showModal();
}

async function handleSubmit(e) {
  e.preventDefault();
  setMsg(messageEl, '');

  const fd = new FormData(form);
  const start = fd.get('start_date');
  const end   = fd.get('end_date');
  const name  = (fd.get('renter_name') || '').trim();
  const contact = (fd.get('renter_contact') || '').trim();

  // Client-side checks — friendlier errors before the server says no.
  if (!start || !end) return setMsg(messageEl, 'Pick both dates.', 'error');
  if (end < start)    return setMsg(messageEl, 'End date can\'t be before start date.', 'error');
  if (!name)          return setMsg(messageEl, 'Your name is required.', 'error');
  if (!contact)       return setMsg(messageEl, 'Your WeChat ID is required so we can reach you.', 'error');

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
      return setMsg(messageEl, 'Sorry — those dates were just taken on this bike. Pick different dates.', 'error');
    }
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      return setMsg(messageEl, 'Booking rejected — the dates must start today or later, end within 30 days, and name + WeChat ID must be filled in.', 'error');
    }
    return setMsg(messageEl, 'Could not save: ' + error.message, 'error');
  }

  setMsg(messageEl, 'Booked! ✓', 'success');
  await reloadAvailability();
  render();
  // Tell other open tabs/devices to refresh.
  broadcastChange('availability', { bike_id: selectedBike.id });

  setTimeout(() => {
    modal.close();
    showToast('Booked! ✓');
  }, 700);
}

// --- helpers ---
function showLoadError(msg) {
  bikesEl.innerHTML = '';
  emptyEl.hidden = true;
  loadErrorEl.hidden = false;
  loadErrorEl.textContent = msg;
}
