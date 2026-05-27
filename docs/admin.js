// Manager admin page — sign-in + CRUD for the four inventories that drive
// the public site:
//   * bookings  (rentals)
//   * bikes     (rental inventory)
//   * sale_bikes (Sell tab inventory)
//   * parts      (Parts tab inventory)
//   * orders     (purchase intents from Sell + Parts)
//
// RLS lets the authenticated manager do all of this through the SAME REST
// endpoints used by the public page; the authenticated role just has
// full-access policies.

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
const toastEl        = $('toast');

// Bookings
const bookingsBody   = $('bookings-body');
const bookingsEmpty  = $('bookings-empty');
const bookingsTable  = $('bookings-table');
const bookingsRefresh = $('bookings-refresh');

// Rental bikes
const bikesBody      = $('bikes-body');
const bikesEmpty     = $('bikes-empty');
const bikesTable     = $('bikes-table');
const addBikeBtn     = $('add-bike');

// Sale bikes
const saleBikesBody  = $('sale-bikes-body');
const saleBikesEmpty = $('sale-bikes-empty');
const saleBikesTable = $('sale-bikes-table');
const addSaleBikeBtn = $('add-sale-bike');

// Parts
const partsBody      = $('parts-body');
const partsEmpty     = $('parts-empty');
const partsTable     = $('parts-table');
const addPartBtn     = $('add-part');

// Orders
const ordersBody     = $('orders-body');
const ordersEmpty    = $('orders-empty');
const ordersTable    = $('orders-table');
const ordersRefresh  = $('orders-refresh');

// Booking edit modal
const beModal   = $('booking-edit-modal');
const beForm    = $('booking-edit-form');
const beBike    = $('be-bike');
const beMessage = $('be-message');
const beCancel  = $('be-cancel');
const beDelete  = $('be-delete');

// Rental bike edit modal
const bkModal   = $('bike-edit-modal');
const bkForm    = $('bike-edit-form');
const bkMessage = $('bk-message');
const bkCancel  = $('bk-cancel');
const bkTitle   = $('bk-title');
const bkPhotoFile   = $('bk-photo-file');
const bkPhotoStatus = $('bk-photo-status');
const bkDelete      = $('bk-delete');

// Sale bike edit modal
const sbModal   = $('sale-bike-edit-modal');
const sbForm    = $('sale-bike-edit-form');
const sbMessage = $('sb-message');
const sbCancel  = $('sb-cancel');
const sbTitle   = $('sb-title');
const sbPhotoFile   = $('sb-photo-file');
const sbPhotoStatus = $('sb-photo-status');
const sbDelete      = $('sb-delete');

// Part edit modal
const ptModal   = $('part-edit-modal');
const ptForm    = $('part-edit-form');
const ptMessage = $('pt-message');
const ptCancel  = $('pt-cancel');
const ptTitle   = $('pt-title');
const ptPhotoFile   = $('pt-photo-file');
const ptPhotoStatus = $('pt-photo-status');
const ptDelete      = $('pt-delete');

// Order edit modal
const orModal   = $('order-edit-modal');
const orForm    = $('order-edit-form');
const orMessage = $('or-message');
const orSummary = $('or-summary');
const orCancel  = $('or-cancel');
const orDelete  = $('or-delete');

// Site settings card
const settingsForm    = $('settings-form');
const settingsMessage = $('settings-message');

// --- state ---
let bookings  = [];
let bikes     = [];
let saleBikes = [];
let parts     = [];
let orders    = [];
let editingBookingId  = null;
let editingBikeId     = null;
let editingSaleBikeId = null;
let editingPartId     = null;
let editingOrderId    = null;

// --- live broadcast — site-wide channel shared with public pages ---
// Must match the channel name in docs/lib.js.
const liveChannel = supabase.channel('site-changes', { config: { broadcast: { self: false } } });
liveChannel
  .on('broadcast', { event: 'availability' }, reload)
  .on('broadcast', { event: 'sale_bikes'   }, reload)
  .on('broadcast', { event: 'parts'        }, reload)
  .on('broadcast', { event: 'orders'       }, reload)
  .subscribe();

function broadcastChange(event, payload = {}) {
  liveChannel.send({ type: 'broadcast', event, payload });
}

