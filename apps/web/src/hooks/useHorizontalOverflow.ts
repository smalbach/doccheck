import { useEffect, useRef, useState } from 'react';

/** Whether the element is wider than its box (so it scrolls sideways); updates on resize. */
export function useHorizontalOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const check = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, overflows };
}
