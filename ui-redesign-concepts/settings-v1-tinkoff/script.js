/* ==============================================================
   Settings v1 — interactive prototype
   Persistence:
     - settings-theme-v1     · 'light' | 'dark' | 'system'
     - settings-active-tab   · pane id
     - settings-toggles-v1   · { hints, dense, haptics }
   ============================================================== */

'use strict';

const root = document.documentElement;

/* ---------------- Theme handling ---------------- */
const THEME_KEY = 'settings-theme-v1';
const THEME_PREF_KEY = 'settings-theme-pref-v1'; // remembers 'system' choice
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme) {
  // theme: 'light' | 'dark' | 'system'
  if (theme === 'system') {
    root.dataset.theme = mq.matches ? 'dark' : 'light';
  } else {
    root.dataset.theme = theme;
  }
  // mirror onto <meta name=theme-color>
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', root.dataset.theme === 'dark' ? '#0A0A0B' : '#EEF0F3');
  }
}

const storedPref = localStorage.getItem(THEME_PREF_KEY) || 'light';
applyTheme(storedPref);

mq.addEventListener('change', () => {
  if ((localStorage.getItem(THEME_PREF_KEY) || 'light') === 'system') applyTheme('system');
});

/* ---------------- Theme toggle button (header) ---------------- */
document.getElementById('themeToggle').addEventListener('click', () => {
  const current = root.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_PREF_KEY, next);
  syncThemeGrid(next);
  toast(next === 'dark' ? 'Включена тёмная тема' : 'Включена светлая тема');
});

/* ---------------- Theme grid (visual picker) ---------------- */
const themeGrid = document.getElementById('themeGrid');

