import React, { useMemo } from 'react';
import { formatGameText } from '../../lib/formatGameText';
import { useLanguage } from '../../lib/i18n';

interface CardTextPreviewProps {
  text: string;
  label?: string;
  italic?: boolean;
  className?: string;
}

/**
 * Live formatted preview of card rules/errata markup (<br />, [Action], [Assault 3], :rb_might:, etc.)
 * using the exact same formatGameText renderer as CardDetail.
 */
export function CardTextPreview({ text, label, italic = false, className = '' }: CardTextPreviewProps) {
  const { t } = useLanguage();
  const trimmed = text.trim();
  const html = useMemo(() => (trimmed ? formatGameText(trimmed) : ''), [trimmed]);

  if (!trimmed) return null;

  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 ${className}`}
      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
    >
      <div
        className="text-[10px] font-bold uppercase tracking-wider mb-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label || t('Preview', 'Előnézet')}
      </div>
      <div
        className={`text-xs sm:text-sm leading-relaxed whitespace-pre-line ${italic ? 'italic' : ''}`}
        style={{ color: italic ? 'var(--text-secondary)' : 'var(--text-primary)' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
