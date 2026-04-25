/* ============================================================
   Credits v1 — interaction layer (vanilla JS, no build)
   ============================================================ */

'use strict';

// === Mock data =============================================

const CREDITS = [
  {
    id: 1, kind: 'mortgage', name: 'Ипотека Сбербанк', bank: 'Сбербанк', bankTint: 'g',
    principal: 3200000, outstanding: 2450000, accruedInterest: 14200,
    rate: 12.4, paymentDay: 15, monthlyPayment: 42800,
    startDate: '2022-05-15', endDate: '2042-05-15',
    monthsPaid: 47, monthsTotal: 240,
    nextDate: '2026-05-15', currency: 'RUB',
  },
  {
    id: 2, kind: 'loan', name: 'Альфа Потребительский', bank: 'Альфа-Банк', bankTint: 'r',
    principal: 500000, outstanding: 185000, accruedInterest: 1500,
    rate: 18.9, paymentDay: 10, monthlyPayment: 18200,
    startDate: '2024-10-10', endDate: '2027-10-10',
    monthsPaid: 18, monthsTotal: 36,
    nextDate: '2026-05-10', currency: 'RUB',
  },
  {
    id: 3, kind: 'loan', name: 'Тинькофф Авто', bank: 'Тинькофф', bankTint: 'y',
    principal: 800000, outstanding: 420000, accruedInterest: 2800,
    rate: 14.5, paymentDay: 25, monthlyPayment: 22100,
    startDate: '2024-06-25', endDate: '2028-06-25',
    monthsPaid: 22, monthsTotal: 48,
    nextDate: '2026-04-25', currency: 'RUB',
  },
  {
    id: 4, kind: 'card', name: 'Тинькофф Платинум', bank: 'Тинькофф', bankTint: 'y',
    creditLimit: 300000, used: 124500, accruedInterest: 1100,
    rate: 24.9, graceDay: 18, nextDate: '2026-05-18', nextAmount: 8500,
    currency: 'RUB',
  },
  {
    id: 5, kind: 'card', name: 'Альфа 100 дней', bank: 'Альфа-Банк', bankTint: 'r',
    creditLimit: 200000, used: 0, accruedInterest: 0,
    rate: 23.8, graceDay: 25, currency: 'RUB',
  },
];

const CASH_ACCOUNTS = [
  { id: 101, name: 'Тинькофф · карта', ownerType: 'user' },
  { id: 102, name: 'Сбербанк · карта', ownerType: 'user' },
  { id: 103, name: 'Семейный счёт', ownerType: 'family' },
  { id: 104, name: 'ВТБ · карта', ownerType: 'user' },
];

const OPERATIONS = [
  { id: 1, kind: 'pay', creditId: 3, creditKind: 'loan', date: '2026-04-25', amount: 22100, title: 'Платёж по автокредиту', sub: 'Сбербанк · карта' },
  { id: 2, kind: 'pay', creditId: 1, creditKind: 'mortgage', date: '2026-04-15', amount: 42800, title: 'Платёж по ипотеке', sub: 'Сбербанк · карта' },
  { id: 3, kind: 'accrual', creditId: 1, creditKind: 'mortgage', date: '2026-04-11', amount: 25300, title: 'Начислены проценты', sub: 'Ипотека Сбербанк' },
  { id: 4, kind: 'pay', creditId: 2, creditKind: 'loan', date: '2026-04-10', amount: 18200, title: 'Платёж Альфа кредит', sub: 'Тинькофф · карта' },
  { id: 5, kind: 'purchase', creditId: 4, creditKind: 'card', date: '2026-04-08', amount: 4290, title: 'Покупка по карте', sub: 'Т-Платинум · кофейня' },
];

const KIND_LABEL  = { mortgage: 'Ипотека', loan: 'Кредит', card: 'Карта' };
const KIND_PLURAL = { mortgage: 'Ипотека', loan: 'Кредиты', card: 'Карты' };
const TODAY = '2026-04-25';

// === Format helpers ========================================

