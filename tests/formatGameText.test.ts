import { describe, expect, it } from 'vitest';
import { formatGameText } from '../src/lib/formatGameText';

describe('formatGameText Riftbound tokens & icons', () => {
  it('renders Might icon for :rb_might:, :might:, bare rb_might, [S], and [M] without breaking the English word "might"', () => {
    const html = formatGameText(
      'Give it -1 :rb_might:, +2 :might:, or +1 rb_might this turn. This might draw [S] [M].'
    );
    const mightMatches = html.match(/alt="Might"/g) || [];
    expect(mightMatches).toHaveLength(5);
    expect(html).toContain('This might draw');
  });

  it('renders Exhaust, Energy, Rune rainbow, and [Add] / [Reaction] badges cleanly for riftbound.gg special cards', () => {
    const akali = formatGameText(
      "[Empower] :rb_energy_3::rb_rune_rainbow: (:rb_energy_3::rb_rune_rainbow:: Empower this.)<br />[Action][&gt;] :rb_exhaust:: Move a unit."
    );
    expect(akali).toContain('>EMPOWER<');
    expect(akali).toContain('>Action<');
    expect(akali).toContain('&#x27A4;');
    expect(akali).toContain('alt="Exhaust"');
    expect(akali).toContain('alt="rainbow Rune"');
    expect(akali).toContain('>3<');

    const kaisa = formatGameText(
      'Kill this, :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:.'
    );
    expect(kaisa).toContain('alt="Exhaust"');
    expect(kaisa).toContain('>Reaction<');
    expect(kaisa).toContain('>ADD<');
    expect(kaisa).toContain('alt="rainbow Rune"');
  });
});
