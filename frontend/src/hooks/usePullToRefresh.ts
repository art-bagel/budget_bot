import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';

const MIN_DISTANCE = 80; // px — minimum downward travel
const MAX_ANGLE = 0.5;   // tan(angle) — keeps gesture mostly vertical
const TOP_EDGE_ZONE = 120; // px — gesture must start near the top edge

export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => void,
  enabled = true,
) {
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const el = ref.current;
    if (!el) return;

    const stateRef = {
      current: null as {
        startX: number;
        startY: number;
        blocked: boolean;
        startedAtTop: boolean;
        startedNearTopEdge: boolean;
      } | null,
    };

    const getScrollTop = () => {
      if (el.scrollHeight > el.clientHeight) {
        return el.scrollTop;
      }

      return window.scrollY || document.documentElement.scrollTop || 0;
    };

    const findNestedScrollable = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) {
        return null;
      }

      let current: HTMLElement | null = target;

      while (current && current !== el) {
        const style = window.getComputedStyle(current);
        const canScrollY =
          (style.overflowY === 'auto' || style.overflowY === 'scroll')
          && current.scrollHeight > current.clientHeight;

        if (canScrollY) {
          return current;
        }

        current = current.parentElement;
      }

      return null;
    };

    const onStart = (e: TouchEvent) => {
      if (findNestedScrollable(e.target)) {
        stateRef.current = null;
        return;
      }

      const startedAtTop = getScrollTop() <= 1;
      const startedNearTopEdge = e.touches[0].clientY <= TOP_EDGE_ZONE;

      // Only activate when the gesture starts from the top edge
      if (!startedAtTop || !startedNearTopEdge) {
        stateRef.current = null;
        return;
      }

      stateRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        blocked: false,
        startedAtTop,
        startedNearTopEdge,
      };
    };

    const onMove = (e: TouchEvent) => {
      const s = stateRef.current;
      if (!s || s.blocked || !s.startedAtTop || !s.startedNearTopEdge) return;
      const dx = e.touches[0].clientX - s.startX;
      const dy = e.touches[0].clientY - s.startY;
      // Block if horizontal movement dominates
      if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 10) {
        s.blocked = true;
      }
    };

    const onEnd = (e: TouchEvent) => {
      const s = stateRef.current;
      stateRef.current = null;
      if (!s || s.blocked) return;

      const dx = e.changedTouches[0].clientX - s.startX;
      const dy = e.changedTouches[0].clientY - s.startY;

      if (dy < MIN_DISTANCE) return;                          // must swipe down
      if (Math.abs(dx) / Math.abs(dy) > MAX_ANGLE) return;   // must be mostly vertical

      navigator.vibrate?.(15);
      onRefreshRef.current();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [enabled, ref]);
}
