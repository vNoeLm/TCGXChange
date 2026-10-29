import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../../lib/useExitTransition';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
  showCloseButton?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  className = '',
  showCloseButton = true,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { rendered, state } = useExitTransition(isOpen, 250);

  const getFocusableElements = (): HTMLElement[] => {
    if (!panelRef.current) return [];
    const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>(selector)).filter(
      el => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0
    );
  };

  // Auto-focus only when modal opens; never steal focus from an already focused element inside the panel
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      if (panelRef.current && panelRef.current.contains(document.activeElement)) {
        return;
      }
      const autoFocusEl = panelRef.current?.querySelector<HTMLElement>('[autofocus]');
      if (autoFocusEl) {
        autoFocusEl.focus();
        return;
      }
      const firstInput = panelRef.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])');
      if (firstInput) {
        firstInput.focus();
        return;
      }
      const focusables = getFocusableElements();
      if (focusables.length > 0) {
        focusables[0].focus();
      } else if (panelRef.current) {
        panelRef.current.focus();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen]);

  // Focus trap, keyboard navigation (Escape, Tab), and focus restoration
  useEffect(() => {
    if (!isOpen) return;

    const previousFocusedElement = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        const elements = getFocusableElements();
        if (elements.length === 0) {
          e.preventDefault();
          return;
        }
        const first = elements[0];
        const last = elements[elements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === panelRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocusedElement && typeof previousFocusedElement.focus === 'function') {
        previousFocusedElement.focus();
      }
    };
  }, [isOpen]);

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!rendered) return null;

  const content = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Modal dialog'}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      data-state={state}
      className="tv-overlay fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/85 overflow-y-auto"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        data-state={state}
        className={`tv-modal-panel w-full ${maxWidth} my-auto rounded-2xl border shadow-2xl overflow-hidden focus:outline-none ${className}`}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            {title ? (
              <h3 className="text-base sm:text-lg font-black truncate pr-2" style={{ color: 'var(--text-primary)' }}>
                {title}
              </h3>
            ) : <div />}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal dialog"
                style={{ color: 'var(--text-tertiary)' }}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition cursor-pointer shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}

        <div className="p-5 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