// --- boot ---
loginForm.addEventListener('submit', handleLogin);
signOutBtn.addEventListener('click', handleSignOut);

bookingsRefresh.addEventListener('click', reload);
addBikeBtn.addEventListener('click', () => openBikeEdit(null));
addSaleBikeBtn.addEventListener('click', () => openSaleBikeEdit(null));
addPartBtn.addEventListener('click', () => openPartEdit(null));
ordersRefresh.addEventListener('click', reload);

beCancel.addEventListener('click', () => beModal.close());
beDelete.addEventListener('click', deleteBooking);
beForm.addEventListener('submit', saveBooking);

bkCancel.addEventListener('click', () => bkModal.close());
bkForm.addEventListener('submit', saveBike);
bkPhotoFile.addEventListener('change', (e) => uploadPhoto(e, bkForm, bkPhotoStatus));
bkDelete.addEventListener('click', deleteBike);

sbCancel.addEventListener('click', () => sbModal.close());
sbForm.addEventListener('submit', saveSaleBike);
sbPhotoFile.addEventListener('change', (e) => uploadPhoto(e, sbForm, sbPhotoStatus));
sbDelete.addEventListener('click', deleteSaleBike);

ptCancel.addEventListener('click', () => ptModal.close());
ptForm.addEventListener('submit', savePart);
ptPhotoFile.addEventListener('change', (e) => uploadPhoto(e, ptForm, ptPhotoStatus));
ptDelete.addEventListener('click', deletePart);

orCancel.addEventListener('click', () => orModal.close());
orForm.addEventListener('submit', saveOrder);
orDelete.addEventListener('click', deleteOrder);
// Keep total_price = qty * unit_price in sync as the manager types.
orForm.qty.addEventListener('input', recomputeOrderTotal);
orForm.unit_price.addEventListener('input', recomputeOrderTotal);

settingsForm.addEventListener('submit', saveSettings);

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
    loadSettings();
  } else {
    loginSection.hidden = false;
    dashboard.hidden = true;
  }
}

// --- site settings ---
async function loadSettings() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('site_name, tagline')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return;
  settingsForm.site_name.value = data.site_name || '';
  settingsForm.tagline.value   = data.tagline   || '';
  document.title = 'Admin · ' + data.site_name;
}

async function saveSettings(e) {
  e.preventDefault();
  settingsMessage.textContent = '';
  settingsMessage.className = 'message';
  const fd = new FormData(settingsForm);
  const site_name = (fd.get('site_name') || '').trim();
  const tagline   = (fd.get('tagline')   || '').trim();
  if (!site_name) {
    settingsMessage.textContent = 'Site name cannot be empty.';
    settingsMessage.classList.add('error');
    return;
  }
  const { error } = await supabase
    .from('site_settings')
    .update({ site_name, tagline, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    settingsMessage.textContent = error.message;
    settingsMessage.classList.add('error');
    return;
  }
  document.title = 'Admin · ' + site_name;
  broadcastChange('settings');
  toast('Site settings saved ✓', 'success');
}

// --- data ---
async function reload() {
  const [bRes, kRes, sRes, pRes, oRes] = await Promise.all([
    supabase.from('bookings').select('*').order('start_date', { ascending: true }),
    supabase.from('bikes').select('*').order('display_order').order('id'),
    supabase.from('sale_bikes').select('*').order('display_order').order('id'),
    supabase.from('parts').select('*').order('display_order').order('id'),
    // Pending first, then by recency.
    supabase.from('orders').select('*').order('status').order('created_at', { ascending: false }),
  ]);
  if (bRes.error) return toast('Bookings: '   + bRes.error.message, 'error');
  if (kRes.error) return toast('Bikes: '      + kRes.error.message, 'error');
  if (sRes.error) return toast('Sale bikes: ' + sRes.error.message, 'error');
  if (pRes.error) return toast('Parts: '      + pRes.error.message, 'error');
  if (oRes.error) return toast('Orders: '     + oRes.error.message, 'error');
  bookings  = bRes.data || [];
  bikes     = kRes.data || [];
  saleBikes = sRes.data || [];
  parts     = pRes.data || [];
  orders    = oRes.data || [];
  renderBookings();
  renderBikes();
  renderSaleBikes();
  renderParts();
  renderOrders();
}

// ============================================================================
// Bookings
// ============================================================================
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
      <td data-label="WeChat">${esc(b.renter_contact)}</td>
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
  broadcastChange('availability');
  toast('Booking saved ✓', 'success');
}