function formatRub(amount) {
  const rounded = Math.round(amount);
  return rounded.toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₽';
}
function formatRubBare(amount) {
  return Math.round(amount).toLocaleString('ru-RU').replace(/,/g, ' ');
}
const MONTHS_GEN   = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function formatDateLong(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}
function formatDateShort(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
function formatMonthYear(iso) {
  const d = new Date(iso);
  return `${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

// === Aggregates ============================================

function totalDebtOutstanding() {
  return CREDITS.reduce((s, c) => s + (c.kind === 'card' ? c.used : c.outstanding), 0);
}
function totalAccruedInterest() {
  return CREDITS.reduce((s, c) => s + (c.accruedInterest || 0), 0);
}
function debtByKind(kind) {
  return CREDITS
    .filter((c) => c.kind === kind)
    .reduce((s, c) => s + (c.kind === 'card' ? c.used : c.outstanding), 0);
}
function accruedByKind(kind) {
  return CREDITS
    .filter((c) => c.kind === kind)
    .reduce((s, c) => s + (c.accruedInterest || 0), 0);
}
function termTotalCommitted() {
  return CREDITS.filter((c) => c.kind !== 'card').reduce((s, c) => s + c.principal, 0);
}
function termTotalPaid() {
  return CREDITS.filter((c) => c.kind !== 'card').reduce((s, c) => s + (c.principal - c.outstanding), 0);
}

// === Theme toggle ==========================================

const $html = document.documentElement;
const THEME_KEY = 'credits-theme-v1';

function applyTheme(t) {
  $html.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0A0A0B' : '#EEF0F3');
}

(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
})();

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = $html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

// === Hero segtog (Остаток / С процентами) =================

const $heroValue    = document.getElementById('heroValue');
const $heroDeltaText = document.getElementById('heroDeltaText');
const $heroPotNote  = document.getElementById('heroPotNote');

function updateHeroForMode(mode) {
  const totalNow     = totalDebtOutstanding();
  const totalWithInt = totalNow + totalAccruedInterest();

  $heroValue.classList.add('is-swapping');
  setTimeout(() => {
    if (mode === 'now') {
      $heroValue.textContent = formatRubBare(totalNow);
      $heroDeltaText.textContent = 'Если бы вы погасили всё прямо сейчас';
      $heroPotNote.hidden = true;
    } else {
      $heroValue.textContent = formatRubBare(totalWithInt);
      $heroDeltaText.textContent = `+${formatRub(totalAccruedInterest())} начислено процентов`;
      $heroPotNote.hidden = false;
    }
    $heroValue.classList.remove('is-swapping');

    document.querySelectorAll('[data-hero-val]').forEach((el) => {
      const k    = el.dataset.heroVal;
      const base = debtByKind(k);
      const accr = accruedByKind(k);
      el.textContent = formatRub(mode === 'now' ? base : base + accr);
    });
  }, 100);
}

document.querySelectorAll('.segtog__opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.segtog__opt').forEach((b) => {
      b.classList.remove('segtog__opt--on');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('segtog__opt--on');
    btn.setAttribute('aria-selected', 'true');
    updateHeroForMode(btn.dataset.mode);
  });
});

// Initial hero values
(function initHeroValues() {
  $heroValue.textContent = formatRubBare(totalDebtOutstanding());
  document.querySelectorAll('[data-hero-val]').forEach((el) => {
    el.textContent = formatRub(debtByKind(el.dataset.heroVal));
  });
  const paid  = termTotalPaid();
  const total = termTotalCommitted();
  const pct   = total > 0 ? Math.round((paid / total) * 100) : 0;
  document.querySelector('.hero__progress-fill').style.width = `${pct}%`;
  document.querySelector('.hero__progress-value').innerHTML =
    `${formatRubBare(paid)} ₽ из ${formatRubBare(total)} ₽ · <strong>${pct}%</strong>`;
})();

// Hero rows → activate corresponding tab
document.querySelectorAll('.hero__row').forEach((row) => {
  const activate = () => setActiveTab(row.dataset.tab);
  row.addEventListener('click', activate);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
  });
});

// === Tabs ==================================================

let activeTab = 'all';

function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tabs__item').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('tabs__item--on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  renderCreditGroups();
  renderOps();
  renderAnalytics();
  // Update credits sub-label
  const count = CREDITS.filter((c) => activeTab === 'all' || c.kind === activeTab).length;
  const sub   = document.getElementById('creditsSub');
  if (sub) sub.textContent = `${count} активных`;
}

document.querySelectorAll('.tabs__item').forEach((b) => {
  b.addEventListener('click', () => setActiveTab(b.dataset.tab));
});

// === View switcher (Кредиты | Операции | Аналитика) ========

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

// === Render: credit groups + tiles =========================

const $creditGroups = document.getElementById('creditGroups');

function bankIcon(kind) {
  return { mortgage: 'i-house', loan: 'i-banknote', card: 'i-card' }[kind] || 'i-banknote';
}
function utilLevel(pct) {
  if (pct < 30) return 'low';
  if (pct < 70) return 'mid';
  return 'high';
}

function renderTermTile(c) {
  const debt = c.outstanding;
  const pct  = Math.round((c.monthsPaid / c.monthsTotal) * 100);
  const next = c.nextDate
    ? `<div class="tile__next">
        <span class="tile__next-date"><svg><use href="#i-calendar"/></svg>Следующий платёж · ${formatDateShort(c.nextDate)}</span>
        <strong>${formatRub(c.monthlyPayment)}</strong>
      </div>`
    : '';
  return `
    <button class="tile" data-credit-id="${c.id}" type="button">
      <div class="tile__head">
        <div class="tile__head-left">
          <span class="tile__bank" data-tint="${c.bankTint}">
            <svg><use href="#${bankIcon(c.kind)}"/></svg>${c.bank}
          </span>
          <div class="tile__name">${c.name}</div>
        </div>
        <div class="tile__amount">
          <div class="tile__debt">−${formatRub(debt)}</div>
          <div class="tile__debt-label">остаток долга</div>
        </div>
      </div>
      <div class="tile__meta">
        <span>${c.rate}% годовых</span>
        <span class="tile__meta-sep"></span>
        <span>${c.paymentDay}-го числа</span>
        <span class="tile__meta-sep"></span>
        <span>до ${formatMonthYear(c.endDate)}</span>
      </div>
      <div class="tile__progress">
        <div class="tile__progress-meta">
          <span class="tile__progress-text">${c.monthsPaid} из ${c.monthsTotal} платежей</span>
          <span class="tile__progress-pct">${pct}%</span>
        </div>
        <div class="tile__progress-bar">
          <div class="tile__progress-fill" style="width: ${pct}%"></div>
        </div>
      </div>
      ${next}
    </button>
  `;
}

function renderCardTile(c) {
  const usedPct = c.creditLimit > 0 ? Math.round((c.used / c.creditLimit) * 100) : 0;
  const lvl     = utilLevel(usedPct);
  const debt    = c.used;
  return `
    <button class="tile tile--card" data-credit-id="${c.id}" type="button">
      <div class="tile__head">
        <div class="tile__head-left">
          <span class="tile__bank" data-tint="${c.bankTint}">
            <svg><use href="#${bankIcon('card')}"/></svg>${c.bank}
          </span>
          <div class="tile__name">${c.name}</div>
        </div>
        <div class="tile__amount">
          <div class="tile__debt">${debt > 0 ? '−' : ''}${formatRub(debt)}</div>
          <div class="tile__debt-label">${debt > 0 ? 'использовано' : 'свободна'}</div>
        </div>
      </div>
      <div class="tile__util">
        <div class="tile__util-meta">
          <span class="tile__util-text"><strong>${formatRub(debt)}</strong> из ${formatRub(c.creditLimit)}</span>
          <span class="tile__util-text"><strong>${usedPct}%</strong></span>
        </div>
        <div class="tile__util-bar">
          <div class="tile__util-fill tile__util-fill--${lvl}" style="width: ${Math.max(2, usedPct)}%"></div>
        </div>
      </div>
      <div class="tile__meta">
        <span>${c.rate}% годовых</span>
        <span class="tile__meta-sep"></span>
        <span>льгота до ${c.graceDay}-го</span>
      </div>
    </button>
  `;
}

function renderCreditGroups() {
  const visibleKinds = activeTab === 'all' ? ['mortgage', 'loan', 'card'] : [activeTab];

  const html = visibleKinds.map((kind) => {
    const items = CREDITS.filter((c) => c.kind === kind);
    if (items.length === 0) return '';
    return `
      <div class="credit-group">
        <div class="credit-group__head">
          <span class="credit-group__title">${KIND_PLURAL[kind]}</span>
          <span class="credit-group__count">${items.length}</span>
        </div>
        <div class="credit-list">
          ${items.map((c) => kind === 'card' ? renderCardTile(c) : renderTermTile(c)).join('')}
        </div>
      </div>
    `;
  }).join('');

  if (!html) {
    $creditGroups.innerHTML = `<div class="empty"><strong>Кредитов этого типа нет</strong>Сменить фильтр или создать новый.</div>`;
    return;
  }
  $creditGroups.innerHTML = html;

  $creditGroups.querySelectorAll('.tile').forEach((el) => {
    el.addEventListener('click', () => openDetail(Number(el.dataset.creditId)));
  });
}

renderCreditGroups();

// === Render: operations ====================================

const $opsList = document.getElementById('opsList');

function opIconId(kind) {
  return { pay: 'i-arrow-down-r', accrual: 'i-percent', purchase: 'i-cart' }[kind] || 'i-arrow-down-r';
}
function opAmountClass(kind) {
  return { pay: 'op__amount--pos', accrual: 'op__amount--neg', purchase: 'op__amount--ink' }[kind] || 'op__amount--ink';
}
function opAmountSign(kind, amount) {
  if (kind === 'pay')      return `−${formatRub(amount)}`;
  if (kind === 'accrual')  return `+${formatRub(amount)}`;
  return formatRub(amount);
}

function renderOps() {
  const filtered = activeTab === 'all'
    ? OPERATIONS
    : OPERATIONS.filter((o) => o.creditKind === activeTab);

  const sub = document.getElementById('opsSub');
  if (sub) sub.textContent = activeTab === 'all'
    ? 'Кредитные счета · 30 дней'
    : `${KIND_PLURAL[activeTab]} · 30 дней`;

  if (filtered.length === 0) {
    $opsList.innerHTML = `<div class="empty"><strong>Операций нет</strong>Они появятся после первых платежей.</div>`;
    return;
  }

  $opsList.innerHTML = filtered.slice(0, 5).map((op) => `
    <div class="op">
      <div class="op__chip" data-kind="${op.kind}">
        <svg><use href="#${opIconId(op.kind)}"/></svg>
      </div>
      <div class="op__main">
        <div class="op__title">${op.title}</div>
        <div class="op__sub">${formatDateShort(op.date)} · ${op.sub}</div>
      </div>
      <div class="op__amount ${opAmountClass(op.kind)}">${opAmountSign(op.kind, op.amount)}</div>
    </div>
  `).join('');
}

renderOps();

// === Render: analytics =====================================

const $analyticsBlock = document.getElementById('analyticsBlock');

function renderAnalytics() {
  const filtered = activeTab === 'all' ? CREDITS : CREDITS.filter((c) => c.kind === activeTab);

  const analSub = document.getElementById('analSub');
  if (analSub) analSub.textContent = activeTab === 'all'
    ? 'Долговой портфель · 2026'
    : `${KIND_PLURAL[activeTab]} · 2026`;

  if (filtered.length === 0) {
    $analyticsBlock.innerHTML = '';
    return;
  }

  const interestYtd = activeTab === 'all'
    ? 84200
    : Math.round(84200 * filtered.length / CREDITS.length);

  const totalDebtFiltered = filtered.reduce((s, c) => s + (c.kind === 'card' ? c.used : c.outstanding), 0);
  const weightedRate = filtered.reduce((s, c) => {
    const w = c.kind === 'card' ? c.used : c.outstanding;
    return s + (c.rate * w);
  }, 0);
  const avgRate = totalDebtFiltered > 0 ? (weightedRate / totalDebtFiltered).toFixed(1) : '—';

  const monthly = filtered
    .filter((c) => c.kind !== 'card')
    .reduce((s, c) => s + c.monthlyPayment, 0);

  const termCredits = filtered.filter((c) => c.kind !== 'card');
  let maxEnd = null;
  termCredits.forEach((c) => { if (!maxEnd || c.endDate > maxEnd) maxEnd = c.endDate; });
  const monthsLeft = maxEnd ? monthsBetween(TODAY, maxEnd) : null;

  const futurePrincipal = filtered.reduce((s, c) => s + (c.kind === 'card' ? c.used : c.outstanding), 0);
  const futureInterest  = termCredits.reduce((s, c) => {
    const monthsRemaining = c.monthsTotal - c.monthsPaid;
    const totalToPay = c.monthlyPayment * monthsRemaining;
    return s + Math.max(0, totalToPay - c.outstanding);
  }, 0);
  const totalFuture  = futurePrincipal + futureInterest;
  const principalPct = totalFuture > 0 ? Math.round((futurePrincipal / totalFuture) * 100) : 0;
  const interestPct  = 100 - principalPct;

  $analyticsBlock.innerHTML = `
    <div class="analytics__grid">
      <div class="metric">
        <span class="metric__label">Заплачено процентов</span>
        <span class="metric__value">${formatRub(interestYtd)}</span>
        <span class="metric__sub">с начала года</span>
      </div>
      <div class="metric">
        <span class="metric__label">Средняя ставка</span>
        <span class="metric__value">${avgRate}%</span>
        <span class="metric__sub">взвешенная по долгу</span>
      </div>
      <div class="metric">
        <span class="metric__label">Платёж в месяц</span>
        <span class="metric__value">${formatRub(monthly)}</span>
        <span class="metric__sub">плановый по графику</span>
      </div>
      <div class="metric">
        <span class="metric__label">До конца долга</span>
        <span class="metric__value">${monthsLeft != null ? formatYearsMonths(monthsLeft) : '—'}</span>
        <span class="metric__sub">${maxEnd ? `до ${formatMonthYear(maxEnd)}` : 'нет срочных'}</span>
      </div>
    </div>
    <div class="analytics__split">
      <div class="analytics__split-head">
        <span class="analytics__split-title">Осталось выплатить</span>
        <span class="analytics__split-total">${formatRub(totalFuture)}</span>
      </div>
      <div class="analytics__split-bar" role="img" aria-label="Тело и проценты">
        <div class="analytics__split-seg analytics__split-seg--principal" style="width: ${principalPct}%"></div>
        <div class="analytics__split-seg analytics__split-seg--interest" style="width: ${interestPct}%"></div>
      </div>
      <div class="analytics__split-legend">
        <span><i data-kind="principal"></i>Тело <strong>${formatRub(futurePrincipal)}</strong></span>
        <span><i data-kind="interest"></i>Проценты <strong>${formatRub(futureInterest)}</strong></span>
      </div>
    </div>
  `;
}

function monthsBetween(isoStart, isoEnd) {
  const a = new Date(isoStart);
  const b = new Date(isoEnd);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
function formatYearsMonths(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} мес`;
  if (m === 0) return `${y} ${pluralYears(y)}`;
  return `${y} ${pluralYears(y)} ${m} мес`;
}
function pluralYears(n) {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return 'лет';
  if (last === 1) return 'год';
  if (last >= 2 && last <= 4) return 'года';
  return 'лет';
}

renderAnalytics();

// === Sheet system ==========================================

const $backdrop   = document.getElementById('sheetBackdrop');
const sheetStack  = [];

function openSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  sheet.hidden = false;
  if (sheetStack.length === 0) {
    $backdrop.hidden = false;
    requestAnimationFrame(() => $backdrop.classList.add('is-on'));
  }
  requestAnimationFrame(() => sheet.classList.add('is-on'));
  sheetStack.push(id);
}

function closeSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  sheet.classList.remove('is-on');
  setTimeout(() => { sheet.hidden = true; }, 320);
  const idx = sheetStack.indexOf(id);
  if (idx >= 0) sheetStack.splice(idx, 1);
  if (sheetStack.length === 0) {
    $backdrop.classList.remove('is-on');
    setTimeout(() => { $backdrop.hidden = true; }, 250);
  }
}

function closeTopSheet() {
  if (sheetStack.length === 0) return;
  closeSheet(sheetStack[sheetStack.length - 1]);
}

document.querySelectorAll('[data-sheet-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeSheet(btn.dataset.sheetClose));
});
$backdrop.addEventListener('click', closeTopSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopSheet(); });

// === Detail sheet ==========================================

let currentDetailId = null;

function openDetail(id) {
  const c = CREDITS.find((x) => x.id === id);
  if (!c) return;
  currentDetailId = id;

  document.getElementById('detailEyebrow').textContent = KIND_LABEL[c.kind];
  document.getElementById('detailTitle').textContent   = c.name;
  document.getElementById('detailBank').textContent    = c.bank;

  const isTerm    = c.kind !== 'card';
  const debtNow   = isTerm ? c.outstanding : c.used;
  const debtWithInt = debtNow + (c.accruedInterest || 0);

  document.getElementById('detailStats').innerHTML = `
    <div class="dstats__cell">
      <span class="dstats__label">Остаток</span>
      <span class="dstats__value">${formatRub(debtNow)}</span>
      <span class="dstats__sub">${isTerm ? 'основной долг' : 'использовано'}</span>
    </div>
    <div class="dstats__cell">
      <span class="dstats__label">Проценты</span>
      <span class="dstats__value">${formatRub(c.accruedInterest || 0)}</span>
      <span class="dstats__sub">начислено сегодня</span>
    </div>
    <div class="dstats__cell">
      <span class="dstats__label">К оплате</span>
      <span class="dstats__value">${formatRub(debtWithInt)}</span>
      <span class="dstats__sub">если закрыть</span>
    </div>
  `;

  const $next = document.getElementById('detailNext');
  if (isTerm && c.nextDate) {
    const interestPart  = Math.round(c.monthlyPayment * 0.65);
    const principalPart = c.monthlyPayment - interestPart;
    $next.hidden = false;
    $next.innerHTML = `
      <div>
        <div class="dnext__label">Следующий платёж</div>
        <div class="dnext__date">${formatDateLong(c.nextDate)}</div>
        <div class="dnext__split">${formatRub(interestPart)} проценты · ${formatRub(principalPart)} тело</div>
      </div>
      <div class="dnext__amount">${formatRub(c.monthlyPayment)}</div>
    `;
  } else if (!isTerm && c.nextAmount) {
    $next.hidden = false;
    $next.innerHTML = `
      <div>
        <div class="dnext__label">Минимальный платёж</div>
        <div class="dnext__date">до ${c.graceDay}-го · ${formatMonthYear(c.nextDate)}</div>
      </div>
      <div class="dnext__amount">${formatRub(c.nextAmount)}</div>
    `;
  } else {
    $next.hidden = true;
  }

  const $util = document.getElementById('detailUtil');
  if (!isTerm) {
    const usedPct = c.creditLimit > 0 ? Math.round((c.used / c.creditLimit) * 100) : 0;
    const free    = c.creditLimit - c.used;
    const lvl     = utilLevel(usedPct);
    $util.hidden = false;
    $util.innerHTML = `
      <div class="dutil__head">
        <span class="dutil__title">Лимит карты</span>
        <span class="dutil__pct">${usedPct}%</span>
      </div>
      <div class="dutil__bar">
        <div class="dutil__fill dutil__fill--${lvl}" style="width: ${Math.max(2, usedPct)}%"></div>
      </div>
      <div class="dutil__legend">Использовано <strong>${formatRub(c.used)}</strong> · доступно <strong>${formatRub(free)}</strong> из <strong>${formatRub(c.creditLimit)}</strong></div>
    `;
  } else {
    $util.hidden = true;
  }

  const cond = document.getElementById('detailCondList');
  const rows = [];
  rows.push(['Ставка', `${c.rate}% годовых`]);
  if (isTerm) {
    rows.push(['День платежа', `${c.paymentDay}-е число`]);
    rows.push(['Срок', `${formatDateShort(c.startDate)} ${new Date(c.startDate).getFullYear()} — ${formatDateShort(c.endDate)} ${new Date(c.endDate).getFullYear()}`]);
    rows.push(['Платежей', `${c.monthsPaid} из ${c.monthsTotal}`]);
  } else {
    rows.push(['Льготный период', `до ${c.graceDay}-го числа`]);
    rows.push(['Лимит', formatRub(c.creditLimit)]);
  }
  rows.push(['Банк', c.bank]);
  cond.innerHTML = rows.map(([k, v]) => `
    <div class="dcond__row">
      <span class="dcond__row-label">${k}</span>
      <span class="dcond__row-value">${v}</span>
    </div>
  `).join('');

  document.getElementById('actTransfer').hidden = c.kind !== 'card' || c.creditLimit - c.used <= 0;
  document.getElementById('actSchedule').hidden = !isTerm;
  document.getElementById('actArchive').hidden  = !(debtNow === 0 && c.kind !== 'card');

  const $hint = document.getElementById('detailHint');
  if (isTerm && (!c.rate || !c.paymentDay || !c.endDate)) {
    const missing = [];
    if (!c.rate) missing.push('ставку');
    if (!c.paymentDay) missing.push('день платежа');
    if (!c.endDate) missing.push('дату окончания');
    $hint.hidden = false;
    $hint.textContent = `Заполни ${missing.join(', ')} — появится график платежей.`;
  } else {
    $hint.hidden = true;
  }

  openSheet('detailSheet');
}

