import React from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../../lib/useExitTransition';

export interface ToastProps {
  open: boolean;
  message: string | null;
  type?: 'info' | 'success' | 'error';
  onDismiss?: () => void;
  dismissLabel?: string;
}

/**
 * Shared animated toast notification using `.tv-toast` + `useExitTransition`,
 * safe-area bottom inset padding, and accessible `role="status"`.
 */
export function Toast({
  open,
  message,
  type = 'info',
  onDismiss,
  dismissLabel = 'Dismiss',
}: ToastProps) {
  const { rendered, state } = useExitTransition(open && Boolean(message), 400);
  const lastMessageRef = React.useRef<string>('');
  const lastTypeRef = React.useRef<'info' | 'success' | 'error'>(type);
  if (message) {
    lastMessageRef.current = message;
    lastTypeRef.current = type;
  }

  if (!rendered) return null;

  const activeType = lastTypeRef.current;
  const styleByType =
    activeType === 'error'
      ? { background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }
      : activeType === 'success'
      ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
      : { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

  const node = (
    <div
      role="status"
      aria-live="polite"
      data-state={state}
      className="tv-toast fixed right-4 sm:right-6 z-[180] max-w-sm px-4 py-2.5 rounded-xl border text-xs font-bold shadow-2xl flex items-center gap-2.5 backdrop-blur-md"
      style={{
        ...styleByType,
        bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))',
      }}
    >
      <span className="leading-snug">{lastMessageRef.current}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="tv-touch-target w-6 h-6 rounded-md flex items-center justify-center opacity-75 hover:opacity-100 transition cursor-pointer shrink-0"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}
