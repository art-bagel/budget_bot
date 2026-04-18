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
    income: document.getElementById('sheet-income'),
    transfer: document.getElementById('sheet-transfer'),
  };

  const openSheet = (key, meta) => {
    if (!sheets[key]) return;
    Object.values(sheets).forEach((s) => s?.removeAttribute('data-visible'));
    sheets[key].setAttribute('data-visible', '');
    sheetRoot?.setAttribute('data-open', '');
    sheetRoot?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (meta && key === 'category') populateCategorySheet(meta);
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

})();
