/**
 * Input sanitization and security utilities.
 * Defends against Stored XSS, HTML injection, prototype pollution,
 * and malicious file uploads (e.g. SVG/HTML script execution).
 */

/**
 * Strips all HTML tags, removes control characters, null bytes,
 * normalizes whitespace, and limits maximum length.
 */
export function sanitizePlainText(value: unknown, maxLength = 1000): string {
  if (typeof value !== 'string') return '';
  return value
    // Remove null bytes and dangerous control characters (except common whitespace)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Strip HTML tags completely
    .replace(/<[^>]*>/g, '')
    // Normalize consecutive whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * HTML-escapes sensitive characters to prevent DOM interpretation when rendered.
 */
export function escapeHtml(str: unknown): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes URLs to ensure they only use safe schemes (http, https).
 * Blocks javascript:, data:, and vbscript: URLs.
 */
export function sanitizeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Relative URLs starting with /
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {}

  return null;
}

/**
 * Safe filename generator: removes path traversal (../) and non-alphanumeric chars.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split('/').pop()?.split('\\').pop() || 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

/**
 * Strips PostgREST filter syntax characters (commas, parentheses, quotes, backslashes)
 * and SQL LIKE wildcards (% and _) before interpolating a term into `.or()` or `.ilike()`.
 */
export function sanitizePostgrestFilterTerm(value: unknown, maxLength = 80): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x1F\x7F,()"'\\%_]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Escapes SQL LIKE wildcards (% and _) so exact-match `.ilike()` queries cannot be wildcarded.
 */
export function escapeSqlLike(value: unknown, maxLength = 120): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength)
    .replace(/[%_\\]/g, '\\$&');
}

// ─── Image Magic Bytes Verification ──────────────────────────────────────────

const ALLOWED_IMAGE_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png']);

/**
 * Inspects binary buffer headers (magic bytes) to verify genuine image formats.
 * Blocks malicious files disguised with .jpg/.png extensions (e.g. SVG or HTML).
 */
export function verifyImageMagicBytes(buffer: Buffer): { valid: boolean; ext: string; mime: string } {
  if (!buffer || buffer.length < 12) {
    return { valid: false, ext: '', mime: '' };
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, ext: 'jpg', mime: 'image/jpeg' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return { valid: true, ext: 'png', mime: 'image/png' };
  }

  // 3. WebP: 'RIFF' at 0..3 and 'WEBP' at 8..11
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  if (riff === 'RIFF' && webp === 'WEBP') {
    return { valid: true, ext: 'webp', mime: 'image/webp' };
  }

  return { valid: false, ext: '', mime: '' };
}

export function isAllowedImageExtension(ext: string): boolean {
  return ALLOWED_IMAGE_EXTENSIONS.has(ext.toLowerCase().replace(/[^a-z]/g, ''));
}