document.getElementById('actRepay').addEventListener('click', () => openRepay(currentDetailId));
document.getElementById('actTransfer').addEventListener('click', () => openTransfer(currentDetailId));
document.getElementById('actSchedule').addEventListener('click', () => openSchedule(currentDetailId));
document.getElementById('actArchive').addEventListener('click', () => {
  showToast('Кредит перенесён в архив');
  closeSheet('detailSheet');
});
document.getElementById('detailEditToggle').addEventListener('click', () => {
  showToast('Редактирование условий — в полной версии');
});

// === Schedule sheet =========================================

let scheduleCache = {};
let activeYear    = null;

function buildSchedule(c) {
  if (scheduleCache[c.id]) return scheduleCache[c.id];
  const items = [];
  let outstanding   = c.principal;
  const monthlyRate = c.rate / 100 / 12;
  const startDate   = new Date(c.startDate);

  for (let i = 0; i < c.monthsTotal; i++) {
    const dt = new Date(startDate);
    dt.setMonth(dt.getMonth() + i + 1);
    const interest  = outstanding * monthlyRate;
    const principal = Math.min(outstanding, c.monthlyPayment - interest);
    const total     = principal + interest;
    outstanding     = Math.max(0, outstanding - principal);
    const status    = i < c.monthsPaid ? 'paid' : i === c.monthsPaid ? 'next' : 'plan';
    items.push({ date: dt.toISOString().slice(0, 10), year: dt.getFullYear(), principal, interest, total, remaining: outstanding, status });
  }
  scheduleCache[c.id] = items;
  return items;
}

