import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../../lib/useExitTransition';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { backdropCloseProps } from '../../lib/modalBackdrop';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  ariaLabel: string;
  maxWidthClass?: string;
  zIndex?: number;
  closeDisabled?: boolean;
  children: React.ReactNode;
}

/**
 * Shared slide-over drawer primitive (left or right edge).
 * Provides exit transition, body scroll lock, Escape dismissal, focus restoration,
 * portal rendering, and safe-area edge padding.
 */
export function Drawer({
  open,
  onClose,
  side = 'left',
  ariaLabel,
  maxWidthClass = 'max-w-sm',
  zIndex = 110,
  closeDisabled = false,
  children,
}: DrawerProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabledRef.current) {
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prevFocused && typeof prevFocused.focus === 'function') {
        prevFocused.focus();
      }
    };
  }, [open]);

  useBodyScrollLock(open);
  const { rendered, state } = useExitTransition(open, 400);

  if (!rendered) return null;

  const isRight = side === 'right';

  const content = (
    <div
      {...backdropCloseProps(onClose, { disabled: closeDisabled })}
      data-state={state}
      style={{ position: 'fixed', inset: 0, zIndex, display: 'flex', justifyContent: isRight ? 'flex-end' : 'flex-start', background: 'rgba(0,0,0,0.7)' }}
      className="tv-overlay backdrop-blur-xs"
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        data-state={state}
        className={`${isRight ? 'tv-drawer-right border-l' : 'tv-drawer-left border-r'} w-full ${maxWidthClass} h-[100dvh] flex flex-col shadow-2xl`}
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {children}
      </aside>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
