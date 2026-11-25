import React from 'react';
import {
  doesMentionMatchCard,
  parsePostDescriptionSegments,
  type MentionableCard,
} from '../../lib/postMentions';

export interface PostDescriptionTagRef {
  card_id?: string;
  status?: string;
  card?: MentionableCard | null;
}

interface PostDescriptionRendererProps {
  body: string;
  taggedCards?: PostDescriptionTagRef[];
  onCardClick?: (cardId: string) => void;
  emptyFallback?: string;
}

const INLINE_TOKEN_RE = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInlineMarkdown(
  text: string,
  keyPrefix: string
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;

  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > lastIdx) {
      parts.push(text.slice(lastIdx, start));
    }
    const token = match[0];
    const key = `${keyPrefix}_${start}`;

    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={key} className="font-bold" style={{ color: 'var(--text-primary)' }}>
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      parts.push(
        <del key={key} className="line-through opacity-70">
          {token.slice(2, -2)}
        </del>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded text-[11px] font-mono border"
          style={{
            background: 'var(--bg-input)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-semibold hover:opacity-80"
            style={{ color: 'var(--text-accent)' }}
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }

    lastIdx = start + token.length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}

function renderInlineWithMentions(
  line: string,
  keyPrefix: string,
  taggedCards: PostDescriptionTagRef[],
  onCardClick?: (cardId: string) => void
): React.ReactNode {
  const segments = parsePostDescriptionSegments(line);
  if (segments.length === 0) return null;

  return segments.map((seg, idx) => {
    const segKey = `${keyPrefix}_seg_${idx}`;
    if (seg.type === 'text') {
      return <React.Fragment key={segKey}>{renderInlineMarkdown(seg.text, segKey)}</React.Fragment>;
    }
    const matchedTag = taggedCards.find((tc) => tc.card && doesMentionMatchCard(seg.rawInner, tc.card));
    const cardId = matchedTag?.card?.id || matchedTag?.card_id;
    const isSoldTag = matchedTag?.status === 'sold';
    const clickable = Boolean(cardId && onCardClick);
    return (
      <button
        key={segKey}
        type="button"
        onClick={() => {
          if (cardId && onCardClick) onCardClick(cardId);
        }}
        disabled={!clickable}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border text-xs font-bold align-baseline transition ${
          clickable ? 'cursor-pointer hover:border-[var(--accent)]' : 'cursor-default'
        } ${isSoldTag ? 'line-through opacity-60' : ''}`}
        style={{
          background: 'var(--bg-input)',
          borderColor: 'var(--border)',
          color: 'var(--text-accent)',
        }}
      >
        <span>@{seg.displayName}</span>
        {seg.cardNumber && (
          <span className="text-[10px] font-mono opacity-70">{seg.cardNumber}</span>
        )}
      </button>
    );
  });
}

/**
 * Reusable rich-text + `@[Card Name · Num]` mention renderer for marketplace post descriptions
 * and live editor previews.
 */
export function PostDescriptionRenderer({
  body,
  taggedCards = [],
  onCardClick,
  emptyFallback,
}: PostDescriptionRendererProps) {
  const trimmed = (body || '').trim();
  if (!trimmed) {
    return emptyFallback ? (
      <span className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
        {emptyFallback}
      </span>
    ) : null;
  }

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const lineTrim = raw.trim();

    if (!lineTrim) {
      i += 1;
      continue;
    }

    if (/^-{3,}$/.test(lineTrim)) {
      blocks.push(
        <hr key={`hr_${i}`} className="my-2 border-t" style={{ borderColor: 'var(--border-subtle)' }} />
      );
      i += 1;
      continue;
    }

    const headingMatch = raw.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls =
        level === 1
          ? 'text-base font-black mt-1'
          : level === 2
          ? 'text-sm font-black mt-1'
          : 'text-xs font-extrabold uppercase tracking-wide mt-1';
      blocks.push(
        <div key={`h_${i}`} className={cls} style={{ color: 'var(--text-primary)' }}>
          {renderInlineWithMentions(headingMatch[2], `h_${i}`, taggedCards, onCardClick)}
        </div>
      );
      i += 1;
      continue;
    }

    if (/^>\s?/.test(raw)) {
      const quoteLines: string[] = [];
      const startIdx = i;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`q_${startIdx}`}
          className="pl-3 py-0.5 border-l-2 space-y-1 text-xs"
          style={{ borderColor: 'var(--accent)', color: 'var(--text-secondary)' }}
        >
          {quoteLines.map((ql, qIdx) => (
            <div key={`ql_${qIdx}`}>
              {renderInlineWithMentions(ql, `q_${startIdx}_${qIdx}`, taggedCards, onCardClick)}
            </div>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(raw)) {
      const items: string[] = [];
      const startIdx = i;
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul_${startIdx}`} className="list-disc pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={`li_${idx}`}>
              {renderInlineWithMentions(item, `ul_${startIdx}_${idx}`, taggedCards, onCardClick)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(raw)) {
      const items: string[] = [];
      const startIdx = i;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol_${startIdx}`} className="list-decimal pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={`li_${idx}`}>
              {renderInlineWithMentions(item, `ol_${startIdx}_${idx}`, taggedCards, onCardClick)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    blocks.push(
      <p key={`p_${i}`} className="leading-relaxed">
        {renderInlineWithMentions(raw, `p_${i}`, taggedCards, onCardClick)}
      </p>
    );
    i += 1;
  }

  return <div className="space-y-1.5">{blocks}</div>;
}
