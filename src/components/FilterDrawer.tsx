import { useEffect } from 'react';
import { useExitTransition } from '../lib/useExitTransition';
import { useBodyScrollLock } from '../lib/scrollLock';

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** How many individual filter selections are active, shown as a badge next to the title. */
  activeCount: number;
  /** Footer button label, e.g. "Apply & View 1,424 Cards". */
  applyLabel: string;
  children: React.ReactNode;
}

/**
 * Filters live entirely off to the side, in their own panel with its own scroll - never as part of
 * the page's own scroll. A sidebar pinned in the page's layout has to somehow cope with being
 * taller than the screen (an inner scrollbar, or "catch up" logic tracking where its bottom is),
 * and every version of that has read as awkward. Taking it out of the page's flow entirely removes
 * the problem instead of managing it: the panel and the page never compete for the same scroll.
 *
 * Used at every screen width, not just on mobile: on a phone it takes up nearly the full screen
 * anyway (max-w-sm), and on a wider one it's a compact panel over a dimmed backdrop.
 */
export function FilterDrawer({ open, onClose, title, activeCount, applyLabel, children }: FilterDrawerProps) {
  // Esc closes it, same as clicking the backdrop.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useBodyScrollLock(open);
  const { rendered, state } = useExitTransition(open, 400);

  if (!rendered) return null;

  return (
    <div
      onClick={onClose}
      data-state={state}
      style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', background: 'rgba(0,0,0,0.7)' }}
      className="tv-overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        data-state={state}
        className="tv-drawer-left w-full max-w-sm h-full flex flex-col shadow-2xl border-r"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {/* Drawer Header */}
        <div className="border-b shrink-0 px-4 py-3.5 sm:px-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-header)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--text-accent)" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="font-extrabold text-base truncate" style={{ color: 'var(--text-primary)' }}>{title}</span>
              {activeCount > 0 && (
                <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-black" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}>
                  {activeCount} active
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl transition cursor-pointer border"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Close filters"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Drawer Body - its own scroll, entirely separate from the page's */}
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-5 custom-scrollbar">
          {children}
        </div>

        {/* Drawer Footer */}
        <div className="border-t shrink-0 px-4 py-3.5 sm:px-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-header)' }}>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl font-bold text-sm shadow-lg transition cursor-pointer text-center"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