function openSchedule(id) {
  const c = CREDITS.find((x) => x.id === id);
  if (!c || c.kind === 'card') return;
  document.getElementById('scheduleTitle').textContent = c.name;
  const items = buildSchedule(c);
  const years = Array.from(new Set(items.map((it) => it.year))).sort((a, b) => a - b);
  const currentYear = new Date(TODAY).getFullYear();
  const nextItem    = items.find((it) => it.status === 'next');
  activeYear = years.includes(currentYear) ? currentYear : (nextItem ? nextItem.year : years[0]);
  renderScheduleYears(years);
  renderScheduleList(items);
  openSheet('scheduleSheet');
}

function renderScheduleYears(years) {
  const $years = document.getElementById('scheduleYears');
  $years.innerHTML = years.map((y) => `
    <button class="schedule-years__pill ${y === activeYear ? 'schedule-years__pill--on' : ''}" data-year="${y}" type="button">${y}</button>
  `).join('');
  $years.querySelectorAll('.schedule-years__pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeYear = Number(btn.dataset.year);
      renderScheduleYears(years);
      const c = CREDITS.find((x) => x.id === currentDetailId);
      if (c) renderScheduleList(scheduleCache[c.id]);
    });
  });
  const active = $years.querySelector('.schedule-years__pill--on');
  if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function renderScheduleList(items) {
  const filtered = items.filter((it) => it.year === activeYear);
  const $list    = document.getElementById('scheduleList');
  $list.innerHTML = filtered.map((it) => {
    const principalPct  = (it.principal / it.total) * 100;
    const interestPct   = 100 - principalPct;
    const statusLabel   = { paid: 'Оплачено', next: 'Следующий', plan: 'План' }[it.status];
    return `
      <div class="sch-item sch-item--${it.status}">
        <div class="sch-item__head">
          <div class="sch-item__date">
            ${formatDateShort(it.date)}
            <span>остаток ${formatRub(it.remaining)}</span>
          </div>
          <div class="sch-item__total">${formatRub(it.total)}</div>
        </div>
        <div class="sch-item__bar">
          <div class="sch-item__bar-seg sch-item__bar-seg--principal" style="width: ${principalPct}%"></div>
          <div class="sch-item__bar-seg sch-item__bar-seg--interest" style="width: ${interestPct}%"></div>
        </div>
        <div class="sch-item__breakdown">
          <span>Тело <strong>${formatRub(it.principal)}</strong></span>
          <span>Проценты <strong>${formatRub(it.interest)}</strong></span>
          <span class="sch-item__status sch-item__status--${it.status}">${statusLabel}</span>
        </div>
      </div>
    `;
  }).join('');
}

