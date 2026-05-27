// Sell tab — browse used bikes for sale and submit a purchase inquiry.
//
// The anon role can SELECT from `sale_bikes_public` (the listings view) and
// INSERT into `orders` with status='pending'. The manager follows up on
// WeChat. When a payment provider is wired up later, the same insert is
// reused — an Edge Function turns the pending order into a Stripe Checkout
// Session and writes session_id + payment_provider back to the row.

import {
  supabase, liveChannel,
  $, esc, money, setMsg, showToast, broadcastChange,
} from './lib.js';

let listings = [];      // [{id, name, type, engine, year, mileage_km, condition, description, price, photo_url, sold, ...}]
let selected = null;

// DOM refs
let listEl, loadingEl, emptyEl, errorEl;
let modal, form, bikeNameEl, priceEl, messageEl, cancelBtn, submitBtn;

export function initSellTab() {
  listEl    = $('sell-list');
  loadingEl = $('sell-loading');
  emptyEl   = $('sell-empty');
  errorEl   = $('sell-error');

  modal      = $('sell-inquire-modal');
  form       = $('sell-inquire-form');
  bikeNameEl = $('sell-inquire-bike-name');
  priceEl    = $('sell-inquire-price');
  messageEl  = $('sell-inquire-message');
  cancelBtn  = $('sell-inquire-cancel');
  submitBtn  = $('sell-inquire-submit');

  cancelBtn.addEventListener('click', () => modal.close());
  form.addEventListener('submit', handleSubmit);

  // Live: another open page sold a bike / a new listing went up.
  liveChannel.on('broadcast', { event: 'sale_bikes' }, reload);

  reload();
}

async function reload() {
  const { data, error } = await supabase
    .from('sale_bikes_public')
    .select('*')
    .order('display_order', { ascending: true })
    .order('id');
  loadingEl.hidden = true;
  if (error) {
    showLoadError('Could not load sale listings: ' + error.message);
    return;
  }
  listings = data || [];
  render();
}

function render() {
  errorEl.hidden = true;
  if (listings.length === 0) {
    emptyEl.hidden = false;
    listEl.innerHTML = '';
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = listings.map(card).join('');
  listEl.querySelectorAll('[data-inquire]').forEach((btn) => {
    btn.addEventListener('click', () => openInquire(Number(btn.dataset.inquire)));
  });
}

function card(b) {
  const photo = b.photo_url
    ? `<img src="${esc(b.photo_url)}" alt="${esc(b.name)}" loading="lazy">`
    : '<div class="photo-placeholder">No photo yet</div>';

  // Meta line: type · engine · year · 12,400 km
  const metaParts = [b.type, b.engine, b.year ? String(b.year) : null,
                     b.mileage_km != null ? `${Number(b.mileage_km).toLocaleString()} km` : null]
    .filter(Boolean);
  const meta = metaParts.map(esc).join(' · ');

  const conditionLine = b.condition
    ? `<p class="meta">Condition: ${esc(b.condition)}</p>`
    : '';

  const description = b.description
    ? `<p class="description">${esc(b.description)}</p>`
    : '';

  const soldBadge = b.sold ? '<span class="badge badge-sold">SOLD</span>' : '';

  const buttonHtml = b.sold
    ? '<button type="button" disabled>Sold</button>'
    : `<button type="button" data-inquire="${b.id}">Reserve / Inquire</button>`;

  return `
    <article class="card-item ${b.sold ? 'is-sold' : ''}">
      ${photo}
      <h2>${esc(b.name)} ${soldBadge}</h2>
      <p class="meta">${meta}</p>
      ${conditionLine}
      <p class="price">${money(b.price)}</p>
      ${description}
      ${buttonHtml}
    </article>
  `;
}

function openInquire(id) {
  selected = listings.find((x) => x.id === id);
  if (!selected || selected.sold) return;

  bikeNameEl.textContent = selected.name;
  priceEl.textContent = money(selected.price);
  form.reset();
  setMsg(messageEl, '');
  submitBtn.disabled = false;
  modal.showModal();
}

async function handleSubmit(e) {
  e.preventDefault();
  setMsg(messageEl, '');

  const fd = new FormData(form);
  const name    = (fd.get('buyer_name')    || '').trim();
  const contact = (fd.get('buyer_contact') || '').trim();

  if (!name)    return setMsg(messageEl, 'Your name is required.', 'error');
  if (!contact) return setMsg(messageEl, 'Your WeChat ID is required so we can reach you.', 'error');

  submitBtn.disabled = true;

  const unit  = Number(selected.price);
  const total = unit;  // qty = 1 for sale bikes

  const { error } = await supabase.from('orders').insert({
    item_type:     'sale_bike',
    item_id:       selected.id,
    qty:           1,
    unit_price:    unit,
    total_price:   total,
    buyer_name:    name,
    buyer_contact: contact,
    // status, payment_* default per schema (pending / null).
  });

  submitBtn.disabled = false;

  if (error) {
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      return setMsg(messageEl, 'Inquiry rejected — name + WeChat ID are required.', 'error');
    }
    return setMsg(messageEl, 'Could not send: ' + error.message, 'error');
  }

  setMsg(messageEl, 'Inquiry sent! ✓', 'success');
  broadcastChange('orders', { item_type: 'sale_bike', item_id: selected.id });

  setTimeout(() => {
    modal.close();
    showToast('Inquiry sent — we\'ll message you on WeChat ✓');
  }, 700);
}

function showLoadError(msg) {
  listEl.innerHTML = '';
  emptyEl.hidden = true;
  errorEl.hidden = false;
  errorEl.textContent = msg;
}
