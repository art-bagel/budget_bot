// ============================================================
// Tinkoff Sync — concept v1 · interaction
// ============================================================

(() => {
  // --- Theme toggle -------------------------------------------
  const root = document.documentElement;
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
  });

  // --- Slide-over open/close ----------------------------------
  const open = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.dataset.open = '';
    document.body.style.overflow = 'hidden';
  };
  const close = (id) => {
    const map = { connect: 'sxConnect', sync: 'sxSync' };
    const el = document.getElementById(map[id] || id);
    if (!el) return;
    delete el.dataset.open;
    document.body.style.overflow = '';
  };

  document.querySelectorAll('[data-open]').forEach((btn) => {
    const target = btn.getAttribute('data-open');
    btn.addEventListener('click', () => {
      const map = { connect: 'sxConnect', sync: 'sxSync' };
      open(map[target] || target);
    });
  });
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => close(btn.getAttribute('data-close')));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close('connect');
      close('sync');
    }
  });

  // --- Token visibility ---------------------------------------
  const tokenInput = document.querySelector('.token-input');
  const tokenField = document.getElementById('tokenField');
  document.getElementById('tokenEye')?.addEventListener('click', () => {
    if (!tokenInput || !tokenField) return;
    const shown = tokenInput.classList.toggle('is-shown');
    tokenField.type = shown ? 'text' : 'password';
  });

  // --- Connect stepper ----------------------------------------
  const sxConnect = document.getElementById('sxConnect');
  const stepEls = sxConnect?.querySelectorAll('.steps__item');
  const stepPanes = sxConnect?.querySelectorAll('[data-step-content]');
  const backBtn = document.getElementById('connectBack');
  const nextBtn = document.getElementById('connectNext');
  const nextLabel = document.getElementById('connectNextLabel');
  let currentStep = 1;

  const stepLabels = {
    1: { next: 'Проверить токен', back: 'Отмена' },
    2: { next: 'Сохранить привязки', back: 'Назад' },
    3: { next: 'Готово · закрыть', back: 'Закрыть' },
  };

  const renderStep = (n) => {
    currentStep = n;
    stepEls?.forEach((el) => {
      const idx = Number(el.dataset.step);
      el.classList.toggle('is-active', idx === n);
      el.classList.toggle('is-done', idx < n);
    });
    stepPanes?.forEach((p) => {
      p.classList.toggle('is-visible', Number(p.dataset.stepContent) === n);
    });
    if (nextLabel) nextLabel.textContent = stepLabels[n].next;
    if (backBtn) backBtn.textContent = stepLabels[n].back;
  };

  nextBtn?.addEventListener('click', () => {
    if (currentStep < 3) {
      renderStep(currentStep + 1);
    } else {
      close('connect');
      setTimeout(() => renderStep(1), 400);
    }
  });
  backBtn?.addEventListener('click', () => {
    if (currentStep === 1) {
      close('connect');
      return;
    }
    renderStep(currentStep - 1);
  });

  // Skip toggle on link rows
  document.querySelectorAll('.link-row__skip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!pressed));
      btn.closest('.link-row')?.classList.toggle('is-skipped', !pressed);
    });
  });

  // --- Sync tabs ----------------------------------------------
  const sxSync = document.getElementById('sxSync');
  const tabBtns = sxSync?.querySelectorAll('.tabs__btn');
  const tabPanes = sxSync?.querySelectorAll('[data-tabpane]');

  tabBtns?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      tabBtns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      tabPanes?.forEach((p) => {
        p.classList.toggle('is-visible', p.dataset.tabpane === id);
      });
    });
  });

  // --- Resolution radios --------------------------------------
  document.querySelectorAll('.res').forEach((group) => {
    const opts = group.querySelectorAll('.res__opt');
    opts.forEach((opt) => {
      opt.addEventListener('click', (e) => {
        // Don't intercept clicks on inner controls (selects)
        if ((e.target instanceof HTMLElement) && e.target.closest('select')) return;
        opts.forEach((o) => o.classList.remove('res__opt--on'));
        opt.classList.add('res__opt--on');
        const radio = opt.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        // Mark parent op as resolved
        opt.closest('.op')?.classList.remove('op--unresolved');
      });
    });
  });
})();
