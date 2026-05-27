// Shared helpers used by all three public tabs (rental, sell, parts).
//
// Why this exists:
//   * One Supabase client per page (the SDK pools sockets per-client; spawning
//     three would mean three Realtime websockets).
//   * One broadcast channel per page (same reason — every tab can react to
//     every write by listening to one event stream).
//   * One toast / one site-settings loader / one escape function — DRY.
//
// The tab modules (booking.js, sell.js, parts.js) import from here.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Site-wide live channel. Subscribers register on top of this; everyone
// broadcasts to it after a write. We use broadcast (not postgres_changes)
// because anon has no SELECT on bookings or orders — postgres_changes would
// be filtered out by RLS. Broadcast has no RLS check; it's pub/sub.
export const liveChannel = supabase.channel('site-changes', {
  config: { broadcast: { self: false } },
});
liveChannel.subscribe();

// --- DOM ---
export const $ = (id) => document.getElementById(id);

// --- formatting ---
export function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function fmtDate(iso) {
  // "2026-07-12" -> "Jul 12"
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function money(n) {
  return '$' + Number(n).toFixed(0);
}

// --- UI helpers ---
export function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.className = 'message' + (kind ? ' ' + kind : '');
}

export function showToast(msg, kind) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.style.background = kind === 'error' ? 'var(--danger)' : '';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (el.hidden = true), 2400);
}

// --- site settings ---
// Read the editable site name + tagline. Falls back silently to the hardcoded
// HTML if the table isn't reachable.
export async function applySiteSettings() {
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

// Broadcast a "something changed" event to every other open page so they
// refresh their data. event: 'availability' | 'sale_bikes' | 'parts' |
// 'orders' | 'settings'.
export function broadcastChange(event, payload = {}) {
  liveChannel.send({ type: 'broadcast', event, payload });
}
