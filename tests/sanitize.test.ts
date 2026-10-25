import { describe, it, expect } from 'vitest';
import { sanitizePlainText, escapeHtml, sanitizeUrl, verifyImageMagicBytes } from '../src/lib/sanitize';
import { formatGameText } from '../src/lib/formatGameText';

describe('Sanitization & Security Tests', () => {
  it('strips script tags and malicious HTML in sanitizePlainText', () => {
    const malicious = '<script>alert("xss")</script>Hello <b>World</b><img src=x onerror=alert(1)>';
    const clean = sanitizePlainText(malicious);
    expect(clean).toBe('alert("xss")Hello World');
    expect(clean).not.toContain('<');
    expect(clean).not.toContain('>');
  });

  it('removes control characters and null bytes in sanitizePlainText', () => {
    const dirty = 'Hello\x00\x08World\x1F!';
    expect(sanitizePlainText(dirty)).toBe('HelloWorld!');
  });

  it('limits max length in sanitizePlainText', () => {
    const long = 'A'.repeat(500);
    expect(sanitizePlainText(long, 50).length).toBe(50);
  });

  it('escapes sensitive characters in escapeHtml', () => {
    expect(escapeHtml('<div class="box">&\'hello\'</div>')).toBe('&lt;div class=&quot;box&quot;&gt;&amp;&#39;hello&#39;&lt;/div&gt;');
  });

  it('validates safe URLs and blocks javascript: schemes', () => {
    expect(sanitizeUrl('https://example.com/card.png')).toBe('https://example.com/card.png');
    expect(sanitizeUrl('/marketplace/card/123')).toBe('/marketplace/card/123');
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBeNull();
  });

  it('verifies image magic bytes correctly', () => {
    // Valid JPEG header
    const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(verifyImageMagicBytes(jpegBuf)).toEqual({ valid: true, ext: 'jpg', mime: 'image/jpeg' });

    // Valid PNG header
    const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    expect(verifyImageMagicBytes(pngBuf)).toEqual({ valid: true, ext: 'png', mime: 'image/png' });

    // Valid WebP header: RIFF....WEBP
    const webpBuf = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
    ]);
    expect(verifyImageMagicBytes(webpBuf)).toEqual({ valid: true, ext: 'webp', mime: 'image/webp' });

    // Fake image / SVG file disguised as jpg
    const fakeBuf = Buffer.from('<svg onload="alert(1)"></svg>');
    expect(verifyImageMagicBytes(fakeBuf).valid).toBe(false);
  });

  it('escapes arbitrary HTML injection in formatGameText while retaining valid tokens', () => {
    const maliciousText = '<script>alert("xss")</script> [Assault 4] **bold ability** [>] test <img src=x onerror=1>';
    const formatted = formatGameText(maliciousText);

    // Raw script/img tags must be escaped
    expect(formatted).not.toContain('<script>');
    expect(formatted).not.toContain('<img src=x onerror=1>');
    expect(formatted).toContain('&lt;script&gt;');
    expect(formatted).toContain('&lt;img src=x onerror=1&gt;');

    // Legitimate styling tokens must still work
    expect(formatted).toContain('ASSAULT 4');
    expect(formatted).toContain('<strong style="color:var(--text-primary); font-weight:800;">bold ability</strong>');
    expect(formatted).toContain('&#x27A4;');
  });

  it('supports built-in Riftbound HTML formatting tags (BR, LI, UL, OL, P, B, I) in formatGameText', () => {
    // 1. Line breaks
    const brText = '[Action] (Play on your turn.)<br />This costs :rb_energy_2: less.<BR>Give a unit +3 :rb_might:.';
    const formattedBr = formatGameText(brText);
    expect(formattedBr).toContain('<br />');
    expect(formattedBr).not.toContain('&lt;br');
    expect(formattedBr).toContain('Action');

    // 2. Unordered lists (Riftbound choices)
    const listText = 'Choose one —<ul><li>Deal 2 to a unit.</li><li>[Buff] a friendly unit.</li></ul>';
    const formattedList = formatGameText(listText);
    expect(formattedList).toContain('<ul class="list-disc pl-5 my-1.5 space-y-1"');
    expect(formattedList).toContain('</ul>');
    expect(formattedList).toContain('<li class="leading-relaxed"');
    expect(formattedList).toContain('Deal 2 to a unit.</li>');
    expect(formattedList).toContain('BUFF');

    // 3. Paragraphs and emphasis
    const richText = '<p>When I attack:</p><b>Important</b> and <i>italic</i>';
    const formattedRich = formatGameText(richText);
    expect(formattedRich).toContain('<p class="my-1.5"');
    expect(formattedRich).toContain('</p>');
    expect(formattedRich).toContain('<strong style="color:var(--text-primary); font-weight:800;">Important</strong>');
    expect(formattedRich).toContain('<em class="italic" style="color:var(--text-secondary);">italic</em>');

    // 4. Pre-escaped or entity-encoded HTML tags from data imports
    const escapedTagText = 'Option A&lt;br /&gt;&lt;ul&gt;&lt;li&gt;First item&lt;/li&gt;&lt;/ul&gt;';
    const formattedEscaped = formatGameText(escapedTagText);
    expect(formattedEscaped).toContain('<br />');
    expect(formattedEscaped).toContain('<ul class="list-disc');
    expect(formattedEscaped).toContain('<li class="leading-relaxed"');
  });
});
