import { describe, it, expect } from 'vitest';
import { resolveCardImagePath, cardThumbProps, getCardImageUrl, getCardThumbUrl } from '../src/lib/supabase';

describe('Image resilience and path aliasing', () => {
  it('maps legacy arc-005.webp to ogn-202b.webp', () => {
    expect(resolveCardImagePath('riftbound/arc-005.webp')).toBe('riftbound/ogn-202b.webp');
    expect(resolveCardImagePath('/riftbound/arc-005.webp')).toBe('riftbound/ogn-202b.webp');
  });

  it('preserves valid card paths', () => {
    expect(resolveCardImagePath('riftbound/ogn-001.webp')).toBe('riftbound/ogn-001.webp');
  });

  it('generates resilient cardThumbProps with onError handler', () => {
    const props = cardThumbProps('riftbound/ogn-001.webp', 'grid');
    expect(props.src).toContain('thumbs/v1/240/riftbound/ogn-001.webp');
    expect(props.srcSet).toBeDefined();
    expect(typeof props.onError).toBe('function');
  });

  it('generates correct props for absolute URLs and includes onError handler', () => {
    const abs = 'https://example.com/card.webp';
    const props = cardThumbProps(abs, 'avatar');
    expect(props.src).toBe(abs);
    expect(typeof props.onError).toBe('function');
  });

  it('resolves legacy path when calling getCardImageUrl', () => {
    const url = getCardImageUrl('riftbound/arc-005.webp');
    expect(url).toContain('riftbound/ogn-202b.webp');
  });

  it('resolves legacy path when calling getCardThumbUrl', () => {
    const thumbUrl = getCardThumbUrl('riftbound/arc-005.webp', 240);
    expect(thumbUrl).toContain('riftbound/ogn-202b.webp');
  });
});