function syncThemeGrid(activePref) {
  themeGrid.querySelectorAll('.theme-card').forEach((c) => {
    const on = c.dataset.theme === activePref;
    c.classList.toggle('theme-card--on', on);
    c.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}
syncThemeGrid(storedPref);

themeGrid.addEventListener('click', (event) => {
  const card = event.target.closest('.theme-card');
  if (!card) return;
  const choice = card.dataset.theme;
  applyTheme(choice);
  localStorage.setItem(THEME_PREF_KEY, choice);
  syncThemeGrid(choice);
  const labels = { light: 'Светлая', dark: 'Тёмная', system: 'Системная' };
  toast(`Тема: ${labels[choice]}`);
});

/* ---------------- Tabs ---------------- */
const tabsEl = document.getElementById('tabs');
const tabButtons = Array.from(tabsEl.querySelectorAll('.tabs__item'));
const indicator = tabsEl.querySelector('.tabs__ind');
const TAB_KEY = 'settings-active-tab-v1';

function setIndicator(target) {
  if (!target || !indicator) return;
  const tabsRect = tabsEl.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const left = r.left - tabsRect.left + tabsEl.scrollLeft;
  indicator.style.width = `${r.width - 12}px`;
  indicator.style.transform = `translateX(${left + 6}px)`;
}

function activateTab(name, opts = {}) {
  const target = tabButtons.find((b) => b.dataset.tab === name) || tabButtons[0];
  tabButtons.forEach((b) => {
    const on = b === target;
    b.classList.toggle('tabs__item--on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.view-pane').forEach((p) => {
    p.classList.toggle('view-pane--on', p.dataset.pane === target.dataset.tab);
  });
  setIndicator(target);
  if (opts.scroll !== false) {
    target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
  localStorage.setItem(TAB_KEY, target.dataset.tab);
}

tabButtons.forEach((b) => {
  b.addEventListener('click', () => activateTab(b.dataset.tab));
});

const startTab = localStorage.getItem(TAB_KEY) || 'appearance';
requestAnimationFrame(() => activateTab(startTab, { scroll: false }));
window.addEventListener('resize', () => {
  const active = tabButtons.find((b) => b.classList.contains('tabs__item--on'));
  setIndicator(active);
});

/* ---------------- Switches ---------------- */
const TOGGLE_KEY = 'settings-toggles-v1';
const defaults = { hints: true, dense: false, haptics: true };
const toggles = Object.assign({}, defaults, JSON.parse(localStorage.getItem(TOGGLE_KEY) || '{}'));

function syncSwitches() {
  document.querySelectorAll('.sw').forEach((sw) => {
    const k = sw.dataset.sw;
    if (k in toggles) {
      sw.classList.toggle('sw--on', toggles[k]);
      sw.setAttribute('aria-checked', toggles[k] ? 'true' : 'false');
    }
  });
}
syncSwitches();

document.querySelectorAll('.sw').forEach((sw) => {
  sw.addEventListener('click', () => {
    const k = sw.dataset.sw;
    toggles[k] = !toggles[k];
    sw.classList.toggle('sw--on', toggles[k]);
    sw.setAttribute('aria-checked', toggles[k] ? 'true' : 'false');
    localStorage.setItem(TOGGLE_KEY, JSON.stringify(toggles));
    if (toggles.haptics && navigator.vibrate) navigator.vibrate(8);
  });
});

/* ---------------- Investments form ---------------- */
const investForm = document.getElementById('investForm');
const newInvestBtn = document.getElementById('newInvestBtn');
const cancelInvest = document.getElementById('cancelInvest');

newInvestBtn?.addEventListener('click', () => {
  const open = !investForm.hasAttribute('hidden');
  if (open) {
    investForm.setAttribute('hidden', '');
  } else {
    investForm.removeAttribute('hidden');
    setTimeout(() => document.getElementById('invName')?.focus(), 50);
  }
});

cancelInvest?.addEventListener('click', () => {
  investForm.setAttribute('hidden', '');
  investForm.reset();
});

investForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('invName').value.trim();
  if (!name) return;
  toast(`Создан счёт «${name}»`);
  investForm.reset();
  investForm.setAttribute('hidden', '');
});

/* ---------------- Misc CTAs (toast feedback) ---------------- */
document.getElementById('inviteBtn')?.addEventListener('click', () => toast('Ссылка-приглашение скопирована'));
document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
  if (confirm('Удалить аккаунт и все данные? Действие необратимо.')) toast('Запрос на удаление отправлен');
});

document.querySelectorAll('.invest-tile .icon-btn--ghost').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    const tile = event.currentTarget.closest('.invest-tile');
    const name = tile?.querySelector('.invest-tile__name')?.textContent ?? 'счёт';
    if (confirm(`Удалить инвестиционный счёт «${name}»?`)) toast('Счёт удалён');
  });
});

document.querySelectorAll('.danger-card .btn--danger').forEach((btn) => {
  if (btn.id === 'deleteAccountBtn') return;
  btn.addEventListener('click', () => {
    if (confirm('Распустить семью? Все семейные данные будут удалены.')) toast('Семья распущена');
  });
});

document.querySelectorAll('.btn--ghost').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    const label = event.currentTarget.textContent.trim();
    if (label.includes('Скачать')) toast('Файл подготовлен');
    else if (label.includes('Запустить')) toast('Пересчёт запущен');
    else if (label.includes('Синк')) toast('Синхронизация запущена');
  });
});

/* ---------------- Toast ---------------- */
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
let toastTimer = null;

function toast(msg) {
  if (!toastEl) return;
  toastMsg.textContent = msg;
  toastEl.removeAttribute('hidden');
  // double rAF so the transition kicks in
  requestAnimationFrame(() => requestAnimationFrame(() => toastEl.classList.add('is-open')));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-open');
    setTimeout(() => toastEl.setAttribute('hidden', ''), 250);
  }, 1800);
}

/* ---------------- Keyboard niceties ---------------- */
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !investForm?.hasAttribute('hidden')) {
    investForm.setAttribute('hidden', '');
  }
});
