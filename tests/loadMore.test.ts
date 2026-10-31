import { describe, it, expect } from 'vitest';
import { DEFAULT_LOAD_MORE_LIMIT } from '../src/components/LoadMore';

describe('LoadMore constants and limit logic', () => {
  it('defines a realistic maximum limit of 288 items (6 batches of 48)', () => {
    expect(DEFAULT_LOAD_MORE_LIMIT).toBe(288);
    expect(DEFAULT_LOAD_MORE_LIMIT % 48).toBe(0);
  });

  it('caps pagination correctly for small and large collections', () => {
    const calcEffectiveMax = (total: number, maxLimit = DEFAULT_LOAD_MORE_LIMIT) => Math.min(total, maxLimit);
    
    // For small sets (e.g. 50 cards), cap is 50
    expect(calcEffectiveMax(50)).toBe(50);

    // For huge catalogs (e.g. MTG with 10,417 cards), cap is 288
    expect(calcEffectiveMax(10417)).toBe(288);

    // Custom limit overrides default
    expect(calcEffectiveMax(10417, 500)).toBe(500);
  });

  it('supports unconstrained pagination when maxLimit is Infinity', () => {
    const calcEffectiveMax = (total: number, maxLimit = Infinity) => Math.min(total, maxLimit);
    expect(calcEffectiveMax(422, Infinity)).toBe(422);
    expect(calcEffectiveMax(10417, Infinity)).toBe(10417);
  });
});
