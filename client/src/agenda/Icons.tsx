/* Sprite de ícones — idêntico à referência, renderizado uma vez na raiz */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-prev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></symbol>
      <symbol id="i-next" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></symbol>
      <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5l5 5 10-11" /></symbol>
      <symbol id="i-repeat" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></symbol>
      <symbol id="i-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></symbol>
      <symbol id="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" /></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" /></symbol>
      <symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></symbol>
      <symbol id="i-logout" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></symbol>
      <symbol id="i-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2.5" width="6" height="11.5" rx="3" /><path d="M5 11.5a7 7 0 0014 0M12 18.5V22M8.5 22h7" /></symbol>
      <symbol id="i-stop" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" /></symbol>
      <symbol id="i-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></symbol>
      <symbol id="i-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.54.84l10-6.5a1 1 0 000-1.68l-10-6.5A1 1 0 008 5.5z" /></symbol>
      <symbol id="i-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></symbol>
      <symbol id="i-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="M21 15l-5-5L5 21" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 018 0v3" /></symbol>
      <symbol id="i-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></symbol>
      <symbol id="i-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></symbol>
      <symbol id="i-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34 1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87 1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" /></symbol>
      <symbol id="i-note" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></symbol>
      <symbol id="i-camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 012-2h2l1.5-2.5h7L17 6h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><circle cx="12" cy="13" r="3.5" /></symbol>
      <symbol id="i-video" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="M15.5 11l6-3.5v9l-6-3.5" /></symbol>
      <symbol id="i-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07L11 5" /><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07L13 19" /></symbol>
      <symbol id="i-clip" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.5l-8.5 8.5a5.66 5.66 0 01-8-8l9.2-9.2a3.77 3.77 0 015.33 5.33l-9.2 9.2a1.89 1.89 0 01-2.67-2.67L15.5 7.3" /></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.6 5.2A10.4 10.4 0 0112 5c6.5 0 10.5 7 10.5 7a17.4 17.4 0 01-2.5 3.2M6.6 6.6C3.5 8.7 1.5 12 1.5 12s4 7 10.5 7a10 10 0 005-1.3" /><path d="M9.9 9.9a3 3 0 104.2 4.2" /><path d="M3 3l18 18" /></symbol>
      <symbol id="i-unlock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 017.8-1.2" /></symbol>
      <symbol id="i-zap" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></symbol>
      <symbol id="i-phone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v2.6a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 3.7 2 2 0 014.1 1.5h2.6a2 2 0 012 1.7c.13 1 .37 1.96.7 2.9a2 2 0 01-.45 2.1L7.9 9.3a16 16 0 006 6l1.1-1.05a2 2 0 012.1-.45c.94.33 1.9.57 2.9.7a2 2 0 011.7 2z" /></symbol>
      <symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-2.64-6.36" /><path d="M21 3v6h-6" /></symbol>
    </svg>
  );
}

export const Icon = ({ id, className }: { id: string; className?: string }) => (
  <svg className={className}>
    <use href={`#${id}`} />
  </svg>
);