async function deleteBooking() {
  if (!editingBookingId) return;
  if (!confirm('Delete this booking? This cannot be undone. (To free the dates without losing the record, set status to "cancelled" instead.)')) return;
  const { error } = await supabase.from('bookings').delete().eq('id', editingBookingId);
  if (error) { beMessage.textContent = error.message; beMessage.classList.add('error'); return; }
  await reload();
  beModal.close();
  broadcastChange('availability');
  toast('Booking deleted', 'success');
}

async function quickCancelBooking(id) {
  if (!confirm('Cancel this booking? The dates will free up immediately.')) return;
  const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  if (error) return toast(error.message, 'error');
  await reload();
  broadcastChange('availability');
  toast('Booking cancelled', 'success');
}

// ============================================================================
// Rental bikes
// ============================================================================
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
      <td data-label="Display order">${esc(b.display_order)}</td>
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
  bkPhotoFile.value = '';
  bkPhotoStatus.textContent = '';
  bkPhotoStatus.className = 'message';
  bkDelete.hidden = isNew;
  bkModal.showModal();
}

async function deleteBike() {
  if (editingBikeId == null) return;
  const bike = bikes.find((b) => b.id === editingBikeId);
  const name = bike ? bike.name : 'this bike';
  if (!confirm(`Delete "${name}"? This is permanent. If the bike has bookings (past or current), the delete will fail and you should deactivate the bike instead.`)) return;
  const { error } = await supabase.from('bikes').delete().eq('id', editingBikeId);
  if (error) {
    if (error.code === '23503' || /foreign key|violates|restrict/i.test(error.message)) {
      bkMessage.textContent = 'Cannot delete — this bike has bookings (past or current). Uncheck Active to hide it without losing the booking history.';
    } else {
      bkMessage.textContent = error.message;
    }
    bkMessage.classList.add('error');
    return;
  }
  await reload();
  bkModal.close();
  broadcastChange('availability');
  toast('Bike deleted', 'success');
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
  broadcastChange('availability');
  toast(editingBikeId == null ? 'Bike added ✓' : 'Bike saved ✓', 'success');
}

// ============================================================================
// Sale bikes
// ============================================================================
function renderSaleBikes() {
  if (saleBikes.length === 0) {
    saleBikesTable.hidden = true; saleBikesEmpty.hidden = false; return;
  }
  saleBikesEmpty.hidden = true; saleBikesTable.hidden = false;
  saleBikesBody.innerHTML = saleBikes.map(b => `
    <tr>
      <td data-label="Name">${esc(b.name)}</td>
      <td data-label="Type">${esc(b.type)}</td>
      <td data-label="Year">${esc(b.year || '')}</td>
      <td data-label="Mileage (km)">${b.mileage_km == null ? '' : Number(b.mileage_km).toLocaleString()}</td>
      <td data-label="Price">$${Number(b.price).toFixed(0)}</td>
      <td data-label="Display order">${esc(b.display_order)}</td>
      <td data-label="Active">${b.active ? '✓' : '—'}</td>
      <td data-label="Sold">${b.sold ? '✓' : '—'}</td>
      <td class="row-actions">
        <button type="button" data-edit-sale-bike="${b.id}">Edit</button>
      </td>
    </tr>
  `).join('');
  saleBikesBody.querySelectorAll('[data-edit-sale-bike]').forEach((btn) => {
    btn.addEventListener('click', () => openSaleBikeEdit(Number(btn.dataset.editSaleBike)));
  });
}

