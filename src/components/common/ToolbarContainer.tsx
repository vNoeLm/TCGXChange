import React from 'react';

export interface ToolbarContainerProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Unified toolbar container matching the Catalog styling across all main app sections
 * (Catalog, Marketplace, Store, Profile Collections).
 */
export function ToolbarContainer({ children, className = '', style }: ToolbarContainerProps) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl p-3.5 sm:p-4 backdrop-blur-md relative z-30 border border-[var(--border)] bg-[var(--bg-surface)]/95 shadow-[var(--shadow-card)] ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