// === Repay sheet ============================================

function fillCashAccountSelect(selectId) {
  const $sel = document.getElementById(selectId);
  $sel.innerHTML = CASH_ACCOUNTS.map((a) =>
    `<option value="${a.id}">${a.ownerType === 'family' ? 'Семейный' : 'Личный'} · ${a.name}</option>`
  ).join('');
}

function openRepay(id) {
  const c = CREDITS.find((x) => x.id === id);
  if (!c) return;
  document.getElementById('repayTitle').textContent = c.name;
  document.getElementById('repayAmount').value  = '';
  document.getElementById('repayComment').value = '';
  document.getElementById('repayDate').value    = TODAY;
  fillCashAccountSelect('repayFromAccount');
  const isTerm = c.kind !== 'card';
  document.getElementById('repayDateField').hidden = !isTerm;
  document.getElementById('repayHint').textContent = isTerm
    ? 'Платёж сначала покроет начисленные проценты, остаток уменьшит основной долг.'
    : 'Сумма уменьшит использованный лимит карты.';
  openSheet('repaySheet');
}

document.getElementById('repaySubmit').addEventListener('click', () => {
  const amount = document.getElementById('repayAmount').value.trim();
  if (!amount) { document.getElementById('repayAmount').focus(); return; }
  showToast(`Погашение принято · ${amount.replace(/[^\d.,]/g, '')} ₽`);
  closeSheet('repaySheet');
  closeSheet('detailSheet');
});

