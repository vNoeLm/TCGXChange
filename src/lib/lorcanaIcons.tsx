import React from 'react';

export const LORCANA_INK_COLORS: Record<string, string> = {
  amber: '#f59e0b',
  amethyst: '#a855f7',
  emerald: '#10b981',
  ruby: '#ef4444',
  sapphire: '#3b82f6',
  steel: '#94a3b8',
};

/**
 * Hexagonal Lorcana Inkwell indicator matching official ink-convertible vs non-inkable symbols:
 * - inkable=true: solid ring with left/right outward prongs surrounding a crisp inner hexagon.
 * - inkable=false: clean plain upright hexagon outline.
 */
export function LorcanaInkableIcon({
  inkable,
  className = 'w-4 h-4',
  style,
}: {
  inkable: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (inkable) {
    return (
      <svg
        className={className}
        style={style}
        viewBox="0 0 24 24"
        fill="currentColor"
        fillRule="evenodd"
        aria-hidden="true"
      >
        <path d="M12 2.4A9.6 9.6 0 0 1 21.15 10.35L23.5 12L21.15 13.65A9.6 9.6 0 0 1 12 21.6A9.6 9.6 0 0 1 2.85 13.65L0.5 12L2.85 10.35A9.6 9.6 0 0 1 12 2.4ZM12 6.3L7.05 9.15V14.85L12 17.7L16.95 14.85V9.15L12 6.3Z" />
      </svg>
    );
  }
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.3}
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <polygon points="12,3.1 19.7,7.55 19.7,16.45 12,20.9 4.3,16.45 4.3,7.55" />
    </svg>
  );
}

/**
 * Hexagonal crest icons for Lorcana's 6 inks (Amber, Amethyst, Emerald, Ruby, Sapphire, Steel).
 */
export function LorcanaInkIcon({
  ink,
  className = 'w-4 h-4',
  style,
}: {
  ink: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const key = (ink || '').trim().toLowerCase();
  const hexFrame = (
    <polygon
      points="12,1.6 21,6.8 21,17.2 12,22.4 3,17.2 3,6.8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="miter"
    />
  );

  switch (key) {
    case 'amber':
      return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {hexFrame}
          <path
            d="M12 4.8L16.4 7.35V12.1C16.4 15.1 12 18.2 12 18.2C12 18.2 7.6 15.1 7.6 12.1V7.35L12 4.8Z"
            stroke="currentColor"
            strokeWidth={1.55}
            strokeLinejoin="miter"
          />
          <path
            d="M8.6 14.2L12 7.9L15.4 14.2M9.2 9.6L14.8 14.0M14.8 9.6L9.2 14.0"
            stroke="currentColor"
            strokeWidth={1.55}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'amethyst':
      return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {hexFrame}
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <path
              key={deg}
              d="M12.7 9.6C14.8 7.0 17.6 7.8 17.6 10.6C16.0 9.6 14.3 10.2 13.4 11.4Z"
              fill="currentColor"
              transform={`rotate(${deg} 12 12)`}
            />
          ))}
          <circle cx="12" cy="12" r="1.9" fill="none" stroke="currentColor" strokeWidth={1.2} />
        </svg>
      );

    case 'emerald':
      return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {hexFrame}
          <path
            d="M6.4 15.5C8.3 11.4 13.2 13.2 16.0 8.8C17.0 11.9 14.9 16.7 10.0 17.2C8.4 17.3 7.0 16.6 6.4 15.5Z"
            fill="currentColor"
          />
          <path
            d="M12.9 5.0L13.65 7.05L15.7 7.8L13.65 8.55L12.9 10.6L12.15 8.55L10.1 7.8L12.15 7.05Z"
            fill="currentColor"
          />
        </svg>
      );

    case 'ruby':
      return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {hexFrame}
          <path
            d="M6.0 12.1C8.8 7.8 13.2 6.7 17.6 6.6C14.3 9.0 11.8 10.9 8.0 13.9Z"
            fill="currentColor"
          />
          <path
            d="M7.0 15.8C10.4 12.2 14.4 11.0 18.2 11.2C14.9 13.6 12.4 15.2 9.0 17.4Z"
            fill="currentColor"
          />
          <path
            d="M11.6 18.2C13.6 16.2 15.6 15.3 17.8 15.3C16.1 16.9 14.4 18.1 12.6 19.0Z"
            fill="currentColor"
          />
        </svg>
      );

    case 'sapphire':
      return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {hexFrame}
          <ellipse cx="12" cy="12" rx="6.2" ry="2.7" transform="rotate(34 12 12)" stroke="currentColor" strokeWidth={1.5} />
          <ellipse cx="12" cy="12" rx="6.2" ry="2.7" transform="rotate(-34 12 12)" stroke="currentColor" strokeWidth={1.5} />
          <path d="M12 8.7L13.4 12L12 15.3L10.6 12Z" fill="currentColor" />
        </svg>
      );

    case 'steel':
      return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {hexFrame}
          <path d="M6.4 8.6L9.8 6.5V14.1H7.9V11.3H6.4V8.6Z" fill="currentColor" />
          <path d="M17.6 8.6L14.2 6.5V14.1H16.1V11.3H17.6V8.6Z" fill="currentColor" />
          <rect x="10.9" y="5.6" width="2.2" height="8.7" fill="currentColor" />
          <path d="M12 19.0L7.6 16.1L10.4 16.4L12 13.5L13.6 16.4L16.4 16.1Z" fill="currentColor" />
        </svg>
      );

    default:
      return (
        <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {hexFrame}
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        </svg>
      );
  }
}