function openSaleBikeEdit(id) {
  const isNew = id == null;
  editingSaleBikeId = id;
  sbTitle.textContent = isNew ? 'Add sale bike' : 'Edit sale bike';
  const b = isNew ? {} : (saleBikes.find((x) => x.id === id) || {});
  sbForm.name.value          = b.name || '';
  sbForm.type.value          = b.type || '';
  sbForm.engine.value        = b.engine || '';
  sbForm.year.value          = b.year != null ? b.year : '';
  sbForm.mileage_km.value    = b.mileage_km != null ? b.mileage_km : '';
  sbForm.condition.value     = b.condition || '';
  sbForm.description.value   = b.description || '';
  sbForm.price.value         = b.price != null ? b.price : '';
  sbForm.display_order.value = b.display_order != null ? b.display_order : 0;
  sbForm.photo_url.value     = b.photo_url || '';
  sbForm.active.checked      = b.active !== false;
  sbForm.sold.checked        = !!b.sold;
  sbMessage.textContent = '';
  sbMessage.className = 'message';
  sbPhotoFile.value = '';
  sbPhotoStatus.textContent = '';
  sbPhotoStatus.className = 'message';
  sbDelete.hidden = isNew;
  sbModal.showModal();
}

async function saveSaleBike(e) {
  e.preventDefault();
  sbMessage.textContent = '';
  sbMessage.className = 'message';
  const fd = new FormData(sbForm);
  const payload = {
    name:          (fd.get('name') || '').trim(),
    type:          (fd.get('type') || '').trim(),
    engine:        (fd.get('engine') || '').trim() || null,
    year:          fd.get('year') ? Number(fd.get('year')) : null,
    mileage_km:    fd.get('mileage_km') ? Number(fd.get('mileage_km')) : null,
    condition:     (fd.get('condition') || '').trim() || null,
    description:   (fd.get('description') || '').trim() || null,
    price:         Number(fd.get('price')),
    display_order: Number(fd.get('display_order') || 0),
    photo_url:     (fd.get('photo_url') || '').trim() || null,
    active:        sbForm.active.checked,
    sold:          sbForm.sold.checked,
  };
  const op = editingSaleBikeId == null
    ? supabase.from('sale_bikes').insert(payload)
    : supabase.from('sale_bikes').update(payload).eq('id', editingSaleBikeId);
  const { error } = await op;
  if (error) { sbMessage.textContent = error.message; sbMessage.classList.add('error'); return; }
  await reload();
  sbModal.close();
  broadcastChange('sale_bikes');
  toast(editingSaleBikeId == null ? 'Sale bike added ✓' : 'Sale bike saved ✓', 'success');
}

async function deleteSaleBike() {
  if (editingSaleBikeId == null) return;
  const b = saleBikes.find((x) => x.id === editingSaleBikeId);
  const name = b ? b.name : 'this bike';
  if (!confirm(`Delete "${name}"? This is permanent. Orders referencing this bike will keep their snapshot but the item lookup will read "(deleted)".`)) return;
  const { error } = await supabase.from('sale_bikes').delete().eq('id', editingSaleBikeId);
  if (error) { sbMessage.textContent = error.message; sbMessage.classList.add('error'); return; }
  await reload();
  sbModal.close();
  broadcastChange('sale_bikes');
  toast('Sale bike deleted', 'success');
}

// ============================================================================
// Parts
// ============================================================================
function renderParts() {
  if (parts.length === 0) {
    partsTable.hidden = true; partsEmpty.hidden = false; return;
  }
  partsEmpty.hidden = true; partsTable.hidden = false;
  partsBody.innerHTML = parts.map(p => `
    <tr>
      <td data-label="Name">${esc(p.name)}</td>
      <td data-label="Category">${esc(p.category)}</td>
      <td data-label="Condition">${esc(p.condition)}</td>
      <td data-label="Price">$${Number(p.price).toFixed(2)}</td>
      <td data-label="Stock">${esc(p.stock)}</td>
      <td data-label="Display order">${esc(p.display_order)}</td>
      <td data-label="Active">${p.active ? '✓' : '—'}</td>
      <td class="row-actions">
        <button type="button" data-edit-part="${p.id}">Edit</button>
      </td>
    </tr>
  `).join('');
  partsBody.querySelectorAll('[data-edit-part]').forEach((btn) => {
    btn.addEventListener('click', () => openPartEdit(Number(btn.dataset.editPart)));
  });
}

