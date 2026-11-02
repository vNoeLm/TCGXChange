import React, { useEffect } from 'react';
import { useExitTransition } from '../../lib/useExitTransition';
import { backdropCloseProps } from '../../lib/modalBackdrop';

/**
 * The dialog shell shared by the collection Export, Import and Reset menus: a dimmed backdrop, a
 * centered panel and a header with a close button. Holds itself open for its own exit transition,
 * so it is rendered unconditionally with `open` rather than wrapped in `{open && ...}`.
 */
export function CollectionModal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = 'default',
  maxWidth = 'max-w-lg',
  closeDisabled = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: IconName;
  tone?: 'default' | 'danger';
  maxWidth?: string;
  closeDisabled?: boolean;
  children: React.ReactNode;
}) {
  const { rendered, state } = useExitTransition(open, 250);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, closeDisabled]);

  if (!rendered) return null;

  const danger = tone === 'danger';

  return (
    <div
      {...backdropCloseProps(onClose, { disabled: closeDisabled })}
      data-state={state}
      className="tv-overlay fixed inset-0 flex items-center justify-center p-4 overflow-y-auto"
      style={{ zIndex: 100, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', overscrollBehavior: 'contain' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        data-state={state}
        className={`tv-modal-panel w-full ${maxWidth} my-auto rounded-2xl border text-left shadow-2xl max-h-[88vh] overflow-y-auto custom-scrollbar`}
        style={{
          background: 'var(--bg-surface)',
          borderColor: danger ? 'var(--negative-border)' : 'var(--border)',
          touchAction: 'auto',
        }}
      >
        <header className="flex items-start gap-3 px-5 sm:px-6 pt-5 pb-4">
          {icon && (
            <span
              className="w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center"
              style={
                danger
                  ? { background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }
                  : { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              }
              aria-hidden="true"
            >
              <Icon name={icon} className="w-5 h-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-lg sm:text-xl font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{title}</h3>
            {subtitle && <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg cursor-pointer transition disabled:opacity-40 disabled:cursor-default"
            style={{ background: 'var(--bg-raised)', color: 'var(--text-tertiary)' }}
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </header>
        <div className="px-5 sm:px-6 pb-5 sm:pb-6">{children}</div>
      </div>
    </div>
  );
}

/**
 * One choice in a Export/Import list. Every row has the same three parts in the same places - an
 * icon tile, the title and description, and a fixed-width action chip on the right - so the
 * actions line up down the list instead of each wandering to wherever its text ends.
 */
export function ActionRow({
  icon,
  title,
  description,
  actionLabel,
  actionIcon,
  onClick,
  tone = 'neutral',
  disabled = false,
  index = 0,
}: {
  icon: IconName;
  title: string;
  description: string;
  actionLabel: string;
  actionIcon: IconName;
  onClick: () => void;
  tone?: 'neutral' | 'accent';
  disabled?: boolean;
  /** Position in the list, for the small entrance stagger. */
  index?: number;
}) {
  const accent = tone === 'accent';
  return (
    // The stagger lives on a wrapper: .tv-reveal sets `transition`, which would replace the row's
    // own hover transitions if it were on the button itself.
    <div className="tv-reveal" style={{ transitionDelay: `${index * 35}ms` }}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 rounded-xl border text-left cursor-pointer transition disabled:opacity-60 disabled:cursor-default"
        style={
          accent
            ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)' }
            : { background: 'var(--bg-input)', borderColor: 'var(--border)' }
        }
      >
        <span
          className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0"
          style={
            accent
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              : { background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
          }
          aria-hidden="true"
        >
          <Icon name={icon} className="w-[18px] h-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>{title}</span>
          <span className="block text-xs leading-snug mt-0.5" style={{ color: accent ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>{description}</span>
        </span>
        <span
          className="inline-flex items-center justify-center gap-1.5 h-8 min-w-[7.5rem] px-3 rounded-lg border text-xs font-bold"
          style={
            accent
              ? { background: 'var(--accent-strong)', borderColor: 'var(--accent-strong)', color: 'var(--text-on-accent)' }
              : { background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
          }
        >
          <Icon name={actionIcon} className="w-3.5 h-3.5" />
          {actionLabel}
        </span>
      </button>
    </div>
  );
}

export type IconName =
  | 'close' | 'copy' | 'download' | 'upload' | 'cloud-up' | 'cloud-down' | 'file' | 'list' | 'code'
  | 'cart' | 'export' | 'import' | 'trash' | 'device' | 'check' | 'user' | 'heart';

const PATHS: Record<IconName, React.ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></>,
  download: <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />,
  upload: <path d="M12 16V5m0 0L8 9m4-4l4 4M5 19h14" />,
  'cloud-up': <path d="M7 18a4 4 0 01-.9-7.9A5.5 5.5 0 0116.7 8 4.5 4.5 0 0117 18M12 18v-7m0 0l-3 3m3-3l3 3" />,
  'cloud-down': <path d="M7 18a4 4 0 01-.9-7.9A5.5 5.5 0 0116.7 8 4.5 4.5 0 0117 18M12 11v7m0 0l-3-3m3 3l3-3" />,
  file: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  cart: <><circle cx="9" cy="20" r="1.2" /><circle cx="18" cy="20" r="1.2" /><path d="M2 3h3l2.7 12.4a2 2 0 002 1.6h8.1a2 2 0 002-1.5L21 7H6" /></>,
  export: <path d="M12 3v12m0-12L8 7m4-4l4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" />,
  import: <path d="M12 15V3m0 12l-4-4m4 4l4-4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  device: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
  heart: <path d="M12 20s-7.5-4.6-9.3-9.4A5 5 0 0112 6.2a5 5 0 019.3 4.4C19.5 15.4 12 20 12 20z" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
