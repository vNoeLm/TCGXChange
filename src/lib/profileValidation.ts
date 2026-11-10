/**
 * Validation rules and utilities for user display names and profile attributes.
 */

// Allow unicode letters (\p{L}), unicode numbers (\p{N}), spaces, hyphens (-), and underscores (_).
// Explicitly disallows punctuation and URL-breaking/reserved characters such as :, /, ?, #, @, !, <, >, etc.
export const DISPLAY_NAME_REGEX = /^[\p{L}\p{N} _-]+$/u;
export const MIN_DISPLAY_NAME_LENGTH = 2;
export const MAX_DISPLAY_NAME_LENGTH = 32;

export interface DisplayNameValidationResult {
  valid: boolean;
  name?: string;
  error?: string;
}

export function validateDisplayName(
  rawName: unknown,
  lang: 'hu' | 'en' = 'hu'
): DisplayNameValidationResult {
  if (typeof rawName !== 'string') {
    return {
      valid: false,
      error: lang === 'hu' ? 'A megjelenített név megadása kötelező.' : 'Display name is required.',
    };
  }

  const trimmed = rawName.trim();

  if (trimmed.length < MIN_DISPLAY_NAME_LENGTH) {
    return {
      valid: false,
      error:
        lang === 'hu'
          ? `A névnek legalább ${MIN_DISPLAY_NAME_LENGTH} karakter hosszúnak kell lennie.`
          : `Name must be at least ${MIN_DISPLAY_NAME_LENGTH} characters.`,
    };
  }

  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      valid: false,
      error:
        lang === 'hu'
          ? `A név legfeljebb ${MAX_DISPLAY_NAME_LENGTH} karakter hosszú lehet.`
          : `Name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    };
  }

  if (!DISPLAY_NAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error:
        lang === 'hu'
          ? 'A név csak betűket, számokat, szóközöket, kötőjelet (-) és aláhúzást (_) tartalmazhat (kettőspont, perjel, kérdőjel stb. nem engedélyezett).'
          : 'Name can only contain letters, numbers, spaces, hyphens (-) and underscores (_) (symbols like :, /, ? are not allowed).',
    };
  }

  return {
    valid: true,
    name: trimmed,
  };
}
