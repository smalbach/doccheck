import { useEffect, useState } from 'react';

/** `value`, once it has stopped changing for `ms` (e.g. a search box, so each keystroke is not a request). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
