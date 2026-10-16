/** DocCheck's mark: a checked document with an AI spark. The favicon (index.html) and the email logo are the same drawing. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="#0f766e" />
      <path d="M8.5 5.5h8.2l5.3 5.3v14.7a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z" fill="#fff" />
      <path d="M16.7 5.5v4.3a1 1 0 0 0 1 1H22" fill="none" stroke="#99d5cd" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.6 18.6l2.8 2.8 5-5.6" fill="none" stroke="#0f766e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 3Q24.5 8 29.5 8Q24.5 8 24.5 13Q24.5 8 19.5 8Q24.5 8 24.5 3Z" fill="#fbbf24" stroke="#0f766e" strokeWidth="1.2" strokeLinejoin="round" paintOrder="stroke" />
      <path d="M27 13.3Q27 15.5 29.2 15.5Q27 15.5 27 17.7Q27 15.5 24.8 15.5Q27 15.5 27 13.3Z" fill="#fbbf24" />
    </svg>
  );
}
