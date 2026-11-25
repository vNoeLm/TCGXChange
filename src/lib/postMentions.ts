export interface MentionableCard {
  id?: string;
  name?: string | null;
  card_number?: string | null;
}

const MENTION_REGEX = /@\[([^\]]+)\]/g;

export function formatCardMentionToken(card: MentionableCard): string {
  const name = (card.name || '').trim();
  const num = (card.card_number || '').trim();
  return num ? `@[${name} · ${num}]` : `@[${name}]`;
}

export function extractMentionInners(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_REGEX)) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

export function doesMentionMatchCard(mentionInner: string, card: MentionableCard): boolean {
  const inner = mentionInner.trim().toLowerCase();
  if (!inner) return false;
  const name = (card.name || '').trim().toLowerCase();
  const num = (card.card_number || '').trim().toLowerCase();

  if (name && num && inner === `${name} · ${num}`) return true;
  if (name && num && inner.includes(name) && inner.includes(num)) return true;
  if (name && inner === name) return true;
  // Handle single-part name match when number is absent in mention
  if (name && !inner.includes('·') && inner === name) return true;
  return false;
}

export function bodyHasCardMention(body: string, card: MentionableCard): boolean {
  return extractMentionInners(body).some((inner) => doesMentionMatchCard(inner, card));
}

/**
 * Removes any `@[Card Name · Number]` token matching `card` from `body`,
 * cleaning up leftover spaces while keeping the rest of the line intact.
 */
export function removeCardMentionFromBody(body: string, card: MentionableCard): string {
  if (!body) return '';
  return body
    .replace(/@\[([^\]]+)\][ \t]?/g, (full, inner: string) => {
      return doesMentionMatchCard(inner, card) ? '' : full;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type PostDescriptionSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; rawInner: string; displayName: string; cardNumber: string | null };

/**
 * Splits a post description into plain text and `@[Card Name · Number]` mention segments
 * so detail views can render clickable inline card badges instead of stripping card names.
 */
export function parsePostDescriptionSegments(body: string): PostDescriptionSegment[] {
  if (!body) return [];
  const segments: PostDescriptionSegment[] = [];
  let lastIdx = 0;

  for (const match of body.matchAll(MENTION_REGEX)) {
    const start = match.index ?? 0;
    if (start > lastIdx) {
      segments.push({ type: 'text', text: body.slice(lastIdx, start) });
    }
    const rawInner = (match[1] || '').trim();
    const sepIdx = rawInner.lastIndexOf('·');
    const displayName = sepIdx !== -1 ? rawInner.slice(0, sepIdx).trim() : rawInner;
    const cardNumber = sepIdx !== -1 ? rawInner.slice(sepIdx + 1).trim() || null : null;
    segments.push({ type: 'mention', rawInner, displayName, cardNumber });
    lastIdx = start + match[0].length;
  }

  if (lastIdx < body.length) {
    segments.push({ type: 'text', text: body.slice(lastIdx) });
  }

  return segments;
}
