import React from 'react';

interface TcgLogoProps {
  className?: string;
  size?: number;
}

export function TcgLogo({ className = 'w-7 h-7', size }: TcgLogoProps) {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      style={style}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TCG XChange"
    >
      <defs>
        <filter id="tcgXShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000000" floodOpacity="0.4" />
        </filter>
      </defs>
      <path
        d="M 24 40 L 170 92 L 256 186 L 342 92 L 488 40 L 322 256 L 488 472 L 342 420 L 256 326 L 170 420 L 24 472 L 190 256 Z"
        filter="url(#tcgXShadow)"
      />
    </svg>
  );
}
