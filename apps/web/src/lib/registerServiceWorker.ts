/**
 * Registers public/sw.js (installable app, shell offline; it caches static files only). Production
 * builds only: in development Vite serves unhashed modules that a cache would keep stale.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
