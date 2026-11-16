import { useLanguage } from '../../lib/i18n';

interface LikeButtonProps {
  liked: boolean;
  count: number;
  busy?: boolean;
  onToggle: () => void;
  compact?: boolean;
}

export function LikeButton({ liked, count, busy = false, onToggle, compact = false }: LikeButtonProps) {
  const { t } = useLanguage();

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={liked ? t('Remove from Saved', 'Eltávolítás a mentettekből') : t('Like & Save', 'Kedvelés és mentés')}
      className={`inline-flex items-center gap-1 rounded-xl border font-bold transition cursor-pointer disabled:opacity-50 ${
        compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
      }`}
      style={
        liked
          ? {
              background: 'rgba(244, 63, 94, 0.14)',
              borderColor: 'rgba(244, 63, 94, 0.45)',
              color: '#fb7185',
            }
          : {
              background: 'var(--bg-surface-2)',
              borderColor: 'var(--border)',
              color: 'var(--text-secondary)',
            }
      }
    >
      <svg
        className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}
        viewBox="0 0 24 24"
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      <span>{count}</span>
    </button>
  );
}
