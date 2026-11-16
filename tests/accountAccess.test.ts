import { describe, it, expect } from 'vitest';
import {
  RESTRICTED_PATHS,
  isRestrictedPath,
  isRestrictedApiPath,
  getBanSummary,
  getBanDetail,
} from '../src/lib/accountAccess';

describe('accountAccess (suspended account boundaries)', () => {
  it('restricts messaging and marketplace pages for suspended accounts', () => {
    expect([...RESTRICTED_PATHS]).toEqual(['/messages', '/marketplace']);

    expect(isRestrictedPath('/messages')).toBe(true);
    expect(isRestrictedPath('/messages/thread-1')).toBe(true);
    expect(isRestrictedPath('/messages/?tab=all')).toBe(true);
    expect(isRestrictedPath('/marketplace')).toBe(true);
    expect(isRestrictedPath('/marketplace/posts')).toBe(true);

    expect(isRestrictedPath('/')).toBe(false);
    expect(isRestrictedPath('/cards')).toBe(false);
    expect(isRestrictedPath('/store')).toBe(false);
    expect(isRestrictedPath('/decks')).toBe(false);
    expect(isRestrictedPath('/profile')).toBe(false);
    expect(isRestrictedPath('/seller')).toBe(false);
  });

  it('restricts messaging, marketplace, review, and reporting APIs while keeping catalog and store APIs accessible', () => {
    expect(isRestrictedApiPath('/api/messages')).toBe(true);
    expect(isRestrictedApiPath('/api/messages/upload-image')).toBe(true);
    expect(isRestrictedApiPath('/api/reports/submit')).toBe(true);
    expect(isRestrictedApiPath('/api/reports?id=1')).toBe(true);
    expect(isRestrictedApiPath('/api/marketplace/listings')).toBe(true);
    expect(isRestrictedApiPath('/api/reviews')).toBe(true);

    expect(isRestrictedApiPath('/api/cards')).toBe(false);
    expect(isRestrictedApiPath('/api/store/products')).toBe(false);
    expect(isRestrictedApiPath('/api/orders')).toBe(false);
  });

  it('returns localized ban copy in English and Hungarian', () => {
    expect(getBanSummary('en')).toContain('suspended');
    expect(getBanSummary('hu')).toContain('fel van függesztve');
    expect(getBanDetail('en')).toContain('official store');
    expect(getBanDetail('hu')).toContain('hivatalos áruházból');
  });
});