// === Transfer sheet =========================================

function openTransfer(id) {
  const c = CREDITS.find((x) => x.id === id);
  if (!c || c.kind !== 'card') return;
  document.getElementById('transferTitle').textContent  = c.name;
  document.getElementById('transferAmount').value  = '';
  document.getElementById('transferComment').value = '';
  fillCashAccountSelect('transferToAccount');
  const free = c.creditLimit - c.used;
  document.getElementById('transferLimitHint').textContent = `Доступный лимит: ${formatRub(free)}`;
  openSheet('transferSheet');
}

document.getElementById('transferSubmit').addEventListener('click', () => {
  const amount = document.getElementById('transferAmount').value.trim();
  if (!amount) { document.getElementById('transferAmount').focus(); return; }
  showToast(`Перевод выполнен · ${amount.replace(/[^\d.,]/g, '')} ₽`);
  closeSheet('transferSheet');
  closeSheet('detailSheet');
});

// === New credit sheet =======================================

let newKind = 'mortgage';

document.getElementById('newCreditBtn').addEventListener('click', () => {
  newKind = 'mortgage';
  document.querySelectorAll('#newKindSeg .seg__opt').forEach((b) => {
    b.classList.toggle('seg__opt--on', b.dataset.kind === newKind);
  });
  document.getElementById('newName').value  = '';
  document.getElementById('newBank').value  = '';
  document.getElementById('newLimit').value = '';
  document.getElementById('newRate').value  = '';
  document.getElementById('newDay').value   = '';
  document.getElementById('newStart').value = '';
  document.getElementById('newEnd').value   = '';
  fillCashAccountSelect('newTargetAccount');
  applyNewKindUI();
  openSheet('newCreditSheet');
});

