import { describe, it, expect } from 'vitest';
import { GAMES } from '../src/lib/constants';
import * as fs from 'fs';
import * as path from 'path';

describe('Games Configuration', () => {
  it('has Riftbound, One Piece, and Disney Lorcana as the active games', () => {
    const activeIds = GAMES.filter((g) => g.active !== false).map((g) => g.id);
    expect(activeIds).toEqual(['riftbound', 'onepiece', 'lorcana']);
  });

  it('marks unlaunched games as inactive (coming soon)', () => {
    const inactiveGames = GAMES.filter((g) => g.active === false);
    const inactiveIds = inactiveGames.map((g) => g.id);

    expect(inactiveIds).toContain('mtg');
    expect(inactiveIds).toContain('starwars');
    expect(inactiveIds).toContain('fab');
    expect(inactiveGames.length).toBe(3);
  });

  it('ensures Scryfall API import script is removed', () => {
    const importScriptPath = path.resolve(process.cwd(), 'scripts/import_mtg.mjs');
    expect(fs.existsSync(importScriptPath)).toBe(false);
  });

  it('ensures LegalFooter does not contain MTG disclaimer', () => {
    const legalFooterPath = path.resolve(process.cwd(), 'src/components/LegalFooter.tsx');
    const content = fs.readFileSync(legalFooterPath, 'utf-8');
    expect(content).not.toContain('Wizards of the Coast');
    expect(content).not.toContain('Magic: The Gathering');
    // Other games should still be present
    expect(content).toContain('Riftbound');
    expect(content).toContain('One Piece Card Game');
    expect(content).toContain('Disney Lorcana');
  });

  it('ensures copyright page does not contain MTG or Scryfall notices', () => {
    const copyrightPath = path.resolve(process.cwd(), 'src/pages/legal/copyright.astro');
    const content = fs.readFileSync(copyrightPath, 'utf-8');
    expect(content).not.toContain('Wizards of the Coast');
    expect(content).not.toContain('Magic: The Gathering');
    expect(content).not.toContain('Scryfall');
    // Other games should still be present
    expect(content).toContain('Riftbound');
    expect(content).toContain('One Piece Card Game');
  });

  it('ensures privacy page does not contain Scryfall processor', () => {
    const privacyPath = path.resolve(process.cwd(), 'src/pages/legal/privacy.astro');
    const content = fs.readFileSync(privacyPath, 'utf-8');
    expect(content).not.toContain('Scryfall');
  });
});
