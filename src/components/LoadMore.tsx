import { useEffect, useRef, useState } from 'react';

export interface LoadMoreState {
  /** How many items to render. */
  shown: number;
  hasMore: boolean;
  /** True once the person asked for more. */
  auto: boolean;
  loadMore: () => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  maxLimit?: number;
}

export const DEFAULT_LOAD_MORE_LIMIT = 288;

/**
 * A long card list that starts with one batch and a "Load more" button, allowing users
 * to load additional batches.
 * This ensures DOM nodes remain manageable on initial render, mobile rendering is smooth,
 * and the footer can always be reached.
 *
 * Only what's *rendered* is limited: callers keep computing counts and totals from the full list.
 * `resetKey` starts over at one batch whenever the list itself changes (new filters, search, sort).
 */
export function useLoadMore(
  total: number,
  batchSize: number,
  resetKey: string,
  maxLimit: number = DEFAULT_LOAD_MORE_LIMIT
): LoadMoreState {
  const [shown, setShown] = useState(batchSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShown(batchSize);
  }, [resetKey, batchSize]);

  const hasMore = shown < total;

  const loadMore = () => {
    setShown((s) => Math.min(s + batchSize, total));
  };

  return { shown, hasMore, auto: false, loadMore, sentinelRef, maxLimit };
}

/** The end of the list: the "Load more" button, or an indicator when capped so the footer is reached. */
export function LoadMoreFooter({ state, total, noun }: { state: LoadMoreState; total: number; noun: string }) {
  if (!state.hasMore && state.shown >= total) return null;

  const isCappedNotice =
    state.maxLimit !== undefined &&
    state.maxLimit !== Infinity &&
    state.shown >= state.maxLimit &&
    total > state.shown;

  return (
    <div className="flex flex-col items-center gap-2.5 py-8 text-center">
      <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
        Showing {Math.min(state.shown, total).toLocaleString()} of {total.toLocaleString()} {noun}
      </p>
      {isCappedNotice && (
        <p className="text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
          Narrow your search or use filters to find specific {noun}.
        </p>
      )}
      {total > state.shown && (
        <button
          type="button"
          onClick={state.loadMore}
          className="w-full sm:w-auto px-8 py-3 rounded-xl text-sm font-bold border transition cursor-pointer hover:brightness-110 active:scale-95"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          Load more
        </button>
      )}
    </div>
  );
}
