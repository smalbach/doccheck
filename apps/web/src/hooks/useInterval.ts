import { useEffect, useRef } from 'react';

/** Calls `callback` every `ms` while `active`; the latest callback is used without restarting the timer. */
export function useInterval(callback: () => void, ms: number, active: boolean): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => saved.current(), ms);
    return () => clearInterval(timer);
  }, [ms, active]);
}
