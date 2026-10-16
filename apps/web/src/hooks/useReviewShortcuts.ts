import { useEffect, useRef } from 'react';

export interface ReviewShortcuts {
  next: () => void;
  previous: () => void;
  accept: () => void;
  edit: () => void;
  nextDocument: () => void;
}

/** Typing in a field (or a menu open over the page) is never a shortcut. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.closest('[role="dialog"], [role="menu"]'));

/**
 * The review screen's keys: J or ↓ next value, K or ↑ previous, A accept, E edit, N next document.
 * No modifier keys, so browser and screen-reader shortcuts keep working.
 */
export function useReviewShortcuts(handlers: ReviewShortcuts, enabled = true) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      const action = ({ j: 'next', ArrowDown: 'next', k: 'previous', ArrowUp: 'previous', a: 'accept', e: 'edit', n: 'nextDocument' } as const)[e.key];
      if (!action) return;
      e.preventDefault();
      latest.current[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
