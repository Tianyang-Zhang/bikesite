// Manager admin page — sign-in, view all bookings (incl. renter contacts),
// edit/cancel/move/delete bookings, add/edit bikes. RLS lets the authenticated
// manager do all of this through the SAME REST endpoints used by the public
// page; the authenticated role just has full-access policies.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// --- DOM ---
const $ = (id) => document.getElementById(id);
const loginSection   = $('login-section');
const loginForm      = $('login-form');
const loginMessage   = $('login-message');
const dashboard      = $('dashboard');
const whoEmail       = $('who-email');
const signOutBtn     = $('sign-out');
const bookingsBody   = $('bookings-body');
const bookingsEmpty  = $('bookings-empty');
const bookingsTable  = $('bookings-table');
const bookingsRefresh = $('bookings-refresh');
const bikesBody      = $('bikes-body');
const bikesEmpty     = $('bikes-empty');
const bikesTable     = $('bikes-table');
const addBikeBtn     = $('add-bike');
const toastEl        = $('toast');

// Booking edit modal
const beModal   = $('booking-edit-modal');
const beForm    = $('booking-edit-form');
const beBike    = $('be-bike');
const beMessage = $('be-message');
const beCancel  = $('be-cancel');
const beDelete  = $('be-delete');

// Bike edit modal
const bkModal   = $('bike-edit-modal');
const bkForm    = $('bike-edit-form');
const bkMessage = $('bk-message');
const bkCancel  = $('bk-cancel');
const bkTitle   = $('bk-title');

// --- state ---
let bookings = [];
let bikes    = [];
let editingBookingId = null;
let editingBikeId    = null;

// --- live broadcast (so other tabs/devices refresh after writes) ---
const liveChannel = supabase.channel('availability-changes', { config: { broadcast: { self: false } } });
liveChannel
  .on('broadcast', { event: 'changed' }, async () => { await reload(); })
  .subscribe();

// --- boot ---
loginForm.addEventListener('submit', handleLogin);
signOutBtn.addEventListener('click', handleSignOut);
bookingsRefresh.addEventListener('click', reload);
addBikeBtn.addEventListener('click', () => openBikeEdit(null));
beCancel.addEventListener('click', () => beModal.close());
beDelete.addEventListener('click', deleteBooking);
beForm.addEventListener('submit', saveBooking);
bkCancel.addEventListener('click', () => bkModal.close());
bkForm.addEventListener('submit', saveBike);

supabase.auth.onAuthStateChange((_event, session) => renderAuth(session));
supabase.auth.getSession().then(({ data }) => renderAuth(data.session));

// --- auth ---
async function handleLogin(e) {
  e.preventDefault();
  loginMessage.textContent = '';
  loginMessage.className = 'message';
  const fd = new FormData(loginForm);
  const { error } = await supabase.auth.signInWithPassword({
    email: fd.get('email'), password: fd.get('password'),
  });
  if (error) {
    loginMessage.textContent = error.message;
    loginMessage.classList.add('error');
  }
}

async function handleSignOut() {
  await supabase.auth.signOut();
}

function renderAuth(session) {
  if (session && session.user) {
    loginSection.hidden = true;
    dashboard.hidden = false;
    whoEmail.textContent = session.user.email || '(unknown)';
    reload();
  } else {
    loginSection.hidden = false;
    dashboard.hidden = true;
  }
}

// --- data ---
async function reload() {
  const [bRes, kRes] = await Promise.all([
    supabase.from('bookings').select('*').order('start_date', { ascending: true }),
    supabase.from('bikes').select('*').order('display_order').order('id'),
  ]);
  if (bRes.error) return toast('Bookings: ' + bRes.error.message, 'error');
  if (kRes.error) return toast('Bikes: ' + kRes.error.message, 'error');
  bookings = bRes.data || [];
  bikes    = kRes.data || [];
  renderBookings();
  renderBikes();
}

// --- bookings ---
function renderBookings() {
  if (bookings.length === 0) {
    bookingsTable.hidden = true; bookingsEmpty.hidden = false; return;
  }
  bookingsEmpty.hidden = true; bookingsTable.hidden = false;
  const bikeName = (id) => (bikes.find(b => b.id === id) || {}).name || '#' + id;
  bookingsBody.innerHTML = bookings.map(b => `
    <tr>
      <td data-label="Bike">${esc(bikeName(b.bike_id))}</td>
      <td data-label="Dates">${esc(b.start_date)} → ${esc(b.end_date)}</td>
      <td data-label="Renter">${esc(b.renter_name)}</td>
      <td data-label="Contact">${esc(b.renter_contact)}</td>
      <td data-label="Status"><span class="status-pill status-${esc(b.status)}">${esc(b.status)}</span></td>
      <td class="row-actions">
        <button type="button" data-edit-booking="${b.id}">Edit</button>
        ${b.status === 'confirmed' ? `<button type="button" class="danger" data-cancel-booking="${b.id}">Cancel</button>` : ''}
      </td>
    </tr>
  `).join('');
  bookingsBody.querySelectorAll('[data-edit-booking]').forEach((btn) => {
    btn.addEventListener('click', () => openBookingEdit(Number(btn.dataset.editBooking)));
  });
  bookingsBody.querySelectorAll('[data-cancel-booking]').forEach((btn) => {
    btn.addEventListener('click', () => quickCancelBooking(Number(btn.dataset.cancelBooking)));
  });
}

