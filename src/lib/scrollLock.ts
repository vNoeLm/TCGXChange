import { useEffect } from 'react';

let lockCount = 0;
let originalOverflow: string | null = null;

/**
 * Locks body scrolling by setting overflow: hidden on document.body.
 * Uses reference counting so concurrent or nested modals/drawers don't
 * clobber each other's lock state or leave the page permanently unscrollable.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined' || !document.body) {
    return () => {};
  }

  if (lockCount === 0) {
    const current = document.body.style.overflow;
    // Only save original overflow if it wasn't already locked as 'hidden'
    originalOverflow = current === 'hidden' ? '' : current;
    document.body.style.overflow = 'hidden';
  }

  lockCount++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    unlockBodyScroll();
  };
}

export function unlockBodyScroll(): void {
  if (typeof document === 'undefined' || !document.body) return;

  if (lockCount > 0) {
    lockCount--;
  }

  if (lockCount === 0) {
    if (originalOverflow !== null && originalOverflow !== 'hidden') {
      document.body.style.overflow = originalOverflow;
    } else {
      document.body.style.overflow = '';
    }
    originalOverflow = null;
  }
}

/**
 * React hook to lock body scrolling while `isLocked` is true.
 * Automatically releases the lock on unmount or when `isLocked` becomes false.
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return;
    const unlock = lockBodyScroll();
    return () => {
      unlock();
    };
  }, [isLocked]);
}

/**
 * Safety escape hatch: completely clears any locks and restores normal body scrolling.
 */
export function forceResetBodyScroll(): void {
  if (typeof document === 'undefined' || !document.body) return;
  lockCount = 0;
  originalOverflow = null;
  document.body.style.overflow = '';
}

export function getScrollLockCount(): number {
  return lockCount;
}

if (typeof window !== 'undefined') {
  // Clear any dangling locks if navigating across pages via Astro
  document.addEventListener('astro:after-swap', forceResetBodyScroll);
  document.addEventListener('astro:page-load', forceResetBodyScroll);
}
