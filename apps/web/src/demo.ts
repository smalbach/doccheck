import { useEffect, useState } from 'react';

/** Whether the API runs as the read-only public demo (GET /health → demo). Asked once per page load. */
const demoMode: Promise<boolean> = fetch('/health')
  .then((r) => r.json() as Promise<{ demo?: boolean }>)
  .then((h) => h.demo === true)
  .catch(() => false);

export function useDemo(): boolean {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    void demoMode.then(setDemo);
  }, []);
  return demo;
}
