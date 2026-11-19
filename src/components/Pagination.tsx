import { useEffect, useState, type ReactNode, type RefObject } from 'react';

export interface PaginationState<T> {
  page: number;
  pageCount: number;
  pageItems: T[];
  total: number;
  pageSize: number;
  setPage: (page: number) => void;
}

/** One page of `items`. Goes back to page 1 whenever `resetKey` changes (a new search or filter). */
export function usePagination<T>(items: T[], pageSize: number, resetKey: string): PaginationState<T> {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  return {
    page: current,
    pageCount,
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    pageSize,
    setPage,
  };
}

/** Page numbers to show: always the first and last, the current one and its neighbours, gaps as null. */
export function pageNumbers(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

interface PaginationBarProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  summary: ReactNode;
  ariaLabel?: string;
  prevLabel?: string;
  nextLabel?: string;
  className?: string;
  borderTop?: boolean;
}

/** Shared mobile-safe windowed pagination bar so long lists never overflow narrow screens. */
export function PaginationBar({
  page,
  pageCount,
  onPageChange,
  summary,
  ariaLabel = 'Pagination',
  prevLabel = 'Prev',
  nextLabel = 'Next',
  className = 'mt-5',
  borderTop = false,
}: PaginationBarProps) {
  if (pageCount <= 1) return null;

  const btn =
    'min-w-8 sm:min-w-9 h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg border text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-default shrink-0';

  return (
    <nav
      aria-label={ariaLabel}
      className={`w-full max-w-full flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3 ${
        borderTop ? 'pt-4 border-t' : ''
      } ${className}`}
      style={borderTop ? { borderColor: 'var(--border-subtle)' } : undefined}
    >
      <p className="text-xs font-semibold text-center sm:text-left" style={{ color: 'var(--text-tertiary)' }}>
        {summary}
      </p>
      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-center max-w-full">
        <button
          type="button"
          className={btn}
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          {prevLabel}
        </button>
        {pageNumbers(page, pageCount).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="px-0.5 sm:px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPageChange(n)}
              className={btn}
              style={
                n === page
                  ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }
                  : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
              }
            >
              {n}
            </button>
          )
        )}
        <button
          type="button"
          className={btn}
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          disabled={page >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        >
          {nextLabel}
        </button>
      </div>
    </nav>
  );
}

interface PaginationProps<T> {
  state: PaginationState<T>;
  noun: string;
  /** Scrolled into view on a page change, so the new page starts at its top. */
  scrollTargetRef?: RefObject<HTMLElement | null>;
}

export function Pagination<T>({ state, noun, scrollTargetRef }: PaginationProps<T>) {
  const { page, pageCount, total, pageSize, setPage } = state;
  if (total <= pageSize) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <PaginationBar
      page={page}
      pageCount={pageCount}
      ariaLabel={`${noun} pages`}
      summary={
        <>
          {first}–{last} of {total} {noun}
        </>
      }
      onPageChange={(next) => {
        setPage(next);
        scrollTargetRef?.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }}
    />
  );
}
