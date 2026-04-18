/* Budget dashboard concept — interactive glue */

(() => {
  const root = document.documentElement;
  const STORE_KEY = 'budget-theme';

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

  /* ── Credits toggle ────────────────────────────────────── */
  const creditsBtn = document.getElementById('creditsToggle');
  const heroValue = document.getElementById('heroValue');
  const creditsLine = document.getElementById('creditsLine');
  const TOTAL_WITH_CREDITS = '2 647 300';
  const TOTAL_WITHOUT = '2 827 300';

  creditsBtn?.addEventListener('click', () => {
    const on = creditsBtn.classList.toggle('hero__toggle--on');
    const glyph = creditsBtn.querySelector('.hero__toggle-glyph');
    if (glyph) glyph.textContent = on ? '−' : '+';
    if (heroValue) {
      heroValue.style.transform = 'scale(.97)';
      heroValue.style.opacity = '.65';
      setTimeout(() => {
        heroValue.textContent = on ? TOTAL_WITH_CREDITS : TOTAL_WITHOUT;
        heroValue.style.transform = '';
        heroValue.style.opacity = '';
      }, 130);
    }
    if (creditsLine) {
      creditsLine.style.opacity = on ? '1' : '.5';
    }
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
    Object.values(sheets).forEach(s => s?.removeAttribute('data-visible'));
    sheets[key].setAttribute('data-visible', '');
    sheetRoot?.setAttribute('data-open', '');
    sheetRoot?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (meta && key === 'category') populateCategorySheet(meta);
  };

  const closeSheets = () => {
    Object.values(sheets).forEach(s => s?.removeAttribute('data-visible'));
    sheetRoot?.removeAttribute('data-open');
    sheetRoot?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  sheetRoot?.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.hasAttribute('data-close')) closeSheets();
    if (t instanceof HTMLElement && t.closest('[data-close]')) closeSheets();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheets();
  });

  /* Elements that open a sheet via data-sheet="name" */
  document.querySelectorAll('[data-sheet]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.getAttribute('data-sheet');
      if (key) openSheet(key);
    });
  });

  /* ── Category tile → category sheet ───────────────────── */
  const CAT_DATA = {
    grocery: { name: 'Продукты', amt: '8 400', ico: '#i-cart', tint: 'clay', grp: 'В группе «Питание» · 70%' },
    cafe: { name: 'Кафе и рестораны', amt: '4 200', ico: '#i-cup', tint: 'mocha', grp: 'В группе «Питание» · 30%' },
    transport: { name: 'Транспорт', amt: '12 800', ico: '#i-car', tint: 'sage', grp: 'Не входит в группу' },
    utilities: { name: 'Коммуналка', amt: '22 500', ico: '#i-bolt', tint: 'sky', grp: 'В группе «Обязательные платежи» · 40%' },
    clothes: { name: 'Одежда', amt: '15 600', ico: '#i-shirt', tint: 'rose', grp: 'Не входит в группу' },
    gifts: { name: 'Подарки', amt: '2 400', ico: '#i-gift', tint: 'plum', grp: 'Не входит в группу' },
    health: { name: 'Здоровье', amt: '18 200', ico: '#i-heart', tint: 'sage', grp: 'Не входит в группу' },
    fun: { name: 'Развлечения', amt: '6 500', ico: '#i-ticket', tint: 'mocha', grp: 'В группе «Семейные расходы» · 40%' },
    travel: { name: 'Путешествия', amt: '54 000', ico: '#i-plane', tint: 'sky', grp: 'Не входит в группу' },
    repair: { name: 'Ремонт', amt: '850', ico: '#i-wrench', tint: 'clay', grp: 'Осталось мало — пополните' },
    'fam-grocery': { name: 'Продукты (семья)', amt: '24 800', ico: '#i-cart', tint: 'clay', grp: 'Семейная категория' },
    'fam-school': { name: 'Школа', amt: '12 400', ico: '#i-book', tint: 'sky', grp: 'В группе «Семейные расходы» · 40%' },
    'fam-pets': { name: 'Питомцы', amt: '−1 250', ico: '#i-paw', tint: 'rose', grp: 'Перерасход — пополните срочно' },
    'fam-hobby': { name: 'Хобби', amt: '8 900', ico: '#i-palette', tint: 'plum', grp: 'Семейная категория' },
  };

  function populateCategorySheet(catKey) {
    const sheet = sheets.category;
    const data = CAT_DATA[catKey];
    if (!sheet || !data) return;
    const title = sheet.querySelector('#sheetCategoryTitle');
    const value = sheet.querySelector('.sheet-hero__value');
    const ico = sheet.querySelector('.sheet-ico use');
    const icoBox = sheet.querySelector('.sheet-ico');
    const chip = sheet.querySelector('.sheet-hero__meta .chip');
    if (title) title.textContent = data.name;
    if (value) value.textContent = data.amt;
    if (ico) ico.setAttribute('href', data.ico);
    if (icoBox) {
      icoBox.className = `sheet-ico sheet-ico--${data.tint}`;
    }
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

  /* ── Ripple-ish haptic feedback on quick actions (visual) ── */
  document.querySelectorAll('.quick').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const t = e.currentTarget;
      if (!(t instanceof HTMLElement)) return;
      t.animate([
        { transform: 'scale(.94)' },
        { transform: 'scale(1)' }
      ], { duration: 180, easing: 'cubic-bezier(.25, 1.4, .4, 1)' });
    });
  });

})();
