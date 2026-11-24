import React, { useId } from 'react';

interface TcgLogoProps {
  className?: string;
  size?: number;
}

/**
 * TCG XChange brand mark (X4): dual-blade crossing X in currentColor + brand orange (#f97316),
 * with a true transparent separation gap via SVG mask so it stays crisp on any surface.
 */
export function TcgLogo({ className = 'w-7 h-7', size }: TcgLogoProps) {
  const maskId = useId();
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TCG XChange"
    >
      <defs>
        <mask id={maskId}>
          <rect width="64" height="64" fill="#ffffff" />
          <path
            d="M54 12 L39 16 L10 52 L25 48 Z"
            fill="#000000"
            stroke="#000000"
            strokeWidth="4.5"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <path d="M10 12 L25 16 L54 52 L39 48 Z" fill="currentColor" mask={`url(#${maskId})`} />
      <path d="M54 12 L39 16 L10 52 L25 48 Z" fill="#f97316" />
    </svg>
  );
}
