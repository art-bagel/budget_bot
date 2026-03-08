import { useEffect } from 'react';

/**
 * Adds `modal-open` class to document.body while the component is mounted.
 * This is more reliable than CSS :has(.modal-backdrop) in Telegram WebApp
 * for fixing keyboard white-corner artefacts.
 */
export function useModalOpen(): void {
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, []);
}
