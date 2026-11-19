import React from 'react';
import { gridSizeClasses, type GridSize } from '../../lib/gridSize';

export interface CardGridSkeletonProps {
  gridSize?: GridSize;
  count?: number;
  showFooter?: boolean;
  className?: string;
}

/**
 * Shared aspect-accurate (`aspect-[63/88]`) skeleton grid matching `CardListItem` and
 * `gridSizeClasses(gridSize)` to eliminate layout shift during catalog, marketplace,
 * and collection loading states.
 */
export function CardGridSkeleton({
  gridSize = 'normal',
  count = 12,
  showFooter = true,
  className = '',
}: CardGridSkeletonProps) {
  const isSmall = gridSize === 'small';
  return (
    <div
      className={`grid ${gridSizeClasses(gridSize)} ${className}`}
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl overflow-hidden border flex flex-col animate-pulse"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <div
            className="w-full aspect-[63/88]"
            style={{ background: 'var(--bg-surface-2)' }}
          />
          {showFooter && (
            <div className={`${isSmall ? 'p-2.5 gap-1.5' : 'p-3 gap-2'} flex flex-col`}>
              <div className="h-3.5 w-3/4 mx-auto rounded" style={{ background: 'var(--bg-surface-2)' }} />
              <div className="h-2.5 w-1/2 rounded" style={{ background: 'var(--bg-surface-2)' }} />
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="h-2.5 w-1/3 rounded" style={{ background: 'var(--bg-surface-2)' }} />
                <div className="h-2.5 w-1/4 rounded" style={{ background: 'var(--bg-surface-2)' }} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
