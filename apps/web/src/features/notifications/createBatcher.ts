export interface Batcher<T> {
  add(item: T): void;
  /** Hands over what is waiting now. */
  flush(): void;
  /** Drops what is waiting (unmount). */
  cancel(): void;
}

/**
 * Collects items that arrive close together and hands them over at once: `quietMs` after the last
 * one, and never later than `maxMs` after the first, so a long burst still shows up.
 */
export function createBatcher<T>(onFlush: (items: T[]) => void, { quietMs, maxMs }: { quietMs: number; maxMs: number }): Batcher<T> {
  let items: T[] = [];
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let max: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(quiet);
    clearTimeout(max);
    quiet = max = undefined;
  };
  const flush = () => {
    clear();
    if (!items.length) return;
    const batch = items;
    items = [];
    onFlush(batch);
  };
  return {
    add(item) {
      items.push(item);
      clearTimeout(quiet);
      quiet = setTimeout(flush, quietMs);
      max ??= setTimeout(flush, maxMs);
    },
    flush,
    cancel() {
      clear();
      items = [];
    },
  };
}
