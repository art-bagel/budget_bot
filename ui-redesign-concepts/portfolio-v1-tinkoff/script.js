/* Portfolio v1 — concept prototype
 * - Tab switching (all | security | deposit | crypto | other)
 * - Hero segtog: Сейчас ↔ С доходом (swap values for accrued-bearing positions)
 * - Hero-row click = activate tab
 * - Theme toggle with persistence
 */

(() => {
  'use strict';

  // ---- Theme ----------------------------------------------------------------
  const THEME_KEY = 'portfolio-theme-v1';
  const root = document.documentElement;
  const savedTheme = (() => {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  })();
  if (savedTheme === 'light' || savedTheme === 'dark') {
    root.setAttribute('data-theme', savedTheme);
  }
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  });

  // ---- Mode-aware position values ------------------------------------------
  // Positions that have a difference between current & potential value
  // (deposit accrued interest, bond НКД). For all others the number is the
  // same in both modes — no entry needed.
  const MODE_SWAP = {
    tdoxod: { now: '450 000', pot: '455 420', deltaNow: '+5 420 ₽ начислено', deltaPot: '+5 420 ₽ получите' },
    tvalut: { now: '180 420', pot: '181 320', deltaNow: '+900 ₽ начислено',   deltaPot: '+900 ₽ получите' },
    sberna: { now: '220 000', pot: '222 100', deltaNow: '+2 100 ₽ начислено', deltaPot: '+2 100 ₽ получите' },
    ofz238: { now: '95 000',  pot: '95 840',  deltaNow: '+840 ₽ купон',       deltaPot: '+840 ₽ выплата' },
  };
  const HERO_SWAP = {
    total: { now: '2 665 000', pot: '2 674 260' },
    security: { now: '1 311 780 ₽', pot: '1 312 620 ₽' },
    deposit:  { now: '850 420 ₽',   pot: '858 840 ₽' },
    crypto:   { now: '245 800 ₽',   pot: '245 800 ₽' },
    other:    { now: '257 000 ₽',   pot: '257 000 ₽' },
  };
  const GROUP_SWAP = {
    'sec-tinkoff': { now: '1 211 780', pot: '1 212 620' },
    'dep-tinkoff': { now: '630 420',   pot: '636 740' },
    'dep-sber':    { now: '220 000',   pot: '222 100' },
  };
  const GROUP_DELTA_SWAP = {
    'dep-tinkoff': { now: '+6 320 ₽ начислено', pot: '+6 320 ₽ получите в конце срока' },
    'dep-sber':    { now: '+2 100 ₽ начислено', pot: '+2 100 ₽ получите в конце срока' },
  };

  // ---- Type summary card data ----------------------------------------------
  // Two variants (now vs potential) where it matters.
  const TYPE_DATA = {
    security: {
      tint: 'ink',
      icon: '#i-chart',
      eyebrow: 'Ценные бумаги',
      sub: '8 позиций · 2 счёта',
      deltaAbs: '+28 500 ₽',
      deltaPct: '+2,2%',
      deltaPositive: true,
      invested: '1 220 000',
      incomePct: '+7,5%',
      incomePositive: true,
      thirdLabel: 'Позиций',
      thirdValue: '8',
      variants: {
        now: { nowValue: '1 311 780', income: '+91 780', footText: null },
        pot: { nowValue: '1 312 620', income: '+92 620', footText: '+840 ₽ — НКД по ОФЗ 26238, выплатится в дату купона' },
      },
    },
    deposit: {
      tint: 'mint',
      icon: '#i-safe',
      eyebrow: 'Депозиты',
      sub: '3 вклада · Т-Банк, Сбер',
      deltaAbs: '+12 200 ₽',
      deltaPct: '+1,5%',
      deltaPositive: true,
      invested: '820 000',
      incomePct: null, // filled per-variant
      incomePositive: true,
      thirdLabel: 'Ср. ставка',
      thirdValue: '16,5%',
      variants: {
        now: {
          nowValue: '850 420',
          income: '+30 420',
          incomePct: '+3,7%',
          footText: '+8 420 ₽ уже начислено — получите при закрытии в конце срока',
        },
        pot: {
          nowValue: '858 840',
          income: '+38 840',
          incomePct: '+4,7%',
          footText: '+8 420 ₽ включено — выплачивается в дату закрытия вклада',
        },
      },
    },
    crypto: {
      tint: 'coral',
      icon: '#i-coin',
      eyebrow: 'Крипта',
      sub: '3 позиции · Binance',
      deltaAbs: '−12 400 ₽',
      deltaPct: '−4,8%',
      deltaPositive: false,
      invested: '260 000',
      incomePct: '−5,5%',
      incomePositive: false,
      thirdLabel: 'Позиций',
      thirdValue: '3',
      variants: {
        now: { nowValue: '245 800', income: '−14 200', footText: null },
        pot: { nowValue: '245 800', income: '−14 200', footText: null },
      },
    },
    other: {
      tint: 'grape',
      icon: '#i-diamond',
      eyebrow: 'Другое',
      sub: '2 позиции · Металлы, фонды',
      deltaAbs: '+13 400 ₽',
      deltaPct: '+5,5%',
      deltaPositive: true,
      invested: '244 000',
      incomePct: '+5,3%',
      incomePositive: true,
      thirdLabel: 'Позиций',
      thirdValue: '2',
      variants: {
        now: { nowValue: '257 000', income: '+13 000', footText: null },
        pot: { nowValue: '257 000', income: '+13 000', footText: null },
      },
    },
  };

  // ---- Elements -------------------------------------------------------------
  const app = document.querySelector('.app');
  const tabs = Array.from(document.querySelectorAll('.tabs__item'));
  const heroRows = Array.from(document.querySelectorAll('.hero__row[data-tab]'));
  const heroValue = document.getElementById('heroValue');
  const heroEyebrow = document.getElementById('heroEyebrow');
  const heroPotNote = document.getElementById('heroPotNote');
  const posSub = document.getElementById('posSub');
  const segtogOpts = Array.from(document.querySelectorAll('.segtog__opt'));

  const tsumCard      = document.getElementById('tsumCard');
  const tsumIco       = document.getElementById('tsumIco');
  const tsumIcoUse    = tsumIco?.querySelector('use');
  const tsumEyebrow   = document.getElementById('tsumEyebrow');
  const tsumSub       = document.getElementById('tsumSub');
  const tsumNowLabel  = document.getElementById('tsumNowLabel');
  const tsumNow       = document.getElementById('tsumNow');
  const tsumDelta     = document.getElementById('tsumDelta');
  const tsumDeltaAbs  = document.getElementById('tsumDeltaAbs');
  const tsumDeltaPct  = document.getElementById('tsumDeltaPct');
  const tsumSpark     = document.getElementById('tsumSpark');
  const tsumSparkUse  = tsumSpark?.querySelector('use');
  const tsumInvested  = document.getElementById('tsumInvested');
  const tsumIncome    = document.getElementById('tsumIncome');
  const tsumIncomePct = document.getElementById('tsumIncomePct');
  const tsumThirdLabel = document.getElementById('tsumThirdLabel');
  const tsumThirdValue = document.getElementById('tsumThirdValue');
  const tsumFoot      = document.getElementById('tsumFoot');
  const tsumFootText  = document.getElementById('tsumFootText');

  // State
  let activeTab = 'all';
  let mode = 'now'; // 'now' | 'pot'

  // ---- Swap numbers for mode ------------------------------------------------
  function applyMode() {
    // Hero total
    heroValue.classList.add('is-swapping');
    setTimeout(() => {
      heroValue.textContent = mode === 'now' ? HERO_SWAP.total.now : HERO_SWAP.total.pot;
      heroValue.classList.remove('is-swapping');
    }, 140);

    heroEyebrow.textContent = mode === 'now' ? 'Сейчас в портфеле' : 'Потенциал с доходом';
    heroPotNote.hidden = mode === 'now';

    // Hero row totals
    for (const code of ['security', 'deposit', 'crypto', 'other']) {
      const el = document.querySelector(`[data-hero-val='${code}']`);
      if (el && HERO_SWAP[code]) el.textContent = HERO_SWAP[code][mode === 'now' ? 'now' : 'pot'];
    }

    // Group totals + deltas
    for (const key of Object.keys(GROUP_SWAP)) {
      const el = document.querySelector(`[data-grp-total='${key}']`);
      if (el) el.innerHTML = `${GROUP_SWAP[key][mode === 'now' ? 'now' : 'pot']}<span class="ruble">₽</span>`;
    }
    for (const key of Object.keys(GROUP_DELTA_SWAP)) {
      const el = document.querySelector(`[data-grp-delta='${key}']`);
      if (el) el.textContent = GROUP_DELTA_SWAP[key][mode === 'now' ? 'now' : 'pot'];
    }

    // Per-position value + delta line
    for (const code of Object.keys(MODE_SWAP)) {
      const valEl = document.querySelector(`[data-pos='${code}']`);
      if (valEl) valEl.innerHTML = `${MODE_SWAP[code][mode === 'now' ? 'now' : 'pot']}<span class="ruble">₽</span>`;
      const deltaEl = document.querySelector(`[data-pos-delta='${code}']`);
      if (deltaEl) deltaEl.textContent = MODE_SWAP[code][mode === 'now' ? 'deltaNow' : 'deltaPot'];
    }

    // Re-paint summary card when a type is active
    if (activeTab !== 'all') paintTsum(activeTab);

    // Swap segtog active state
    segtogOpts.forEach((o) => {
      const on = (mode === 'now' && o.dataset.mode === 'now') || (mode === 'pot' && o.dataset.mode === 'potential');
      o.classList.toggle('segtog__opt--on', on);
      o.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  // ---- Paint type summary card ---------------------------------------------
  function paintTsum(tabKey) {
    const data = TYPE_DATA[tabKey];
    if (!data) return;
    const v = data.variants[mode === 'now' ? 'now' : 'pot'];

    tsumCard.hidden = false;
    tsumIco.setAttribute('data-tint', data.tint);
    if (tsumIcoUse) tsumIcoUse.setAttribute('href', data.icon);
    tsumEyebrow.textContent = data.eyebrow;
    tsumSub.textContent = data.sub;
    tsumNowLabel.textContent = mode === 'now' ? 'Сейчас' : 'С доходом';
    tsumNow.innerHTML = `${v.nowValue}<span class="ruble">₽</span>`;

    tsumDelta.classList.toggle('delta-pill--pos', data.deltaPositive);
    tsumDelta.classList.toggle('delta-pill--neg', !data.deltaPositive);
    const deltaUse = tsumDelta.querySelector('use');
    if (deltaUse) deltaUse.setAttribute('href', data.deltaPositive ? '#i-arrow-up-r' : '#i-arrow-down-r');
    tsumDeltaAbs.textContent = data.deltaAbs;
    tsumDeltaPct.textContent = data.deltaPct;

    if (tsumSparkUse) tsumSparkUse.setAttribute('href', data.deltaPositive ? '#i-sparkup' : '#i-sparkdn');
    tsumSpark.classList.toggle('is-neg', !data.deltaPositive);

    tsumInvested.innerHTML = `${data.invested}<span class="ruble">₽</span>`;
    tsumIncome.innerHTML = `${v.income}<span class="ruble">₽</span>`;
    tsumIncome.classList.toggle('tsum__cell-value--pos', data.incomePositive);
    tsumIncome.classList.toggle('tsum__cell-value--neg', !data.incomePositive);
    tsumIncomePct.textContent = v.incomePct ?? data.incomePct ?? '';

    tsumThirdLabel.textContent = data.thirdLabel;
    tsumThirdValue.textContent = data.thirdValue;

    if (v.footText) {
      tsumFoot.hidden = false;
      tsumFootText.textContent = v.footText;
    } else {
      tsumFoot.hidden = true;
    }

    // restart animation
    tsumCard.style.animation = 'none';
    // eslint-disable-next-line no-unused-expressions
    tsumCard.offsetHeight;
    tsumCard.style.animation = '';
  }

  // ---- Core: active tab -----------------------------------------------------
  function setActive(tabKey) {
    activeTab = tabKey || 'all';
    app.setAttribute('data-active', activeTab);

    tabs.forEach((t) => {
      const on = t.dataset.tab === activeTab;
      t.classList.toggle('tabs__item--on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    if (activeTab === 'all') {
      tsumCard.hidden = true;
      if (posSub) posSub.textContent = 'Сгруппированы по счёту и типу актива';
      return;
    }

    paintTsum(activeTab);
    const label = TYPE_DATA[activeTab]?.eyebrow.toLowerCase() ?? activeTab;
    if (posSub) posSub.textContent = `${label} — по счёту и подтипу`;
  }

  // ---- Bindings -------------------------------------------------------------
  tabs.forEach((t) => t.addEventListener('click', () => setActive(t.dataset.tab)));

  heroRows.forEach((r) => {
    const go = () => setActive(r.dataset.tab);
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });

  segtogOpts.forEach((o) => {
    o.addEventListener('click', () => {
      mode = o.dataset.mode === 'potential' ? 'pot' : 'now';
      applyMode();
    });
  });

  document.getElementById('newPositionBtn')?.addEventListener('click', () => {
    console.log('Open new-position dialog (stub)');
  });

  // ---- View switcher (Позиции | Операции | Аналитика) ---------------------
  const viewtogOpts = Array.from(document.querySelectorAll('.viewtog__opt'));
  const viewPanes   = Array.from(document.querySelectorAll('.view-pane'));

  function setView(viewKey) {
    viewtogOpts.forEach((o) => {
      const on = o.dataset.view === viewKey;
      o.classList.toggle('viewtog__opt--on', on);
      o.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    viewPanes.forEach((p) => {
      p.classList.toggle('view-pane--on', p.dataset.pane === viewKey);
    });
  }

  viewtogOpts.forEach((o) => {
    o.addEventListener('click', () => setView(o.dataset.view));
  });

  document.getElementById('opsShowAll')?.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('Navigate to full operations list (stub)');
  });
  document.getElementById('analShowAll')?.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('Navigate to full analytics (stub)');
  });

  // Init
  setActive('all');
  applyMode();
})();
