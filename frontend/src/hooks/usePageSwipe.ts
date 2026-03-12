import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';
import type { Page } from '../components/Layout';

const PAGE_ORDER: Page[] = ['dashboard', 'operations', 'exchange', 'family', 'settings'];

const MIN_DISTANCE = 72;   // px — minimum horizontal travel
const MAX_ANGLE = 0.5;     // tan(angle) — keeps gesture mostly horizontal
const EDGE_ZONE = 44;      // px — touch must start within this distance from screen edge

export function usePageSwipe(
  ref: RefObject<HTMLElement | null>,
  currentPage: Page,
  onNavigate: (page: Page) => void,
) {
  const stateRef = useRef<{
    startX: number;
    startY: number;
    blocked: boolean;
  } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      const x = e.touches[0].clientX;
      const screenWidth = window.innerWidth;

      // Only allow swipe from screen edges
      if (x > EDGE_ZONE && x < screenWidth - EDGE_ZONE) {
        stateRef.current = null;
        return;
      }

      // Ignore if touch starts on a swipeable element (category cards, free budget)
      const target = e.target as Element;
      if (target.closest('.swipeable')) {
        stateRef.current = null;
        return;
      }

      stateRef.current = {
        startX: x,
        startY: e.touches[0].clientY,
        blocked: false,
      };
    };

    const onMove = (e: TouchEvent) => {
      const s = stateRef.current;
      if (!s || s.blocked) return;
      const dx = e.touches[0].clientX - s.startX;
      const dy = e.touches[0].clientY - s.startY;
      // If vertical movement dominates early — block this gesture
      if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 10) {
        s.blocked = true;
      }
    };

    const onEnd = (e: TouchEvent) => {
      const s = stateRef.current;
      stateRef.current = null;
      if (!s || s.blocked) return;

      const dx = e.changedTouches[0].clientX - s.startX;
      const dy = e.changedTouches[0].clientY - s.startY;

      if (Math.abs(dx) < MIN_DISTANCE) return;
      if (Math.abs(dy) / Math.abs(dx) > MAX_ANGLE) return;

      const idx = PAGE_ORDER.indexOf(currentPage);
      if (dx < 0 && idx < PAGE_ORDER.length - 1) {
        onNavigate(PAGE_ORDER[idx + 1]);
        navigator.vibrate?.(10);
      } else if (dx > 0 && idx > 0) {
        onNavigate(PAGE_ORDER[idx - 1]);
        navigator.vibrate?.(10);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [ref, currentPage, onNavigate]);
}
