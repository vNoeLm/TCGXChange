/** Shown to everyone but admins while the store is not open (STORE_PUBLIC_LAUNCH is false). */
export function StoreClosed() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center">
      <div
        className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-6 border shadow-sm"
        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
      >
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h1 className="text-2xl sm:text-3xl font-black mb-3" style={{ color: 'var(--text-primary)' }}>
        Store Under Construction
      </h1>
      <p className="text-sm sm:text-base leading-relaxed mb-8 max-w-lg mx-auto" style={{ color: 'var(--text-secondary)' }}>
        The official TCG XChange Store is not open yet. Sealed products, card sleeves, deck boxes and accessories will launch here soon.
      </p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <a
          href="/"
          className="px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition active:scale-95 cursor-pointer"
          style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
        >
          Browse Catalog
        </a>
      </div>
    </div>
  );
}

export function StoreSpinner({ label = 'Loading store...' }: { label?: string }) {
  return (
    <div className="max-w-7xl mx-auto px-4 py-24 flex flex-col items-center justify-center text-center">
      <div className="w-10 h-10 border-4 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin mb-4" />
      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  );
}

/** Banner for admins looking at the shop before it is public. */
export function StorePreviewBanner() {
  return (
    <div
      className="mb-5 px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 flex-wrap"
      style={{ background: 'rgba(234, 179, 8, 0.1)', borderColor: 'rgba(234, 179, 8, 0.3)', color: '#eab308' }}
    >
      <span>Preview: the store is not public yet, only admins can see this page.</span>
      <a href="/admin?tab=store" className="underline underline-offset-2 cursor-pointer">Open store admin</a>
    </div>
  );
}
