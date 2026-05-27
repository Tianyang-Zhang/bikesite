// Parts tab — browse parts inventory and submit a purchase inquiry.
//
// Same shape as sell.js but parts have qty + stock, so the inquire modal
// captures qty and computes the total live.

import {
  supabase, liveChannel,
  $, esc, money, setMsg, showToast, broadcastChange,
} from './lib.js';

let listings = [];
let selected = null;

// DOM refs
let listEl, loadingEl, emptyEl, errorEl;
let modal, form, nameEl, unitEl, totalEl, stockLineEl, qtyInput;
let messageEl, cancelBtn, submitBtn;

export function initPartsTab() {
  listEl    = $('parts-list');
  loadingEl = $('parts-loading');
  emptyEl   = $('parts-empty');
  errorEl   = $('parts-error');

  modal       = $('parts-inquire-modal');
  form        = $('parts-inquire-form');
  nameEl      = $('parts-inquire-name');
  unitEl      = $('parts-inquire-unit');
  totalEl     = $('parts-inquire-total');
  stockLineEl = $('parts-inquire-stock-line');
  messageEl   = $('parts-inquire-message');
  cancelBtn   = $('parts-inquire-cancel');
  submitBtn   = $('parts-inquire-submit');
  qtyInput    = form.qty;

  cancelBtn.addEventListener('click', () => modal.close());
  form.addEventListener('submit', handleSubmit);
  qtyInput.addEventListener('input', recomputeTotal);

  liveChannel.on('broadcast', { event: 'parts' }, reload);

  reload();
}

async function reload() {
  const { data, error } = await supabase
    .from('parts_public')
    .select('*')
    .order('display_order', { ascending: true })
    .order('id');
  loadingEl.hidden = true;
  if (error) {
    showLoadError('Could not load parts: ' + error.message);
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

function card(p) {
  const photo = p.photo_url
    ? `<img src="${esc(p.photo_url)}" alt="${esc(p.name)}" loading="lazy">`
    : '<div class="photo-placeholder">No photo yet</div>';

  const metaParts = [p.category, p.condition === 'new' ? 'new' : 'used'].filter(Boolean);
  const meta = metaParts.map(esc).join(' · ');

  const description = p.description
    ? `<p class="description">${esc(p.description)}</p>`
    : '';

  const inStock = Number(p.stock) > 0;
  const stockLine = inStock
    ? `<p class="stock">In stock: ${esc(String(p.stock))}</p>`
    : '<p class="stock out">Out of stock</p>';

  const buttonHtml = inStock
    ? `<button type="button" data-inquire="${p.id}">Reserve / Inquire</button>`
    : '<button type="button" disabled>Out of stock</button>';

  return `
    <article class="card-item ${inStock ? '' : 'is-sold'}">
      ${photo}
      <h2>${esc(p.name)}</h2>
      <p class="meta">${meta}</p>
      <p class="price">${money(p.price)}</p>
      ${stockLine}
      ${description}
      ${buttonHtml}
    </article>
  `;
}

function openInquire(id) {
  selected = listings.find((x) => x.id === id);
  if (!selected || Number(selected.stock) <= 0) return;

  nameEl.textContent  = selected.name;
  unitEl.textContent  = money(selected.price);
  stockLineEl.textContent = `In stock: ${selected.stock}.`;
  form.reset();
  qtyInput.value = '1';
  qtyInput.max   = String(selected.stock);
  recomputeTotal();
  setMsg(messageEl, '');
  submitBtn.disabled = false;
  modal.showModal();
}

function recomputeTotal() {
  if (!selected) return;
  const q = Math.max(1, Math.min(Number(qtyInput.value || 1), Number(selected.stock)));
  totalEl.textContent = money(q * Number(selected.price));
}

async function handleSubmit(e) {
  e.preventDefault();
  setMsg(messageEl, '');

  const fd = new FormData(form);
  const name    = (fd.get('buyer_name')    || '').trim();
  const contact = (fd.get('buyer_contact') || '').trim();
  const qty     = Number(fd.get('qty') || 0);

  if (!Number.isInteger(qty) || qty < 1) return setMsg(messageEl, 'Quantity must be at least 1.', 'error');
  if (qty > Number(selected.stock))      return setMsg(messageEl, `Only ${selected.stock} in stock.`, 'error');
  if (!name)    return setMsg(messageEl, 'Your name is required.', 'error');
  if (!contact) return setMsg(messageEl, 'Your WeChat ID is required so we can reach you.', 'error');

  submitBtn.disabled = true;

  const unit  = Number(selected.price);
  const total = unit * qty;

  const { error } = await supabase.from('orders').insert({
    item_type:     'part',
    item_id:       selected.id,
    qty,
    unit_price:    unit,
    total_price:   total,
    buyer_name:    name,
    buyer_contact: contact,
  });

  submitBtn.disabled = false;

  if (error) {
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      return setMsg(messageEl, 'Inquiry rejected — quantity, name, and WeChat ID are required.', 'error');
    }
    return setMsg(messageEl, 'Could not send: ' + error.message, 'error');
  }

  setMsg(messageEl, 'Inquiry sent! ✓', 'success');
  broadcastChange('orders', { item_type: 'part', item_id: selected.id });

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
