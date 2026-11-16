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
      title={liked ? t('Saved', 'Mentve') : t('Save', 'Mentés')}
      className={`inline-flex items-center gap-1 rounded-xl border font-bold transition cursor-pointer disabled:opacity-60 ${
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1.5 text-xs'
      }`}
      style={
        liked
          ? {
              background: '#e11d48',
              borderColor: '#fda4af',
              color: '#ffffff',
              boxShadow: '0 2px 10px rgba(225, 29, 72, 0.5)',
            }
          : {
              background: 'rgba(9, 9, 11, 0.9)',
              borderColor: 'rgba(255, 255, 255, 0.25)',
              color: '#f4f4f5',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.55)',
            }
      }
    >
      <svg
        className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}
        viewBox="0 0 24 24"
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      <span>{count}</span>
    </button>
  );
}