function applyNewKindUI() {
  const isCard = newKind === 'card';
  document.getElementById('newDates').hidden       = isCard;
  document.getElementById('newTargetField').hidden = isCard;
  document.getElementById('newLimitLabel').textContent = isCard ? 'Кредитный лимит' : 'Сумма кредита';
}

document.querySelectorAll('#newKindSeg .seg__opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    newKind = btn.dataset.kind;
    document.querySelectorAll('#newKindSeg .seg__opt').forEach((b) => {
      b.classList.toggle('seg__opt--on', b.dataset.kind === newKind);
    });
    applyNewKindUI();
  });
});

document.getElementById('newSubmit').addEventListener('click', () => {
  const name = document.getElementById('newName').value.trim();
  if (!name) { document.getElementById('newName').focus(); return; }
  showToast(`${KIND_LABEL[newKind]} «${name}» создан${newKind === 'card' ? 'а' : ''}`);
  closeSheet('newCreditSheet');
});

// === Toast ==================================================

let toastTimer = null;
function showToast(text) {
  const $toast = document.getElementById('toast');
  $toast.textContent = text;
  $toast.hidden = false;
  requestAnimationFrame(() => $toast.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $toast.classList.remove('is-on');
    setTimeout(() => { $toast.hidden = true; }, 250);
  }, 2400);
}