function openPartEdit(id) {
  const isNew = id == null;
  editingPartId = id;
  ptTitle.textContent = isNew ? 'Add part' : 'Edit part';
  const p = isNew ? {} : (parts.find((x) => x.id === id) || {});
  ptForm.name.value          = p.name || '';
  ptForm.category.value      = p.category || '';
  ptForm.condition.value     = p.condition || 'new';
  ptForm.description.value   = p.description || '';
  ptForm.price.value         = p.price != null ? p.price : '';
  ptForm.stock.value         = p.stock != null ? p.stock : 1;
  ptForm.display_order.value = p.display_order != null ? p.display_order : 0;
  ptForm.photo_url.value     = p.photo_url || '';
  ptForm.active.checked      = p.active !== false;
  ptMessage.textContent = '';
  ptMessage.className = 'message';
  ptPhotoFile.value = '';
  ptPhotoStatus.textContent = '';
  ptPhotoStatus.className = 'message';
  ptDelete.hidden = isNew;
  ptModal.showModal();
}

async function savePart(e) {
  e.preventDefault();
  ptMessage.textContent = '';
  ptMessage.className = 'message';
  const fd = new FormData(ptForm);
  const payload = {
    name:          (fd.get('name') || '').trim(),
    category:      (fd.get('category') || '').trim(),
    condition:     (fd.get('condition') || 'new').trim(),
    description:   (fd.get('description') || '').trim() || null,
    price:         Number(fd.get('price')),
    stock:         Number(fd.get('stock') || 0),
    display_order: Number(fd.get('display_order') || 0),
    photo_url:     (fd.get('photo_url') || '').trim() || null,
    active:        ptForm.active.checked,
  };
  const op = editingPartId == null
    ? supabase.from('parts').insert(payload)
    : supabase.from('parts').update(payload).eq('id', editingPartId);
  const { error } = await op;
  if (error) { ptMessage.textContent = error.message; ptMessage.classList.add('error'); return; }
  await reload();
  ptModal.close();
  broadcastChange('parts');
  toast(editingPartId == null ? 'Part added ✓' : 'Part saved ✓', 'success');
}

async function deletePart() {
  if (editingPartId == null) return;
  const p = parts.find((x) => x.id === editingPartId);
  const name = p ? p.name : 'this part';
  if (!confirm(`Delete "${name}"? This is permanent.`)) return;
  const { error } = await supabase.from('parts').delete().eq('id', editingPartId);
  if (error) { ptMessage.textContent = error.message; ptMessage.classList.add('error'); return; }
  await reload();
  ptModal.close();
  broadcastChange('parts');
  toast('Part deleted', 'success');
}

// ============================================================================
// Orders
// ============================================================================
function itemLookup(o) {
  if (o.item_type === 'sale_bike') {
    const b = saleBikes.find((x) => x.id === o.item_id);
    return b ? b.name : `(deleted bike #${o.item_id})`;
  }
  if (o.item_type === 'part') {
    const p = parts.find((x) => x.id === o.item_id);
    return p ? p.name : `(deleted part #${o.item_id})`;
  }
  return o.item_type + ' #' + o.item_id;
}

function renderOrders() {
  if (orders.length === 0) {
    ordersTable.hidden = true; ordersEmpty.hidden = false; return;
  }
  ordersEmpty.hidden = true; ordersTable.hidden = false;
  ordersBody.innerHTML = orders.map(o => {
    const created = new Date(o.created_at).toLocaleString();
    const paymentBits = [
      o.payment_provider ? esc(o.payment_provider) : '',
      o.payment_session_id ? `session:${esc(o.payment_session_id.slice(0, 8))}…` : '',
      o.payment_intent_id  ? `intent:${esc(o.payment_intent_id.slice(0, 8))}…`   : '',
    ].filter(Boolean).join(' / ');
    return `
      <tr>
        <td data-label="Item">${esc(itemLookup(o))} <small>(${esc(o.item_type)})</small></td>
        <td data-label="Buyer">${esc(o.buyer_name)}</td>
        <td data-label="WeChat">${esc(o.buyer_contact)}</td>
        <td data-label="Qty">${esc(o.qty)}</td>
        <td data-label="Total">$${Number(o.total_price).toFixed(2)}</td>
        <td data-label="Status"><span class="status-pill status-${esc(o.status)}">${esc(o.status)}</span></td>
        <td data-label="Created">${esc(created)}</td>
        <td data-label="Payment">${paymentBits || '—'}</td>
        <td class="row-actions">
          <button type="button" data-edit-order="${o.id}">Edit</button>
        </td>
      </tr>
    `;
  }).join('');
  ordersBody.querySelectorAll('[data-edit-order]').forEach((btn) => {
    btn.addEventListener('click', () => openOrderEdit(Number(btn.dataset.editOrder)));
  });
}

