import { findingAnchorId } from './liveFindings';

const FLASH_MS = 1600;

/**
 * Brings a finding's card (live or stored) into view, focuses it and flashes it briefly. Scrolls without
 * animation under prefers-reduced-motion (the flash is turned off in CSS there). False when it is not on the page.
 */
export function showFinding(id: string): boolean {
  const el = document.getElementById(findingAnchorId(id));
  if (!el) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  el.classList.remove('finding-flash');
  // Restart the animation when the same card is shown twice in a row.
  void el.offsetWidth;
  el.classList.add('finding-flash');
  window.setTimeout(() => el.classList.remove('finding-flash'), FLASH_MS);
  return true;
}
