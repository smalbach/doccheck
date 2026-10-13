import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Asked once per page load: whether the API runs as the read-only public demo (GET /health → demo). */
const demoMode: Promise<boolean> = api.health().then(
  (h) => h.demo === true,
  () => false,
);

/** True when the app is the read-only demo: uploads, deletes and re-extraction are hidden. */
export function useDemo(): boolean {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let active = true;
    void demoMode.then((value) => active && setDemo(value));
    return () => {
      active = false;
    };
  }, []);
  return demo;
}