function openOrderEdit(id) {
  const o = orders.find((x) => x.id === id);
  if (!o) return;
  editingOrderId = id;
  orSummary.textContent = `${itemLookup(o)} · ${o.item_type} · created ${new Date(o.created_at).toLocaleString()}`;
  orForm.buyer_name.value         = o.buyer_name || '';
  orForm.buyer_contact.value      = o.buyer_contact || '';
  orForm.qty.value                = o.qty;
  orForm.unit_price.value         = o.unit_price;
  orForm.total_price.value        = o.total_price;
  orForm.status.value             = o.status;
  orForm.payment_provider.value   = o.payment_provider || '';
  orForm.payment_session_id.value = o.payment_session_id || '';
  orForm.payment_intent_id.value  = o.payment_intent_id || '';
  orForm.notes.value              = o.notes || '';
  orMessage.textContent = '';
  orMessage.className = 'message';
  orModal.showModal();
}

function recomputeOrderTotal() {
  const q = Number(orForm.qty.value || 0);
  const u = Number(orForm.unit_price.value || 0);
  // Only auto-update if the manager hasn't edited total_price away from the
  // computed value; cheap heuristic — always write q*u. The manager can still
  // override the field afterward; the table CHECK only fires for anon inserts.
  orForm.total_price.value = (q * u).toFixed(2);
}

async function saveOrder(e) {
  e.preventDefault();
  orMessage.textContent = '';
  orMessage.className = 'message';
  const fd = new FormData(orForm);
  const payload = {
    buyer_name:         (fd.get('buyer_name')    || '').trim(),
    buyer_contact:      (fd.get('buyer_contact') || '').trim(),
    qty:                Number(fd.get('qty')),
    unit_price:         Number(fd.get('unit_price')),
    total_price:        Number(fd.get('total_price')),
    status:             fd.get('status') || 'pending',
    payment_provider:   (fd.get('payment_provider')   || '').trim() || null,
    payment_session_id: (fd.get('payment_session_id') || '').trim() || null,
    payment_intent_id:  (fd.get('payment_intent_id')  || '').trim() || null,
    notes:              (fd.get('notes') || '').trim() || null,
  };
  const { error } = await supabase.from('orders').update(payload).eq('id', editingOrderId);
  if (error) { orMessage.textContent = error.message; orMessage.classList.add('error'); return; }
  await reload();
  orModal.close();
  broadcastChange('orders');
  toast('Order saved ✓', 'success');
}

async function deleteOrder() {
  if (!editingOrderId) return;
  if (!confirm('Delete this order? This is permanent. (To preserve the record, set status to "cancelled" instead.)')) return;
  const { error } = await supabase.from('orders').delete().eq('id', editingOrderId);
  if (error) { orMessage.textContent = error.message; orMessage.classList.add('error'); return; }
  await reload();
  orModal.close();
  broadcastChange('orders');
  toast('Order deleted', 'success');
}

// ============================================================================
// Storage — generic photo uploader, shared by rental / sale_bike / part forms.
// All three reuse the existing `bike-photos` bucket (set up in 04_storage.sql).
// Filenames are timestamped + randomized so there's no collision.
// ============================================================================
async function uploadPhoto(e, formEl, statusEl) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  statusEl.textContent = 'Uploading…';
  statusEl.className = 'message';
  try {
    const ext = ((file.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
    const filename = `bike-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from('bike-photos')
      .upload(filename, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('bike-photos').getPublicUrl(filename);
    formEl.photo_url.value = data.publicUrl;
    statusEl.textContent = 'Uploaded ✓ — Photo URL is now filled. Click Save to attach it.';
    statusEl.className = 'message success';
  } catch (err) {
    statusEl.textContent = 'Upload failed: ' + err.message;
    statusEl.className = 'message error';
  }
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
