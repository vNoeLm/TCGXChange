import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  lockBodyScroll,
  unlockBodyScroll,
  forceResetBodyScroll,
  getScrollLockCount,
} from '../src/lib/scrollLock';

describe('scrollLock', () => {
  let mockBody: { style: { overflow: string } };

  beforeEach(() => {
    mockBody = { style: { overflow: '' } };
    (global as any).document = {
      body: mockBody,
      addEventListener: () => {},
    };
    forceResetBodyScroll();
  });

  afterEach(() => {
    forceResetBodyScroll();
  });

  it('locks body scroll on first call and restores on unlock', () => {
    expect(mockBody.style.overflow).toBe('');
    expect(getScrollLockCount()).toBe(0);

    const unlock = lockBodyScroll();
    expect(mockBody.style.overflow).toBe('hidden');
    expect(getScrollLockCount()).toBe(1);

    unlock();
    expect(mockBody.style.overflow).toBe('');
    expect(getScrollLockCount()).toBe(0);
  });

  it('handles multiple concurrent locks correctly (reference counting)', () => {
    const unlock1 = lockBodyScroll();
    expect(mockBody.style.overflow).toBe('hidden');
    expect(getScrollLockCount()).toBe(1);

    const unlock2 = lockBodyScroll();
    expect(mockBody.style.overflow).toBe('hidden');
    expect(getScrollLockCount()).toBe(2);

    // Release first lock - should remain locked
    unlock1();
    expect(mockBody.style.overflow).toBe('hidden');
    expect(getScrollLockCount()).toBe(1);

    // Release second lock - now unlocks
    unlock2();
    expect(mockBody.style.overflow).toBe('');
    expect(getScrollLockCount()).toBe(0);
  });

  it('does not re-unlock if unlock is called multiple times by the same token', () => {
    const unlock1 = lockBodyScroll();
    const unlock2 = lockBodyScroll();
    expect(getScrollLockCount()).toBe(2);

    unlock1();
    unlock1(); // duplicate call
    expect(getScrollLockCount()).toBe(1);
    expect(mockBody.style.overflow).toBe('hidden');

    unlock2();
    expect(getScrollLockCount()).toBe(0);
    expect(mockBody.style.overflow).toBe('');
  });

  it('never restores "hidden" as original style even if body already had "hidden"', () => {
    mockBody.style.overflow = 'hidden';
    const unlock = lockBodyScroll();
    expect(mockBody.style.overflow).toBe('hidden');

    unlock();
    // Must restore to '' not 'hidden'
    expect(mockBody.style.overflow).toBe('');
    expect(getScrollLockCount()).toBe(0);
  });

  it('forceResetBodyScroll clears any lingering locks', () => {
    lockBodyScroll();
    lockBodyScroll();
    expect(getScrollLockCount()).toBe(2);
    expect(mockBody.style.overflow).toBe('hidden');

    forceResetBodyScroll();
    expect(getScrollLockCount()).toBe(0);
    expect(mockBody.style.overflow).toBe('');
  });
});
