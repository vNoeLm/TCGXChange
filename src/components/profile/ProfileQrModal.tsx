import React, { useMemo, useState } from 'react';
import { encodeQrMatrix } from '../../lib/qrCode';

interface ProfileQrModalProps {
  userId: string;
  displayName: string;
  onClose: () => void;
}

export function ProfileQrModal({ userId, displayName, onClose }: ProfileQrModalProps) {
  const [copied, setCopied] = useState(false);

  const profileUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://tcgxchange.net';
    return `${origin}/user?id=${encodeURIComponent(userId)}`;
  }, [userId]);

  const matrix = useMemo(() => encodeQrMatrix(profileUrl), [profileUrl]);
  const size = matrix.length;
  const quietZone = 3;
  const viewBoxSize = size + quietZone * 2;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `${displayName} — TCGXchange Profile`,
          text: `Check out ${displayName}'s profile and active card listings on TCGXchange:`,
          url: profileUrl,
        });
      } catch {}
    } else {
      handleCopy();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-5 sm:p-6 shadow-2xl text-center"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-xl flex items-center justify-center border"
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 19h2M19 14v2" />
              </svg>
            </span>
            <div className="text-left">
              <h3 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                Profile QR Code
              </h3>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {displayName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR modal"
            className="w-8 h-8 rounded-full flex items-center justify-center border cursor-pointer"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Scan this QR code to immediately open this collector&apos;s public profile, ratings, and active listings.
        </p>

        {/* Crisp white QR pad so phone cameras scan reliably in both dark and light mode */}
        <div className="mx-auto w-56 h-56 p-3 rounded-2xl bg-white border shadow-inner flex items-center justify-center mb-4" style={{ borderColor: 'var(--border)' }}>
          <svg
            viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
            className="w-full h-full"
            shapeRendering="crispEdges"
            role="img"
            aria-label={`QR code for ${displayName}'s profile`}
          >
            <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
            {matrix.map((row, r) =>
              row.map((dark, c) =>
                dark ? (
                  <rect
                    key={`${r}-${c}`}
                    x={c + quietZone}
                    y={r + quietZone}
                    width={1}
                    height={1}
                    fill="#090a0f"
                  />
                ) : null
              )
            )}
          </svg>
        </div>

        <div
          className="text-[11px] font-mono px-3 py-2 rounded-xl border truncate mb-3"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
          title={profileUrl}
        >
          {profileUrl}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="h-10 px-3 rounded-xl text-xs font-bold border inline-flex items-center justify-center gap-1.5 cursor-pointer"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            <span>{copied ? 'Link Copied!' : 'Copy Link'}</span>
          </button>
          <button
            type="button"
            onClick={handleNativeShare}
            className="h-10 px-3 rounded-xl text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>Share Profile</span>
          </button>
        </div>
      </div>
    </div>
  );
}
