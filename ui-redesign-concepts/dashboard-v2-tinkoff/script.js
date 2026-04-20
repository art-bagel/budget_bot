/* Budget dashboard concept v2 (Tinkoff-leaning) — interactive glue */

(() => {
  const root = document.documentElement;
  const STORE_KEY = 'budget-theme-v2';

  /* ── Theme ─────────────────────────────────────────────── */
  const savedTheme = localStorage.getItem(STORE_KEY);
  if (savedTheme === 'dark' || savedTheme === 'light') {
    root.setAttribute('data-theme', savedTheme);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.setAttribute('data-theme', 'dark');
  }

  const themeBtn = document.getElementById('themeToggle');
  themeBtn?.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem(STORE_KEY, next);
  });

  /* ── Credits toggle on hero ────────────────────────────── */
  const creditsBtn = document.getElementById('creditsToggle');
  const heroValue = document.getElementById('heroValue');
  const creditsRow = document.getElementById('creditsRow');
  const TOTAL_WITH_CREDITS = '2 647 300';
  const TOTAL_WITHOUT = '2 827 300';

  creditsBtn?.addEventListener('click', () => {
    const on = creditsBtn.classList.toggle('chiptog--on');
    const glyph = creditsBtn.querySelector('.chiptog__glyph');
    if (glyph) glyph.textContent = on ? '−' : '+';
    if (heroValue) {
      heroValue.style.transform = 'translateY(2px)';
      heroValue.style.opacity = '.55';
      setTimeout(() => {
        heroValue.textContent = on ? TOTAL_WITH_CREDITS : TOTAL_WITHOUT;
        heroValue.style.transform = '';
        heroValue.style.opacity = '';
      }, 130);
    }
    if (creditsRow) creditsRow.style.opacity = on ? '1' : '.4';
  });

  /* ── Bottom sheets ─────────────────────────────────────── */
  const sheetRoot = document.getElementById('sheetRoot');
  const sheets = {
    category: document.getElementById('sheet-category'),
    group: document.getElementById('sheet-group'),
    income: document.getElementById('sheet-income'),
    transfer: document.getElementById('sheet-transfer'),
    account: document.getElementById('sheet-account'),
    'account-transfer': document.getElementById('sheet-account-transfer'),
    analytics: document.getElementById('sheet-analytics'),
    operations: document.getElementById('sheet-operations'),
    'op-detail': document.getElementById('sheet-op-detail'),
  };

  const openSheet = (key, meta) => {
    if (!sheets[key]) return;
    Object.values(sheets).forEach((s) => s?.removeAttribute('data-visible'));
    sheets[key].setAttribute('data-visible', '');
    sheetRoot?.setAttribute('data-open', '');
    sheetRoot?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (meta && key === 'category') populateCategorySheet(meta);
    if (meta && key === 'group') populateGroupSheet(meta);
    if (meta && key === 'account') populateAccountSheet(meta);
    if (meta && key === 'op-detail') populateOpDetail(meta);
  };

  const closeSheets = () => {
    Object.values(sheets).forEach((s) => s?.removeAttribute('data-visible'));
    sheetRoot?.removeAttribute('data-open');
    sheetRoot?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  sheetRoot?.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.hasAttribute('data-close') || t.closest('[data-close]')) closeSheets();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheets();
  });

  document.querySelectorAll('[data-sheet]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.getAttribute('data-sheet');
      if (key) openSheet(key);
    });
  });

  /* ── Category tile → category sheet ───────────────────── */
  /* tint letters match CSS: g (green), o (orange), b (blue), p (purple), r (rose), v (violet), yel (yellow) */
  const CAT_DATA = {
    grocery:      { name: 'Продукты',          amt: '8 400',   ico: '#i-cart',    tint: 'g', grp: 'В группе «Питание» · 70%' },
    cafe:         { name: 'Кафе и рестораны',  amt: '4 200',   ico: '#i-cup',     tint: 'o', grp: 'В группе «Питание» · 30%' },
    transport:    { name: 'Транспорт',         amt: '12 800',  ico: '#i-car',     tint: 'b', grp: 'Не входит в группу' },
    utilities:    { name: 'Коммуналка',        amt: '22 500',  ico: '#i-bolt',    tint: 'p', grp: 'В группе «Обязательные платежи» · 40%' },
    clothes:      { name: 'Одежда',            amt: '15 600',  ico: '#i-shirt',   tint: 'r', grp: 'Не входит в группу' },
    gifts:        { name: 'Подарки',           amt: '2 400',   ico: '#i-gift',    tint: 'v', grp: 'Осталось немного' },
    health:       { name: 'Здоровье',          amt: '18 200',  ico: '#i-heart',   tint: 'g', grp: 'Не входит в группу' },
    fun:          { name: 'Развлечения',       amt: '6 500',   ico: '#i-ticket',  tint: 'o', grp: 'В группе «Семейные расходы» · 40%' },
    travel:       { name: 'Путешествия',       amt: '54 000',  ico: '#i-plane',   tint: 'b', grp: 'Не входит в группу' },
    repair:       { name: 'Ремонт',            amt: '850',     ico: '#i-wrench',  tint: 'r', grp: 'Перерасход близко — пополните' },
    'fam-grocery':{ name: 'Продукты (семья)',  amt: '24 800',  ico: '#i-cart',    tint: 'g', grp: 'Семейная категория' },
    'fam-school': { name: 'Школа',             amt: '12 400',  ico: '#i-book',    tint: 'b', grp: 'В группе «Семейные расходы» · 40%' },
    'fam-pets':   { name: 'Питомцы',           amt: '−1 250',  ico: '#i-paw',     tint: 'r', grp: 'Перерасход — пополните срочно' },
    'fam-hobby':  { name: 'Хобби',             amt: '8 900',   ico: '#i-palette', tint: 'v', grp: 'Семейная категория' },
  };

  function populateCategorySheet(catKey) {
    const sheet = sheets.category;
    const data = CAT_DATA[catKey];
    if (!sheet || !data) return;
    const title = sheet.querySelector('#sheetCategoryTitle');
    const icoBox = sheet.querySelector('.sheet__head-left .sheet-ico');
    const icoUse = icoBox?.querySelector('use');
    const valEl = sheet.querySelector('.sheet-stat__val');
    const chip = sheet.querySelector('.sheet-stat__meta .ghost-chip');
    if (title) title.textContent = data.name;
    if (icoBox) icoBox.className = `sheet-ico sheet-ico--${data.tint}`;
    if (icoUse) icoUse.setAttribute('href', data.ico);
    if (valEl) valEl.textContent = data.amt;
    if (chip) chip.textContent = data.grp;
  }

  document.querySelectorAll('.cat[data-cat]').forEach((tile) => {
    tile.addEventListener('click', () => {
      const key = tile.getAttribute('data-cat');
      if (key) openSheet('category', key);
    });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const key = tile.getAttribute('data-cat');
        if (key) openSheet('category', key);
      }
    });
  });

  /* ── Group tile → group distribution sheet ─────────────── */
  const GROUP_DATA = {
    mandatory: {
      name: 'Обязательные платежи',
      source: { name: 'Свободный остаток (личный)', avail: 42300 },
      ico: '#i-bolt', tint: 'p',
      cats: [
        { name: 'Коммуналка', pct: 40 },
        { name: 'Страховка',  pct: 30 },
        { name: 'Интернет',   pct: 20 },
        { name: 'Связь',      pct: 10 },
      ],
    },
    food: {
      name: 'Питание',
      source: { name: 'Свободный остаток (личный)', avail: 42300 },
      ico: '#i-cart', tint: 'g',
      cats: [
        { name: 'Продукты', pct: 70 },
        { name: 'Кафе',     pct: 30 },
      ],
    },
    family: {
      name: 'Семейные расходы',
      tag: 'Семейная группа',
      source: { name: 'Свободный остаток (семейный)', avail: 58600 },
      ico: '#i-heart', tint: 'o',
      cats: [
        { name: 'Школа',       pct: 40 },
        { name: 'Развлечения', pct: 40 },
        { name: 'Питомцы',     pct: 20 },
      ],
    },
  };

  const fmtRub = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');
  const parseRub = (s) => {
    const cleaned = String(s || '').replace(/[^\d.,]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  function populateGroupSheet(key) {
    const sheet = sheets.group;
    const data = GROUP_DATA[key];
    if (!sheet || !data) return;

    const title = sheet.querySelector('#sheetGroupTitle');
    const tag = sheet.querySelector('#sheetGroupTag');
    const icoBox = sheet.querySelector('#sheetGroupIco');
    const icoUse = icoBox?.querySelector('use');
    const srcName = sheet.querySelector('#sheetGroupSrcName');
    const srcSub = sheet.querySelector('#sheetGroupSrcSub');
    const barEl = sheet.querySelector('#sheetGroupBar');
    const listEl = sheet.querySelector('#sheetGroupList');
    const totalEl = sheet.querySelector('#sheetGroupTotalPct');
    const amtInput = sheet.querySelector('#sheetGroupAmt');
    const confirm = sheet.querySelector('#sheetGroupConfirm');

    if (title) title.textContent = data.name;
    if (tag) tag.textContent = data.tag || 'Группа';
    if (icoBox) icoBox.className = `sheet-ico sheet-ico--${data.tint}`;
    if (icoUse) icoUse.setAttribute('href', data.ico);
    if (srcName) srcName.textContent = data.source.name;
    if (srcSub) srcSub.textContent = `Доступно ${fmtRub(data.source.avail)} ₽`;

    if (barEl) {
      barEl.innerHTML = data.cats
        .map((c, i) => `<span class="grp-bar__seg grp-bar__seg--${i + 1}" style="--w:${c.pct}%"></span>`)
        .join('');
    }

    const totalPct = data.cats.reduce((s, c) => s + c.pct, 0);
    if (totalEl) totalEl.textContent = `${totalPct}%`;

    if (listEl) {
      listEl.innerHTML = data.cats
        .map((c, i) => (
          `<li class="grp-row" data-idx="${i}">` +
            `<span class="grp-row__dot grp-row__dot--${i + 1}"></span>` +
            `<div><span class="grp-row__name">${c.name}</span><span class="grp-row__pct">· ${c.pct}%</span></div>` +
            `<span class="grp-row__amt" data-amt><span>₽</span></span>` +
          `</li>`
        ))
        .join('');
    }

    const recalc = () => {
      const sum = parseRub(amtInput?.value);
      const rows = listEl?.querySelectorAll('.grp-row') || [];
      rows.forEach((row, i) => {
        const pct = data.cats[i].pct;
        const amt = sum * pct / 100;
        const amtEl = row.querySelector('[data-amt]');
        if (!amtEl) return;
        amtEl.classList.toggle('grp-row__amt--active', sum > 0);
        amtEl.innerHTML = (sum > 0 ? fmtRub(amt) : '—') + '<span>₽</span>';
      });
      if (confirm) {
        const overflow = sum > data.source.avail;
        confirm.disabled = sum <= 0 || overflow;
        confirm.textContent = overflow ? 'Недостаточно средств' : 'Распределить';
      }
    };

    if (amtInput) {
      amtInput.value = '';
      amtInput.oninput = (e) => {
        const raw = e.target.value.replace(/[^\d]/g, '');
        e.target.value = raw ? Number(raw).toLocaleString('ru-RU').replace(/,/g, ' ') : '';
        recalc();
      };
      setTimeout(() => amtInput.focus(), 250);
    }
    recalc();
  }

  document.querySelectorAll('.group[data-group]').forEach((tile) => {
    const open = () => {
      const key = tile.getAttribute('data-group');
      if (key) openSheet('group', key);
    };
    tile.addEventListener('click', open);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  document.getElementById('sheetGroupConfirm')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!(btn instanceof HTMLElement) || btn.hasAttribute('disabled')) return;
    btn.animate(
      [{ transform: 'scale(.97)' }, { transform: 'scale(1)' }],
      { duration: 160, easing: 'cubic-bezier(.2, 1.35, .4, 1)' }
    );
    setTimeout(closeSheets, 180);
  });

  /* ── Category & account actions ─────────────────────────── */
  document.querySelectorAll('.cat-act[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const action = btn.getAttribute('data-action');
      if (action === 'transfer') {
        e.stopPropagation();
        openSheet('transfer');
        return;
      }
      if (action === 'account-transfer') {
        e.stopPropagation();
        openSheet('account-transfer');
        return;
      }
      if (action === 'account-topup') {
        e.stopPropagation();
        openSheet('income');
        return;
      }
      btn.animate(
        [{ transform: 'scale(.96)' }, { transform: 'scale(1)' }],
        { duration: 160, easing: 'cubic-bezier(.2, 1.35, .4, 1)' }
      );
    });
  });

  /* ── Hero rows → account sheet ─────────────────────────── */
  const ACCOUNT_DATA = {
    personal: {
      name: 'Личный счёт', total: '845 200',
      meta: '3 валюты · Сбер, Тинькофф',
      tint: 'g',
      currencies: [
        { code: 'rub', label: 'Рубли',   native: '620 400 ₽',        pct: 73, weight: 620400 },
        { code: 'usd', label: 'Доллары', native: '$ 2 180',          conv: '≈ 205 200 ₽', pct: 24, weight: 205200 },
        { code: 'eur', label: 'Евро',    native: '€ 195',            conv: '≈ 19 600 ₽',  pct: 3,  weight: 19600 },
      ],
    },
    family: {
      name: 'Семейный счёт', total: '420 100',
      meta: 'RUB · 2 участника',
      tint: 'o',
      currencies: [
        { code: 'rub', label: 'Рубли', native: '420 100 ₽', pct: 100, weight: 1 },
      ],
    },
    invest: {
      name: 'Инвестиции', total: '1 562 000',
      meta: '2 валюты · +12,4% YTD',
      tint: 'b',
      currencies: [
        { code: 'rub', label: 'Рубли',   native: '1 140 000 ₽',              pct: 73, weight: 1140000 },
        { code: 'usd', label: 'Доллары', native: '$ 4 480', conv: '≈ 422 000 ₽', pct: 27, weight: 422000 },
      ],
    },
    credits: {
      name: 'Кредиты', total: '−180 000',
      meta: '2 активных · RUB',
      tint: 'r',
      currencies: [
        { code: 'rub', label: 'Кредитный лимит', native: '−180 000 ₽', pct: 100, weight: 1 },
      ],
    },
  };

  const CUR_ICO = { g: '#i-card', o: '#i-card', b: '#i-bars', r: '#i-card' };

  function populateAccountSheet(key) {
    const sheet = sheets.account;
    const data = ACCOUNT_DATA[key];
    if (!sheet || !data) return;
    const title = sheet.querySelector('#sheetAccountTitle');
    const val = sheet.querySelector('#sheetAccountVal');
    const meta = sheet.querySelector('#sheetAccountMeta');
    const icoBox = sheet.querySelector('#sheetAccountIco');
    const icoUse = icoBox?.querySelector('use');
    if (title) title.textContent = data.name;
    if (val) val.textContent = data.total;
    if (meta) meta.textContent = data.meta;
    if (icoBox) icoBox.className = `sheet-ico sheet-ico--${data.tint}`;
    if (icoUse) icoUse.setAttribute('href', CUR_ICO[data.tint] || '#i-card');

    /* rebuild composition bar + list */
    const comp = sheet.querySelector('#sheetAccountComp');
    if (!comp) return;
    const bar = comp.querySelector('.comp__bar');
    const list = comp.querySelector('.comp__list');
    if (bar) {
      bar.innerHTML = data.currencies
        .map((c) => `<span class="comp__seg comp__seg--${c.code}" style="flex: ${c.weight};"></span>`)
        .join('');
    }
    if (list) {
      list.innerHTML = data.currencies
        .map((c) => {
          const conv = c.conv ? ` <span class="comp__conv">${c.conv}</span>` : '';
          return (
            `<li class="comp__row">` +
              `<span class="comp__dot comp__dot--${c.code}"></span>` +
              `<span class="comp__name">${c.label}</span>` +
              `<span class="comp__native">${c.native}${conv}</span>` +
              `<span class="comp__pct">${c.pct}%</span>` +
            `</li>`
          );
        })
        .join('');
    }
  }

  document.querySelectorAll('.hero__row[data-account]').forEach((row) => {
    row.addEventListener('click', () => {
      const key = row.getAttribute('data-account');
      if (key) openSheet('account', key);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const key = row.getAttribute('data-account');
        if (key) openSheet('account', key);
      }
    });
  });

  /* ── Analytics sheet: interactions ─────────────────────── */
  const anaSheet = sheets.analytics;
  if (anaSheet) {
    /* Expense/Income segmented control */
    anaSheet.querySelectorAll('.seg__opt[data-ana-type]').forEach((opt) => {
      opt.addEventListener('click', () => {
        anaSheet.querySelectorAll('.seg__opt').forEach((o) => o.classList.remove('seg__opt--active'));
        opt.classList.add('seg__opt--active');
        const val = anaSheet.querySelector('#anaHeroVal');
        if (val) val.textContent = opt.getAttribute('data-ana-type') === 'income' ? '312 000' : '128 400';
      });
    });

    /* Period bars */
    anaSheet.querySelectorAll('.trend__bar[data-month]').forEach((bar) => {
      bar.addEventListener('click', () => {
        anaSheet.querySelectorAll('.trend__bar').forEach((b) => b.classList.remove('trend__bar--active'));
        bar.classList.add('trend__bar--active');
      });
    });

    /* Scope chips */
    anaSheet.querySelectorAll('.scope__chip[data-scope]').forEach((chip) => {
      chip.addEventListener('click', () => {
        anaSheet.querySelectorAll('.scope__chip').forEach((c) => c.classList.remove('scope__chip--active'));
        chip.classList.add('scope__chip--active');
      });
    });

    /* Category row → open sheet-category (reuse existing) */
    anaSheet.querySelectorAll('.ana-cat[data-cat]').forEach((row) => {
      row.addEventListener('click', () => {
        const key = row.getAttribute('data-cat');
        if (key) openSheet('category', key);
      });
    });
  }

  /* ── Operations sheet ──────────────────────────────────── */
  const OPERATIONS = {
    1:  { name: 'Пятёрочка',            type: 'expense',          tag: 'Расход',        amtTag: 'Сумма расхода',       amt: '1 240',   cat: 'Продукты',           acct: 'Личный · Tinkoff',    when: 'Сегодня, 19:42',   com: '—',                                icoHref: '#i-cart', icoClass: 'sheet-ico--g' },
    2:  { name: 'Зарплата',              type: 'income',           tag: 'Доход',         amtTag: 'Сумма дохода',        amt: '125 000', cat: 'Без категории',      acct: 'Личный · Tinkoff',    when: 'Сегодня, 12:00',   com: 'Апрельская выплата',               icoHref: '#i-plus', icoClass: 'sheet-ico--g' },
    3:  { name: 'Яндекс Такси',          type: 'expense',          tag: 'Расход',        amtTag: 'Сумма расхода',       amt: '480',     cat: 'Транспорт',          acct: 'Личный · Tinkoff',    when: 'Вчера, 22:15',     com: '—',                                icoHref: '#i-car',  icoClass: 'sheet-ico--b' },
    4:  { name: 'Шоколадница',           type: 'expense',          tag: 'Расход',        amtTag: 'Сумма расхода',       amt: '1 820',   cat: 'Кафе и рестораны',   acct: 'Личный · Tinkoff',    when: 'Вчера, 15:02',     com: 'Встреча с Димой',                  icoHref: '#i-cup',  icoClass: 'sheet-ico--o' },
    5:  { name: 'Перевод между счетами', type: 'account_transfer', tag: 'Перевод',       amtTag: 'Сумма перевода',      amt: '15 000',  cat: 'Личный → Семейный',  acct: 'Сбер → Тинькофф',     when: 'Вчера, 11:30',     com: 'Общие расходы на апрель',          icoHref: '#i-swap', icoClass: 'sheet-ico--ink' },
    6:  { name: 'ВкусВилл',              type: 'expense',          tag: 'Расход',        amtTag: 'Сумма расхода',       amt: '2 180',   cat: 'Продукты (семья)',   acct: 'Семейный · Tinkoff',  when: '16 апреля, 20:18', com: '—',                                icoHref: '#i-cart', icoClass: 'sheet-ico--g' },
    7:  { name: 'Обмен валют',           type: 'exchange',         tag: 'Обмен',         amtTag: 'Получено',            amt: '9 420',   cat: 'USD → RUB',          acct: 'Личный · Tinkoff',    when: '16 апреля, 15:40', com: 'Курс 94,20 ₽ за $1',               icoHref: '#i-swap', icoClass: 'sheet-ico--v' },
    8:  { name: 'Мосэнергосбыт',         type: 'expense',          tag: 'Расход',        amtTag: 'Сумма расхода',       amt: '4 200',   cat: 'Коммуналка',         acct: 'Семейный · Сбер',     when: '16 апреля, 09:00', com: 'Электричество, март',              icoHref: '#i-bolt', icoClass: 'sheet-ico--p' },
    9:  { name: 'Распределение',         type: 'allocate',         tag: 'Распределение', amtTag: 'Распределено',        amt: '30 000',  cat: 'В «Путешествия»',    acct: 'Из свободного остатка', when: '15 апреля, 14:20', com: 'Отпуск на майские',                icoHref: '#i-arrow-down', icoClass: 'sheet-ico--o' },
    10: { name: 'Ашан',                  type: 'expense',          tag: 'Расход',        amtTag: 'Сумма расхода',       amt: '3 620',   cat: 'Продукты (семья)',   acct: 'Семейный · Тинькофф', when: '15 апреля, 12:00', com: '—',                                icoHref: '#i-cart', icoClass: 'sheet-ico--g', cancelled: true },
    11: { name: 'Дивиденды SBER',        type: 'investment',       tag: 'Инвестиции',    amtTag: 'Зачислено',           amt: '1 840',   cat: 'Дивиденды',          acct: 'Инвестиции · ИИС',    when: '15 апреля, 11:00', com: '120 акций × 15,3 ₽',               icoHref: '#i-bars', icoClass: 'sheet-ico--b' },
    12: { name: 'Погашение кредита',     type: 'credit_repayment', tag: 'Кредит',        amtTag: 'Сумма платежа',       amt: '12 500',  cat: 'Сбер Потреб',        acct: 'Личный · Сбер',       when: '12 апреля, 10:00', com: 'Ежемесячный платёж',               icoHref: '#i-card', icoClass: 'sheet-ico--r' },
    13: { name: 'Apple Store',           type: 'expense',          tag: 'Расход',        amtTag: 'Сумма расхода',       amt: '890',     cat: 'Подарки',            acct: 'Личный · Tinkoff',    when: '12 апреля, 18:45', com: 'Подписка на iCloud для мамы',      icoHref: '#i-gift', icoClass: 'sheet-ico--v' },
  };

  const opsSheet = sheets.operations;
  const opDetSheet = sheets['op-detail'];

  function populateOpDetail(opId) {
    const data = OPERATIONS[opId];
    if (!opDetSheet || !data) return;
    const ico = opDetSheet.querySelector('#opDetIco');
    const icoUse = ico?.querySelector('use');
    const tag = opDetSheet.querySelector('#opDetTag');
    const title = opDetSheet.querySelector('#sheetOpDetTitle');
    const amtTag = opDetSheet.querySelector('#opDetAmtTag');
    const amt = opDetSheet.querySelector('#opDetAmt');
    const cat = opDetSheet.querySelector('#opDetCat');
    const acct = opDetSheet.querySelector('#opDetAcct');
    const when = opDetSheet.querySelector('#opDetWhen');
    const com = opDetSheet.querySelector('#opDetCom');
    const cancelBtn = opDetSheet.querySelector('#btnCancelOp');

    if (ico) ico.className = `sheet-ico ${data.icoClass || 'sheet-ico--g'}`;
    if (icoUse) icoUse.setAttribute('href', data.icoHref || '#i-cart');
    if (tag) tag.textContent = data.cancelled ? 'Отменено' : data.tag;
    if (title) title.textContent = data.name;
    if (amtTag) amtTag.textContent = data.amtTag;
    if (amt) amt.textContent = data.amt;
    if (cat) cat.textContent = data.cat;
    if (acct) acct.textContent = data.acct;
    if (when) when.textContent = data.when;
    if (com) {
      com.textContent = data.com || '—';
      com.classList.toggle('op-meta__muted', !data.com || data.com === '—');
    }
    if (cancelBtn) {
      cancelBtn.disabled = !!data.cancelled;
      cancelBtn.dataset.opId = String(opId);
      cancelBtn.style.opacity = data.cancelled ? '.5' : '';
    }
  }

  if (opsSheet) {
    /* row tap → detail */
    opsSheet.addEventListener('click', (e) => {
      const row = e.target instanceof HTMLElement ? e.target.closest('.op-row[data-op-id]') : null;
      if (!row) return;
      const id = row.getAttribute('data-op-id');
      if (id) openSheet('op-detail', id);
    });

    /* multi-select filter */
    const chips = Array.from(opsSheet.querySelectorAll('.op-filter__chip'));
    const allChip = opsSheet.querySelector('.op-filter__chip[data-op-all]');
    const emptyEl = opsSheet.querySelector('#opEmpty');
    const rows = Array.from(opsSheet.querySelectorAll('.op-row'));
    const groups = Array.from(opsSheet.querySelectorAll('.op-group'));

    const applyFilter = () => {
      const activeTypes = chips
        .filter((c) => c.classList.contains('op-filter__chip--active') && c.hasAttribute('data-op-type'))
        .map((c) => c.getAttribute('data-op-type'));
      const showCancelled = activeTypes.includes('cancelled');

      let visibleCount = 0;
      rows.forEach((row) => {
        const type = row.getAttribute('data-op-type') || '';
        const isCancelled = row.hasAttribute('data-op-cancelled') || row.classList.contains('op-row--cancelled');
        let match = activeTypes.includes(type);
        if (isCancelled) match = showCancelled;
        row.hidden = !match;
        if (match) visibleCount += 1;
      });

      groups.forEach((g) => {
        const anyVisible = Array.from(g.querySelectorAll('.op-row')).some((r) => !r.hidden);
        g.hidden = !anyVisible;
      });

      if (emptyEl) emptyEl.hidden = visibleCount !== 0;
    };

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        if (chip === allChip) {
          const nonCancelTypes = chips.filter((c) => c.hasAttribute('data-op-type') && c.getAttribute('data-op-type') !== 'cancelled');
          const allOn = nonCancelTypes.every((c) => c.classList.contains('op-filter__chip--active'));
          nonCancelTypes.forEach((c) => c.classList.toggle('op-filter__chip--active', !allOn));
          allChip.classList.toggle('op-filter__chip--active', !allOn);
        } else {
          chip.classList.toggle('op-filter__chip--active');
          const nonCancelTypes = chips.filter((c) => c.hasAttribute('data-op-type') && c.getAttribute('data-op-type') !== 'cancelled');
          const allOn = nonCancelTypes.every((c) => c.classList.contains('op-filter__chip--active'));
          allChip?.classList.toggle('op-filter__chip--active', allOn);
        }
        applyFilter();
      });
    });

    applyFilter();
  }

  /* Back button on op-detail → return to operations */
  document.getElementById('opDetBack')?.addEventListener('click', () => {
    openSheet('operations');
  });

  /* Cancel operation → mark row + return to list */
  document.getElementById('btnCancelOp')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!(btn instanceof HTMLElement) || btn.hasAttribute('disabled')) return;
    const opId = btn.dataset.opId;
    if (!opId) return;
    const row = opsSheet?.querySelector(`.op-row[data-op-id="${opId}"]`);
    if (row) {
      row.classList.add('op-row--cancelled');
      row.setAttribute('data-op-cancelled', '');
      const nameEl = row.querySelector('.op-row__name');
      if (nameEl && !nameEl.querySelector('.op-badge--cancel')) {
        const badge = document.createElement('span');
        badge.className = 'op-badge op-badge--cancel';
        badge.textContent = 'Отменено';
        nameEl.appendChild(document.createTextNode(' '));
        nameEl.appendChild(badge);
      }
    }
    if (OPERATIONS[opId]) OPERATIONS[opId].cancelled = true;
    openSheet('operations');
  });

  /* Repeat operation → visual tap feedback */
  document.getElementById('btnRepeatOp')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!(btn instanceof HTMLElement)) return;
    btn.animate(
      [{ transform: 'scale(.97)' }, { transform: 'scale(1)' }],
      { duration: 180, easing: 'cubic-bezier(.2, 1.35, .4, 1)' }
    );
  });

  /* ── Tabs ──────────────────────────────────────────────── */
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('tab--active'));
      tab.classList.add('tab--active');
    });
  });

  /* ── Quick-action micro-tap feedback ───────────────────── */
  document.querySelectorAll('.qa').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const t = e.currentTarget;
      if (!(t instanceof HTMLElement)) return;
      t.animate(
        [{ transform: 'scale(.94)' }, { transform: 'scale(1)' }],
        { duration: 170, easing: 'cubic-bezier(.2, 1.35, .4, 1)' }
      );
    });
  });

  /* ── Account transfer (accordion pickers + currency) ──── */
  const ATX_ACCOUNTS = [
    { id: 'personal_rub', group: 'personal', name: 'Личный счёт',     type: 'cash',       currency: 'RUB', balance: 845200,  ico: '#i-card',  bg: 'var(--text)',    fg: 'var(--surface)' },
    { id: 'personal_usd', group: 'personal', name: 'Личный счёт',     type: 'cash',       currency: 'USD', balance: 5820,    ico: '#i-card',  bg: 'var(--text)',    fg: 'var(--surface)' },
    { id: 'family_rub',   group: 'family',   name: 'Семейный счёт',   type: 'cash',       currency: 'RUB', balance: 420100,  ico: '#i-card',  bg: '#E86A4F',        fg: '#fff' },
    { id: 'family_usd',   group: 'family',   name: 'Семейный счёт',   type: 'cash',       currency: 'USD', balance: 1200,    ico: '#i-card',  bg: '#E86A4F',        fg: '#fff' },
    { id: 'wallet_rub',   group: 'wallet',   name: 'Наличные',        type: 'cash',       currency: 'RUB', balance: 25000,   ico: '#i-card',  bg: 'var(--t-g-f)',   fg: '#fff' },
    { id: 'broker',       group: 'broker',   name: 'Брокерский счёт', type: 'investment', currency: 'RUB', balance: 1520000, ico: '#i-donut', bg: 'var(--t-b-f)',   fg: '#fff' },
    { id: 'credit',       group: 'credit',   name: 'Кредитка',        type: 'credit',     currency: 'RUB', balance: 45000,   ico: '#i-card',  bg: 'var(--t-r-f)',   fg: '#fff' },
  ];
  const CUR_NAME = { RUB: 'Рубли', USD: 'Доллары', EUR: 'Евро' };

  const ATX_TYPE_GROUPS = [
    { type: 'cash',       label: 'Счета и наличные' },
    { type: 'investment', label: 'Инвестиции' },
    { type: 'credit',     label: 'Кредиты' },
  ];

  const ATX_COMPAT = {
    cash:       { cash: true,  investment: true,  credit: false },
    investment: { cash: true,  investment: false, credit: false },
    credit:     { cash: true,  investment: false, credit: false },
  };

  const ATX_MODE_LABELS = {
    'cash>cash':       'Перевод между счетами',
    'cash>investment': 'Пополнение инвестиций',
    'investment>cash': 'Вывод из инвестиций',
    'credit>cash':     'Погашение долга',
  };

  const CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };
  const fmtN = (n, cur) => {
    const fmtOpts = { maximumFractionDigits: cur === 'RUB' ? 0 : 2 };
    return new Intl.NumberFormat('ru-RU', fmtOpts).format(n);
  };

  const atxState = { from: null, to: null, openRole: null };

  const atxSheet = sheets['account-transfer'];
  const atxSwapBtn  = document.getElementById('atxSwap');
  const atxAmtInp   = document.getElementById('atxAmount');
  const atxFromCur  = document.getElementById('atxFromCur');
  const atxConfirm  = document.getElementById('atxConfirm');
  const atxModeBox  = document.getElementById('atxMode');
  const atxModeText = document.getElementById('atxModeText');

  const atxPairAllowed = (fT, tT) => {
    if (!fT || !tT) return false;
    if (fT === 'cash' && tT === 'cash') return true;
    return !!ATX_COMPAT[fT]?.[tT];
  };

  const atxCompatible = (role, acct) => {
    const other = role === 'from' ? atxState.to : atxState.from;
    const otherAcct = other ? ATX_ACCOUNTS.find(a => a.id === other) : null;
    if (otherAcct) {
      if (acct.id === otherAcct.id) return false;
      if (acct.currency !== otherAcct.currency) return false;
      const fT = role === 'from' ? acct.type : otherAcct.type;
      const tT = role === 'from' ? otherAcct.type : acct.type;
      return atxPairAllowed(fT, tT);
    }
    return true;
  };

  const atxRenderVal = (role) => {
    const block = atxSheet?.querySelector(`[data-atx-role="${role}"]`);
    const val = block?.querySelector(`[data-atx-val="${role}"]`);
    if (!val) return;
    const id = atxState[role];
    if (!id) {
      val.innerHTML = `<span class="atx__ph">${role === 'from' ? 'Выберите счёт-источник' : 'Выберите счёт-получатель'}</span>`;
      return;
    }
    const a = ATX_ACCOUNTS.find(x => x.id === id);
    if (!a) return;
    const groupSiblings = ATX_ACCOUNTS.filter(x => x.group === a.group);
    const multiCur = groupSiblings.length > 1;
    const subLabel = a.type === 'credit' ? 'Задолженность' : (role === 'from' ? 'Доступно' : 'Остаток');
    const sym = CUR_SYM[a.currency] || a.currency;
    const nameLine = multiCur
      ? `${a.name} · <span style="color:var(--text-2)">${CUR_NAME[a.currency] || a.currency}</span>`
      : a.name;
    val.innerHTML = `
      <span class="atx__sel">
        <span class="atx__sel-ico" style="background:${a.bg}; color:${a.fg};"><svg><use href="${a.ico}"/></svg></span>
        <span class="atx__sel-text">
          <span class="atx__sel-name">${nameLine}</span>
          <span class="atx__sel-sub">${subLabel}: ${fmtN(a.balance, a.currency)} ${sym}</span>
        </span>
      </span>`;
  };

  const atxRenderList = (role) => {
    const list = atxSheet?.querySelector(`[data-atx-list="${role}"]`);
    if (!list) return;
    const html = [];
    ATX_TYPE_GROUPS.forEach(({ type, label }) => {
      const items = ATX_ACCOUNTS.filter(a => a.type === type);
      if (!items.length) return;
      html.push(`<li class="atx__group-label">${label}</li>`);
      const seenGroups = new Set();
      items.forEach(a => {
        const compat = atxCompatible(role, a);
        const selected = atxState[role] === a.id;
        const sym = CUR_SYM[a.currency] || a.currency;
        const groupItems = items.filter(x => x.group === a.group);
        const isMulti = groupItems.length > 1;

        if (isMulti && !seenGroups.has(a.group)) {
          seenGroups.add(a.group);
          html.push(`
            <li class="atx__acct-head" aria-hidden="true">
              <span class="atx__acct-head-ico" style="background:${a.bg}; color:${a.fg};"><svg><use href="${a.ico}"/></svg></span>
              <span>${a.name}</span>
            </li>`);
        }

        if (isMulti) {
          const subLabel = a.type === 'credit' ? 'Задолженность' : 'Остаток';
          const badge = !compat ? 'нельзя' : (selected ? 'выбран' : '');
          html.push(`
            <li><button type="button"
                        class="atx__item atx__item--cur${selected ? ' atx__item--selected' : ''}"
                        data-atx-id="${a.id}"
                        ${compat ? '' : 'disabled'}>
              <span class="atx__cur-sym">${sym}</span>
              <span class="atx__item-text">
                <span class="atx__item-name">${CUR_NAME[a.currency] || a.currency}</span>
                <span class="atx__item-sub">${subLabel}: ${fmtN(a.balance, a.currency)} ${sym}</span>
              </span>
              <span class="atx__item-badge">${badge}</span>
            </button></li>`);
        } else {
          const subLabel = a.type === 'credit' ? 'Задолженность' : 'Остаток';
          const badge = !compat ? 'нельзя' : (selected ? 'выбран' : sym);
          html.push(`
            <li><button type="button"
                        class="atx__item${selected ? ' atx__item--selected' : ''}"
                        data-atx-id="${a.id}"
                        ${compat ? '' : 'disabled'}>
              <span class="atx__item-ico" style="background:${a.bg}; color:${a.fg};"><svg><use href="${a.ico}"/></svg></span>
              <span class="atx__item-text">
                <span class="atx__item-name">${a.name}</span>
                <span class="atx__item-sub">${subLabel}: ${fmtN(a.balance, a.currency)} ${sym}</span>
              </span>
              <span class="atx__item-badge">${badge}</span>
            </button></li>`);
        }
      });
    });
    list.innerHTML = html.join('');
  };

  const atxOpenBlock = (role) => {
    if (atxState.openRole === role) {
      atxCloseAll();
      return;
    }
    atxState.openRole = role;
    atxSheet?.querySelectorAll('.atx__block').forEach(b => {
      const r = b.getAttribute('data-atx-role');
      b.classList.toggle('atx__block--open', r === role);
    });
    atxRenderList(role);
  };

  const atxCloseAll = () => {
    atxState.openRole = null;
    atxSheet?.querySelectorAll('.atx__block').forEach(b => b.classList.remove('atx__block--open'));
  };

  const atxParseAmt = () => {
    const raw = (atxAmtInp?.value || '').replace(/\s+/g, '').replace(',', '.');
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const atxUpdateAll = () => {
    const fAcct = atxState.from ? ATX_ACCOUNTS.find(a => a.id === atxState.from) : null;
    const tAcct = atxState.to   ? ATX_ACCOUNTS.find(a => a.id === atxState.to)   : null;

    if (atxFromCur && fAcct) atxFromCur.textContent = CUR_SYM[fAcct.currency] || fAcct.currency;

    if (atxModeBox && atxModeText) {
      if (fAcct && tAcct) {
        atxModeText.textContent = ATX_MODE_LABELS[`${fAcct.type}>${tAcct.type}`] || 'Перевод между счетами';
        atxModeBox.removeAttribute('hidden');
      } else {
        atxModeBox.setAttribute('hidden', '');
      }
    }

    const ok = atxState.from && atxState.to && atxParseAmt() > 0;
    if (atxConfirm) atxConfirm.disabled = !ok;

    if (atxSwapBtn) {
      const canSwap = fAcct && tAcct && atxPairAllowed(tAcct.type, fAcct.type);
      atxSwapBtn.disabled = !canSwap;
    }
  };

  atxSheet?.querySelectorAll('.atx__trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const block = trigger.closest('[data-atx-role]');
      const role = block?.getAttribute('data-atx-role');
      if (role) atxOpenBlock(role);
    });
  });

  atxSheet?.querySelectorAll('.atx__list').forEach((list) => {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.atx__item');
      if (!(btn instanceof HTMLButtonElement) || btn.disabled) return;
      const id = btn.getAttribute('data-atx-id');
      const listEl = btn.closest('[data-atx-list]');
      const role = listEl?.getAttribute('data-atx-list');
      if (!id || !role) return;
      atxState[role] = id;
      atxRenderVal(role);
      atxCloseAll();
      atxUpdateAll();
    });
  });

  atxSwapBtn?.addEventListener('click', () => {
    if (atxSwapBtn.disabled) return;
    [atxState.from, atxState.to] = [atxState.to, atxState.from];
    atxRenderVal('from');
    atxRenderVal('to');
    atxUpdateAll();
  });

  atxAmtInp?.addEventListener('input', atxUpdateAll);

  atxConfirm?.addEventListener('click', () => {
    if (atxConfirm.disabled) return;
    atxConfirm.animate(
      [{ transform: 'scale(.97)' }, { transform: 'scale(1)' }],
      { duration: 180, easing: 'cubic-bezier(.2, 1.35, .4, 1)' }
    );
    setTimeout(closeSheets, 160);
  });

  atxSheet?.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', atxCloseAll);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') atxCloseAll(); });

  atxRenderVal('from');
  atxRenderVal('to');
  atxUpdateAll();

})();