function openBookingEdit(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  editingBookingId = id;
  beBike.innerHTML = bikes.map(k => `<option value="${k.id}"${k.id === b.bike_id ? ' selected' : ''}>${esc(k.name)}</option>`).join('');
  beForm.start_date.value     = b.start_date;
  beForm.end_date.value       = b.end_date;
  beForm.renter_name.value    = b.renter_name;
  beForm.renter_contact.value = b.renter_contact;
  beForm.status.value         = b.status;
  beMessage.textContent = '';
  beMessage.className = 'message';
  beModal.showModal();
}

async function saveBooking(e) {
  e.preventDefault();
  beMessage.textContent = '';
  beMessage.className = 'message';
  const fd = new FormData(beForm);
  const payload = {
    bike_id:        Number(fd.get('bike_id')),
    start_date:     fd.get('start_date'),
    end_date:       fd.get('end_date'),
    renter_name:    (fd.get('renter_name') || '').trim(),
    renter_contact: (fd.get('renter_contact') || '').trim(),
    status:         fd.get('status') || 'confirmed',
  };
  const { error } = await supabase.from('bookings').update(payload).eq('id', editingBookingId);
  if (error) {
    if (error.code === '23P01' || /no_overlap/i.test(error.message)) {
      beMessage.textContent = 'Those new dates overlap an existing confirmed booking for this bike.';
    } else {
      beMessage.textContent = error.message;
    }
    beMessage.classList.add('error');
    return;
  }
  await reload();
  beModal.close();
  liveChannel.send({ type: 'broadcast', event: 'changed', payload: {} });
  toast('Booking saved ✓', 'success');
}

async function deleteBooking() {
  if (!editingBookingId) return;
  if (!confirm('Delete this booking? This cannot be undone. (To free the dates without losing the record, set status to "cancelled" instead.)')) return;
  const { error } = await supabase.from('bookings').delete().eq('id', editingBookingId);
  if (error) { beMessage.textContent = error.message; beMessage.classList.add('error'); return; }
  await reload();
  beModal.close();
  liveChannel.send({ type: 'broadcast', event: 'changed', payload: {} });
  toast('Booking deleted', 'success');
}

async function quickCancelBooking(id) {
  if (!confirm('Cancel this booking? The dates will free up immediately.')) return;
  const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  if (error) return toast(error.message, 'error');
  await reload();
  liveChannel.send({ type: 'broadcast', event: 'changed', payload: {} });
  toast('Booking cancelled', 'success');
}

// --- bikes ---
function renderBikes() {
  if (bikes.length === 0) {
    bikesTable.hidden = true; bikesEmpty.hidden = false; return;
  }
  bikesEmpty.hidden = true; bikesTable.hidden = false;
  bikesBody.innerHTML = bikes.map(b => `
    <tr>
      <td data-label="Name">${esc(b.name)}</td>
      <td data-label="Type">${esc(b.type)}</td>
      <td data-label="Engine">${esc(b.engine || '')}</td>
      <td data-label="$/day">$${Number(b.price_per_day).toFixed(0)}</td>
      <td data-label="Order">${esc(b.display_order)}</td>
      <td data-label="Active">${b.active ? '✓' : '—'}</td>
      <td class="row-actions">
        <button type="button" data-edit-bike="${b.id}">Edit</button>
      </td>
    </tr>
  `).join('');
  bikesBody.querySelectorAll('[data-edit-bike]').forEach((btn) => {
    btn.addEventListener('click', () => openBikeEdit(Number(btn.dataset.editBike)));
  });
}

function openBikeEdit(id) {
  const isNew = id == null;
  editingBikeId = id;
  bkTitle.textContent = isNew ? 'Add bike' : 'Edit bike';
  const b = isNew ? {} : (bikes.find((x) => x.id === id) || {});
  bkForm.name.value          = b.name || '';
  bkForm.type.value          = b.type || '';
  bkForm.engine.value        = b.engine || '';
  bkForm.price_per_day.value = b.price_per_day != null ? b.price_per_day : '';
  bkForm.display_order.value = b.display_order != null ? b.display_order : 0;
  bkForm.photo_url.value     = b.photo_url || '';
  bkForm.active.checked      = b.active !== false;
  bkMessage.textContent = '';
  bkMessage.className = 'message';
  bkModal.showModal();
}

async function saveBike(e) {
  e.preventDefault();
  bkMessage.textContent = '';
  bkMessage.className = 'message';
  const fd = new FormData(bkForm);
  const payload = {
    name:          (fd.get('name') || '').trim(),
    type:          (fd.get('type') || '').trim(),
    engine:        (fd.get('engine') || '').trim() || null,
    price_per_day: Number(fd.get('price_per_day')),
    display_order: Number(fd.get('display_order') || 0),
    photo_url:     (fd.get('photo_url') || '').trim() || null,
    active:        bkForm.active.checked,
  };
  const op = editingBikeId == null
    ? supabase.from('bikes').insert(payload)
    : supabase.from('bikes').update(payload).eq('id', editingBikeId);
  const { error } = await op;
  if (error) { bkMessage.textContent = error.message; bkMessage.classList.add('error'); return; }
  await reload();
  bkModal.close();
  liveChannel.send({ type: 'broadcast', event: 'changed', payload: {} });
  toast(editingBikeId == null ? 'Bike added ✓' : 'Bike saved ✓', 'success');
}

// --- helpers ---
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function toast(msg, kind) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.style.background = kind === 'error' ? 'var(--danger)' : '';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.hidden = true), 2800);
}
