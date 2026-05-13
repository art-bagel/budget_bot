/* Portfolio · Analytics v1 — Tinkoff concept prototype */

(() => {
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  const app = $('.app');

  /* ------------------------------------------------------------------
     Theme
     ------------------------------------------------------------------ */
  const THEME_KEY = 'portfolio-analytics-theme-v1';
  const setTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem(THEME_KEY, t);
  };
  const saved = localStorage.getItem(THEME_KEY)
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(saved);
  $('#themeToggle')?.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  /* ------------------------------------------------------------------
     Mock data — period × asset
     ------------------------------------------------------------------ */
  const PER = {
    '1M':  { period: '1 месяц',    total: '+24 400',  pct: '+0,9%',  vsPP: '+0,4 п.п.' },
    '3M':  { period: '3 месяца',   total: '+62 800',  pct: '+2,5%',  vsPP: '+1,6 п.п.' },
    '6M':  { period: '6 месяцев',  total: '+128 200', pct: '+5,1%',  vsPP: '+2,3 п.п.' },
    '1Y':  { period: '12 месяцев', total: '+218 600', pct: '+8,9%',  vsPP: '+3,5 п.п.' },
    'ALL': { period: 'всё время',  total: '+412 800', pct: '+18,3%', vsPP: '+7,2 п.п.' },
  };

  const ASSET_RUB = {
    '1M':  { security: '+15 200',  deposit: '+5 800',   crypto: '−2 400',  other: '+5 800' },
    '3M':  { security: '+34 200',  deposit: '+15 400',  crypto: '−4 200',  other: '+17 400' },
    '6M':  { security: '+72 600',  deposit: '+28 800',  crypto: '−9 200',  other: '+36 000' },
    '1Y':  { security: '+124 800', deposit: '+58 000',  crypto: '−12 400', other: '+48 200' },
    'ALL': { security: '+236 400', deposit: '+102 000', crypto: '−32 400', other: '+106 800' },
  };
  const ASSET_PCT = {
    '1M':  { security: '+0,7%',  deposit: '+0,7%',  crypto: '−1,0%',  other: '+2,3%' },
    '3M':  { security: '+2,6%',  deposit: '+1,8%',  crypto: '−1,7%',  other: '+6,8%' },
    '6M':  { security: '+5,5%',  deposit: '+3,4%',  crypto: '−3,7%',  other: '+14,0%' },
    '1Y':  { security: '+10,5%', deposit: '+7,3%',  crypto: '−4,8%',  other: '+23,1%' },
    'ALL': { security: '+22,0%', deposit: '+15,9%', crypto: '−11,6%', other: '+71,2%' },
  };

  const TAB = {
    all: {
      eyebrow: 'Доходность',
      scope:   { tint: 'ink',   title: 'Весь портфель',  sub: '4 типа активов · 14 позиций · 5 счетов' },
      benchTitle: 'Сравнение с рынком',
      benchSubTpl: (p) => `Портфель vs MOEX · ${p.period}`,
      benchNote: 'Портфель обогнал MOEX и инфляцию, но проиграл ключевой ставке — основной тормоз: крипта и просадка облигаций.',
      deltaTpl: (p) => `${p.pct} · обогнал MOEX на ${p.vsPP}`,
      srcSubTpl: (p) => `За ${p.period} · 4 источника`,
    },
    security: {
      eyebrow: 'Доходность бумаг',
      scope:   { tint: 'ink',   title: 'Ценные бумаги',  sub: '8 позиций · 2 счёта' },
      benchTitle: 'Бумаги vs MOEX',
      benchSubTpl: (p) => `Бумаги vs индекс · ${p.period}`,
      benchNote: 'Дивидендные акции вытянули результат: SBER и LKOH дали +22% и +14%. Облигации компенсировали +2,0%.',
      deltaTpl: (p, a) => `${a} · обогнал MOEX на ${p.vsPP}`,
      srcSubTpl: (p) => `За ${p.period} · 3 источника`,
    },
    deposit: {
      eyebrow: 'Начислено',
      scope:   { tint: 'mint',  title: 'Депозиты',       sub: '3 вклада · 2 банка' },
      benchTitle: 'Ставка vs ключевая · инфляция',
      benchSubTpl: (p) => `Средневзв. ставка · ${p.period}`,
      benchNote: 'Средневзвешенная ставка 15,2% — ниже ключевой (16,5%), но опережает инфляцию (7,4%) почти в 2 раза.',
      deltaTpl: (p, a) => `${a} к телу · средневзв. ставка 15,2%`,
      srcSubTpl: (p) => `За ${p.period} · только % по вкладам`,
    },
    crypto: {
      eyebrow: 'Изменение крипты',
      scope:   { tint: 'coral', title: 'Крипта',         sub: '3 актива · Binance' },
      benchTitle: 'Крипта vs MOEX · инфляция',
      benchSubTpl: (p) => `Просадка после ATH · ${p.period}`,
      benchNote: 'Крипта в просадке после январских максимумов. BTC −16% от ATH, ETH −26%. Не реализованный убыток.',
      deltaTpl: (p, a) => `${a} · просадка после ATH (фев 2026)`,
      srcSubTpl: (p) => `За ${p.period} · только прирост капитала`,
    },
    other: {
      eyebrow: 'Прирост',
      scope:   { tint: 'grape', title: 'Прочее',          sub: 'Золото + LQDT · Сбербанк' },
      benchTitle: 'Золото vs инфляция',
      benchSubTpl: (p) => `Золото vs ориентиры · ${p.period}`,
      benchNote: 'Золото в роли защитного актива опередило инфляцию. LQDT держит ликвидность под ключевую ставку.',
      deltaTpl: (p, a) => `${a} · золото опередило инфляцию`,
      srcSubTpl: (p) => `За ${p.period} · прирост и доходность LQDT`,
    },
  };

  /* ------------------------------------------------------------------
     Monthly picker data
     ------------------------------------------------------------------ */
  const MONTHS = {
    '2025-05': { label: 'Май 2025',     val: '+12 400', pct: '+0,5%', meta: 'спокойный месяц' },
    '2025-06': { label: 'Июнь 2025',    val: '+18 600', pct: '+0,7%', meta: 'дивидендный сезон' },
    '2025-07': { label: 'Июль 2025',    val: '+15 200', pct: '+0,6%', meta: 'купоны по ОФЗ' },
    '2025-08': { label: 'Август 2025',  val: '+21 800', pct: '+0,9%', meta: 'рост на нефти' },
    '2025-09': { label: 'Сентябрь 2025',val: '−8 400',  pct: '−0,3%', meta: 'коррекция MOEX' },
    '2025-10': { label: 'Октябрь 2025', val: '+14 200', pct: '+0,6%', meta: 'разворот' },
    '2025-11': { label: 'Ноябрь 2025',  val: '+29 800', pct: '+1,2%', meta: 'крипто-ралли' },
    '2025-12': { label: 'Декабрь 2025', val: '+22 400', pct: '+0,9%', meta: 'дивиденды Сбер' },
    '2026-01': { label: 'Январь 2026',  val: '+18 000', pct: '+0,7%', meta: 'ATH BTC' },
    '2026-02': { label: 'Февраль 2026', val: '−3 200',  pct: '−0,1%', meta: 'старт коррекции крипты' },
    '2026-03': { label: 'Март 2026',    val: '+35 200', pct: '+1,4%', meta: 'отскок бумаг' },
    '2026-04': { label: 'Апрель 2026',  val: '+44 600', pct: '+1,7%', meta: 'лучший месяц года' },
  };

  /* ------------------------------------------------------------------
     Refs
     ------------------------------------------------------------------ */
  const heroEyebrow   = $('#heroEyebrow');
  const heroValue     = $('#heroValue');
  const heroDelta     = $('#heroDelta');
  const heroDeltaText = $('#heroDeltaText');
  const heroDeltaIco  = heroDelta?.querySelector('use');

  const ascopeIco     = $('#ascopeIco');
  const ascopeEyebrow = $('#ascopeEyebrow');
  const ascopeSub     = $('#ascopeSub');
  const ascopePill    = $('#ascopePill');

  const srcTotal      = $('#srcTotal');
  const srcSub        = $('#srcSub');

  const benchTitle    = $('#benchTitle');
  const benchSub      = $('#benchSub');
  const benchPill     = $('#benchPill');
  const benchNote     = $('#benchNote span');

  /* ------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------ */
  const isNeg = (s) => typeof s === 'string' && s.trim().startsWith('−');

  const swapText = (el, text) => {
    if (!el) return;
    el.classList.add('is-swapping');
    setTimeout(() => {
      el.textContent = text;
      el.classList.remove('is-swapping');
    }, 160);
  };

  const setPill = (el, txt) => {
    if (!el) return;
    el.textContent = txt;
    el.classList.toggle('neg', isNeg(txt));
    el.classList.toggle('pos', !isNeg(txt));
  };

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */
  function render() {
    const t = app.dataset.active;
    const p = app.dataset.period;
    const per = PER[p];
    const info = TAB[t];

    /* Hero eyebrow */
    heroEyebrow.textContent = `${info.eyebrow} · ${per.period}`;

    /* Hero amount */
    const valueStr = t === 'all' ? per.total : ASSET_RUB[p][t];
    const pctStr   = t === 'all' ? per.pct   : ASSET_PCT[p][t];
    swapText(heroValue, valueStr);
    heroDeltaText.textContent = info.deltaTpl(per, pctStr);
    if (heroDeltaIco) {
      heroDeltaIco.setAttribute('href', isNeg(valueStr) ? '#i-arrow-down-r' : '#i-arrow-up-r');
    }

    /* Ascope strip */
    ascopeIco.dataset.tint = info.scope.tint;
    ascopeEyebrow.textContent = info.scope.title;
    ascopeSub.textContent = info.scope.sub;
    setPill(ascopePill, pctStr);

    /* Source-of-return totals */
    srcSub.textContent = info.srcSubTpl(per);
    setPill(srcTotal, valueStr.match(/^[+−]/) ? `${valueStr} ₽` : valueStr);

    /* Bench card */
    benchTitle.textContent = info.benchTitle;
    benchSub.textContent = info.benchSubTpl(per);
    setPill(benchPill, per.vsPP);
    benchNote.textContent = info.benchNote;
  }

  /* ------------------------------------------------------------------
     Period selector
     ------------------------------------------------------------------ */
  const periodBtns = $$('[data-period]');
  periodBtns.forEach((b) => {
    b.addEventListener('click', () => {
      periodBtns.forEach((x) => {
        x.classList.remove('segtog__opt--on');
        x.setAttribute('aria-selected', 'false');
      });
      b.classList.add('segtog__opt--on');
      b.setAttribute('aria-selected', 'true');
      app.dataset.period = b.dataset.period;
      render();
    });
  });

  /* ------------------------------------------------------------------
     Asset tabs
     ------------------------------------------------------------------ */
  const tabBtns = $$('.tabs__item');
  tabBtns.forEach((b) => {
    b.addEventListener('click', () => {
      tabBtns.forEach((x) => {
        x.classList.remove('tabs__item--on');
        x.setAttribute('aria-selected', 'false');
      });
      b.classList.add('tabs__item--on');
      b.setAttribute('aria-selected', 'true');
      app.dataset.active = b.dataset.tab;
      render();
    });
  });

  /* Hero rows behave as shortcut to tabs */
  $$('.hero__row').forEach((r) => {
    const activate = () => {
      const t = r.dataset.tab;
      const tab = $(`.tabs__item[data-tab='${t}']`);
      tab?.click();
    };
    r.addEventListener('click', activate);
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });

  /* ------------------------------------------------------------------
     View toggle
     ------------------------------------------------------------------ */
  const viewBtns = $$('[data-view]');
  viewBtns.forEach((b) => {
    b.addEventListener('click', () => {
      viewBtns.forEach((x) => {
        x.classList.remove('viewtog__opt--on');
        x.setAttribute('aria-selected', 'false');
      });
      b.classList.add('viewtog__opt--on');
      b.setAttribute('aria-selected', 'true');
      $$('.view-pane').forEach((p) => {
        p.classList.toggle('view-pane--on', p.dataset.pane === b.dataset.view);
      });
    });
  });

  /* ------------------------------------------------------------------
     Monthly bar picker
     ------------------------------------------------------------------ */
  const mbarCells   = $$('.mbar__cell');
  const mbarMonth   = $('.mbar__pick-month');
  const mbarVal     = $('.mbar__pick-val');
  const mbarMeta    = $('.mbar__pick-meta');

  mbarCells.forEach((c) => {
    c.addEventListener('click', () => {
      mbarCells.forEach((x) => x.classList.remove('mbar__cell--on'));
      c.classList.add('mbar__cell--on');
      const m = MONTHS[c.dataset.m];
      if (!m) return;
      mbarMonth.textContent = m.label;
      mbarVal.innerHTML = `${m.val}<i>₽</i>`;
      mbarVal.classList.toggle('neg', isNeg(m.val));
      mbarVal.classList.toggle('pos', !isNeg(m.val));
      mbarMeta.textContent = `${m.pct} · ${m.meta}`;
    });
  });

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */
  render();
})();
