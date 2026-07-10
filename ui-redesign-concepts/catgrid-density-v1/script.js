// Тестовые данные: длинные имена, warn (<500), отрицательный, семейные
const ICONS = {
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h-2v-6l2-5h12l2 5v6h-2"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>',
  fork: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
};

const CATS = [
  { name: 'Продукты', icon: 'cart', color: 'g', amount: 18450, fam: false },
  { name: 'Коммунальные платежи и связь', icon: 'home', color: 'b', amount: 7230.5, fam: false },
  { name: 'Машина', icon: 'car', color: 'o', amount: 312, fam: false },       // warn
  { name: 'Кафе и рестораны', icon: 'fork', color: 'r', amount: -1240, fam: true }, // neg + fam
  { name: 'Подарки', icon: 'gift', color: 'p', amount: 5000, fam: true },
  { name: 'Здоровье и спорт', icon: 'heart', color: 'v', amount: 9860, fam: false },
];

const fmt = (n) => n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function tile(cat, layout) {
  const amtCls = cat.amount < 0 ? ' cat__amt--neg' : cat.amount < 500 ? ' cat__amt--warn' : '';
  const ico = `<span class="cat__ico cat__ico--${cat.color}">${ICONS[cat.icon]}</span>`;
  const name = `<span class="cat__name">${cat.name}</span>`;
  const amt = `<strong class="cat__amt${amtCls}">${fmt(cat.amount)}<span class="rub">&nbsp;₽</span></strong>`;
  const li = document.createElement('li');
  li.className = 'cat' + (cat.fam ? ' cat--fam' : '');
  if (layout === 'horizontal' || layout === 'rows') {
    li.innerHTML = layout === 'rows'
      ? `${ico}${name}${cat.fam ? '' : ''}${amt}`
      : `${ico}<span class="cat__body">${name}${amt}</span>`;
  } else if (layout === 'inline-amt') {
    li.innerHTML = `<span class="cat__top">${ico}${amt}</span>${name}`;
  } else {
    li.innerHTML = `${ico}${name}${amt}`;
  }
  return li;
}

document.querySelectorAll('.variant').forEach((section) => {
  const layout = section.dataset.variant;
  const grid = section.querySelector('[data-grid]');
  CATS.forEach((cat) => grid.appendChild(tile(cat, layout)));
});

// метрики: фактическая высота блока и экономия к эталону
requestAnimationFrame(() => {
  const base = document.querySelector('[data-variant="current"] [data-grid]').offsetHeight;
  document.querySelectorAll('.variant').forEach((section) => {
    const h = section.querySelector('[data-grid]').offsetHeight;
    const meta = section.querySelector('[data-meta]');
    const diff = Math.round((1 - h / base) * 100);
    meta.textContent = `${h}px` + (diff > 0 ? ` · −${diff}%` : ' · эталон');
  });
});

// тема
const btn = document.getElementById('themeToggle');
const apply = (t) => {
  document.documentElement.dataset.theme = t;
  btn.textContent = t === 'dark' ? '☀️' : '🌙';
};
apply(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
btn.onclick = () => apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
