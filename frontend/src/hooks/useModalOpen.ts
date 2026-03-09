import { useEffect } from 'react';

/**
 * Adds `modal-open` class to document.body while the component is mounted.
 * This is more reliable than CSS :has(.modal-backdrop) in Telegram WebApp
 * for fixing keyboard white-corner artefacts.
 */
export function useModalOpen(): void {
  useEffect(() => {
    let frameId = 0;
    let timeoutId = 0;

    const scrollFocusedFieldIntoView = () => {
      const activeElement = document.activeElement;

      if (!(activeElement instanceof HTMLElement)) {
        return;
      }

      if (
        !activeElement.matches('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }

      const modalBody = activeElement.closest('.modal-body');

      if (!(modalBody instanceof HTMLElement)) {
        return;
      }

      activeElement.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    };

    const scheduleScroll = () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(frameId);

      frameId = window.requestAnimationFrame(() => {
        scrollFocusedFieldIntoView();
      });

      // Repeat once after keyboard animation settles.
      timeoutId = window.setTimeout(() => {
        scrollFocusedFieldIntoView();
      }, 220);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        scheduleScroll();
      }
    };

    document.body.classList.add('modal-open');

    document.addEventListener('focusin', handleFocusIn);
    window.visualViewport?.addEventListener('resize', scheduleScroll);
    window.visualViewport?.addEventListener('scroll', scheduleScroll);

    return () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(frameId);
      document.body.classList.remove('modal-open');
      document.removeEventListener('focusin', handleFocusIn);
      window.visualViewport?.removeEventListener('resize', scheduleScroll);
      window.visualViewport?.removeEventListener('scroll', scheduleScroll);
    };
  }, []);
}
