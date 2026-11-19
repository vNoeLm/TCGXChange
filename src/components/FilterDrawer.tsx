import React from 'react';
import { useLanguage } from '../lib/i18n';
import { Drawer } from './ui/Drawer';

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** How many individual filter selections are active, shown as a badge next to the title. */
  activeCount: number;
  /** Footer button label, e.g. "Apply & View 1,424 Cards". */
  applyLabel: string;
  /** Optional stacking order when opened over another modal overlay. Defaults to 110. */
  zIndex?: number;
  children: React.ReactNode;
}

/**
 * Filters live entirely off to the side, in their own panel with its own scroll - never as part of
 * the page's own scroll. Built on the shared Drawer primitive for consistent transitions, Escape
 * handling, scroll lock, and safe-area padding.
 */
export function FilterDrawer({ open, onClose, title, activeCount, applyLabel, zIndex = 110, children }: FilterDrawerProps) {
  const { t } = useLanguage();

  return (
    <Drawer open={open} onClose={onClose} side="left" ariaLabel={title} maxWidthClass="max-w-sm" zIndex={zIndex}>
      {/* Drawer Header */}
      <div className="border-b shrink-0 px-4 py-3.5 sm:px-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-header)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <svg aria-hidden="true" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--text-accent)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span className="font-extrabold text-base truncate" style={{ color: 'var(--text-primary)' }}>{title}</span>
            {activeCount > 0 && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-black tabular-nums" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}>
                {activeCount} {t('active', 'aktív')}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close filters', 'Szűrők bezárása')}
            className="tv-touch-target w-9 h-9 shrink-0 flex items-center justify-center rounded-xl transition cursor-pointer border"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            title={t('Close filters', 'Szűrők bezárása')}
          >
            <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
      <div
        className="border-t shrink-0 px-4 pt-3.5 sm:px-5"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'var(--bg-header)',
          paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-11 py-3 px-4 rounded-xl font-bold text-sm shadow-lg transition cursor-pointer text-center"
          style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
        >
          {applyLabel}
        </button>
      </div>
    </Drawer>
  );
}
