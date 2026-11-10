import { describe, it, expect } from 'vitest';
import { validateDisplayName, MIN_DISPLAY_NAME_LENGTH, MAX_DISPLAY_NAME_LENGTH } from '../src/lib/profileValidation';
import { getProfileUrl } from '../src/lib/profileUrl';

describe('Profile display name constraints and validation', () => {
  it('accepts valid display names with letters, numbers, spaces, hyphens, and underscores', () => {
    expect(validateDisplayName('Noel').valid).toBe(true);
    expect(validateDisplayName('Noel 3').valid).toBe(true);
    expect(validateDisplayName('Noel-3').valid).toBe(true);
    expect(validateDisplayName('Noel_3').valid).toBe(true);
    expect(validateDisplayName('Samuel Majdik').valid).toBe(true);
    expect(validateDisplayName('Kovács Béla').valid).toBe(true);
    expect(validateDisplayName('Ágnes_99').valid).toBe(true);
  });

  it('rejects names with URL-breaking or disallowed punctuation like :, /, ?, #, @', () => {
    // Specifically test ":3" which the user brought up
    const r1 = validateDisplayName('Noel :3');
    expect(r1.valid).toBe(false);
    expect(r1.error).toContain('kettőspont');

    expect(validateDisplayName(':3').valid).toBe(false);
    expect(validateDisplayName('User/Admin').valid).toBe(false);
    expect(validateDisplayName('User?test').valid).toBe(false);
    expect(validateDisplayName('User#123').valid).toBe(false);
    expect(validateDisplayName('User@domain').valid).toBe(false);
    expect(validateDisplayName('User<test>').valid).toBe(false);
    expect(validateDisplayName('User!').valid).toBe(false);
    expect(validateDisplayName('User$').valid).toBe(false);
    expect(validateDisplayName('User%20').valid).toBe(false);
  });

  it('enforces length constraints', () => {
    expect(validateDisplayName('a').valid).toBe(false);
    expect(validateDisplayName('').valid).toBe(false);
    expect(validateDisplayName('   ').valid).toBe(false);
    expect(validateDisplayName('ab').valid).toBe(true);

    const tooLong = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1);
    expect(validateDisplayName(tooLong).valid).toBe(false);

    const maxAllowed = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH);
    expect(validateDisplayName(maxAllowed).valid).toBe(true);
  });

  it('trims leading and trailing whitespace', () => {
    const res = validateDisplayName('  Clean Name  ');
    expect(res.valid).toBe(true);
    expect(res.name).toBe('Clean Name');
  });

  it('produces clean, URL-safe profile links for copy button', () => {
    const user = { id: 'd47ca466-6520-46ec-aff2-718732f1baf7', display_name: 'Noel 3' };
    const url = getProfileUrl(user);
    expect(url).toBe('/profile/noel-3-d47ca4');
    expect(url).not.toContain(':');
  });
});
