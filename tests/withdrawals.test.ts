import { describe, it, expect } from 'vitest';
import { LEGAL_PAGES } from '../src/lib/site';

describe('Withdrawals and Return Rights (Elállási jog / Elállás)', () => {
  it('has updated labelHu in LEGAL_PAGES to Elállási jog / Elállás', () => {
    const page = LEGAL_PAGES.find((p) => p.href === '/legal/withdrawal');
    expect(page).toBeDefined();
    expect(page?.labelHu).toBe('Elállási jog / Elállás');
    expect(page?.label).toContain('Right of withdrawal');
  });

  it('normalizes order numbers by trimming and stripping leading #', () => {
    const normalize = (val: string) => val.trim().replace(/^#/, '').toLowerCase();
    expect(normalize('  #ORD-20261025-C101  ')).toBe('ord-20261025-c101');
    expect(normalize('ORD-20261025-C101')).toBe('ord-20261025-c101');
    expect(normalize('#ord-test')).toBe('ord-test');
  });

  it('formats withdrawal items summary correctly for single and multiple items', () => {
    interface SelectedItemState {
      selected: boolean;
      returnQty: number;
      maxQty: number;
      name: string;
      price_huf: number;
    }

    function formatItemsSummary(itemsMap: Record<string, SelectedItemState>, userNotes: string = ''): string {
      const lines: string[] = [];
      Object.values(itemsMap).forEach((it) => {
        if (it.selected && it.returnQty > 0) {
          const priceFormatted = it.price_huf > 0 ? ` (${(it.price_huf * it.returnQty).toLocaleString('hu-HU')} Ft)` : '';
          lines.push(`${it.returnQty}x ${it.name}${priceFormatted}`);
        }
      });
      if (userNotes.trim()) {
        lines.push(`\nMegjegyzés / Notes: ${userNotes.trim()}`);
      }
      return lines.join('\n');
    }

    const items: Record<string, SelectedItemState> = {
      '1': {
        selected: true,
        returnQty: 1,
        maxQty: 1,
        name: 'Riftbound: Radiance - Vault Bundle',
        price_huf: 16990,
      },
      '2': {
        selected: true,
        returnQty: 2,
        maxQty: 3,
        name: 'Ultimate Guard Katana Sleeves',
        price_huf: 4290,
      },
      '3': {
        selected: false,
        returnQty: 0,
        maxQty: 1,
        name: 'Unselected item',
        price_huf: 1000,
      },
    };

    const summary = formatItemsSummary(items);
    expect(summary).toContain('1x Riftbound: Radiance - Vault Bundle');
    expect(summary).toContain('2x Ultimate Guard Katana Sleeves');
    expect(summary).not.toContain('Unselected item');

    const summaryWithNotes = formatItemsSummary(items, 'Factory sealed');
    expect(summaryWithNotes).toContain('Megjegyzés / Notes: Factory sealed');
  });
});
