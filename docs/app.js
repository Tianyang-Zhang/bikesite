// Public site entry point — hash router for the three tabs.
//
// Tabs are lazy-initialized: a tab's data is only fetched the first time
// the tab becomes visible. Switching back to an already-initialized tab is
// instant (the module decides whether to re-fetch on broadcast events).
//
// The default tab is "rental" — both when the URL has no hash and when
// the hash is something unrecognized.

import { applySiteSettings, liveChannel } from './lib.js';
import { initRentalTab } from './booking.js';
import { initSellTab }   from './sell.js';
import { initPartsTab }  from './parts.js';

const TABS = ['rental', 'sell', 'parts'];
const tabButtons = Array.from(document.querySelectorAll('.tabs button[data-tab]'));
const tabPanels  = Array.from(document.querySelectorAll('.tab-panel'));

const initialized = new Set();
const initFns = {
  rental: initRentalTab,
  sell:   initSellTab,
  parts:  initPartsTab,
};

function currentTab() {
  const h = (location.hash || '').replace(/^#/, '');
  return TABS.includes(h) ? h : 'rental';
}

function showTab(name) {
  for (const btn of tabButtons) {
    const active = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', String(active));
    btn.classList.toggle('active', active);
  }
  for (const panel of tabPanels) {
    panel.hidden = panel.id !== 'tab-' + name;
  }
  if (!initialized.has(name)) {
    initialized.add(name);
    try { initFns[name](); } catch (err) { console.error(`init ${name} failed:`, err); }
  }
}

// Tab buttons set the hash; the hashchange listener does the actual switching.
// That way back/forward and direct links (yoursite.com/#sell) work the same.
for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    if (location.hash !== '#' + t) location.hash = '#' + t;
    else showTab(t);
  });
}
window.addEventListener('hashchange', () => showTab(currentTab()));

// Site name + tagline (editable from the admin page). Re-apply on broadcast
// so when the manager updates them, every open page picks it up live.
applySiteSettings();
liveChannel.on('broadcast', { event: 'settings' }, applySiteSettings);

// Boot the initial tab. This kicks off its first data load.
showTab(currentTab());
