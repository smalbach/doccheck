/** DocCheck's mark: scanner corners around a D-shaped document whose nodes feed a lens with a check. The favicon (index.html) and the email logo are the same drawing. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="#0f766e" />
      <path d="M6 11V7a1 1 0 0 1 1-1h4M21 6h4a1 1 0 0 1 1 1v4M26 21v4a1 1 0 0 1-1 1h-4M11 26H7a1 1 0 0 1-1-1v-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 9h5a7 7 0 0 1 0 14h-5z" fill="#fff" />
      <path d="M12.5 12.2L18.5 16M12.5 16H18.5M12.5 19.8L18.5 16" stroke="#5fb3a8" strokeWidth="1" />
      <circle cx="12.5" cy="12.2" r="1.3" fill="#0f766e" />
      <circle cx="12.5" cy="16" r="1.3" fill="#0f766e" />
      <circle cx="12.5" cy="19.8" r="1.3" fill="#0f766e" />
      <path d="M20.6 18.1L23.8 21.3" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18.5" cy="16" r="3" fill="#0f766e" />
      <path d="M17.1 16.1l1 1 1.9-2.1" fill="none" stroke="#fbbf24" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
