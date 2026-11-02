import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../lib/useExitTransition';
import { backdropCloseProps } from '../lib/modalBackdrop';

export interface ImageViewerProps {
  src?: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
  landscapeCard?: boolean;
  images?: string[];
  currentIndex?: number;
  onIndexChange?: (index: number) => void;
}

export type CardImageViewerProps = ImageViewerProps;

/**
 * Universal fullscreen image viewer with smooth exit animation, image rotation (R),
 * pan and zoom controls (+/- / mouse wheel / pinch / double-click), multi-image navigation,
 * and high-resolution centering. Esc or the close button closes it.
 */
export function ImageViewer({
  src,
  alt = 'Image preview',
  open,
  onClose,
  landscapeCard = false,
  images,
  currentIndex = 0,
  onIndexChange,
}: ImageViewerProps) {
  const [turns, setTurns] = useState(0);
  const [storedSideways, setStoredSideways] = useState(false);
  const [activeIdx, setActiveIdx] = useState(currentIndex);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const touchStartRef = useRef<{ x: number; y: number; panX: number; panY: number; dist?: number }>({ x: 0, y: 0, panX: 0, panY: 0 });

  const anim = useExitTransition(open, 200);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    setActiveIdx(currentIndex);
  }, [currentIndex]);

  const activeSrc = (images && images.length > 0)
    ? (images[activeIdx] || images[0] || src || '')
    : (src || '');

  const resetZoom = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(4, Math.round((s + 0.5) * 10) / 10));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => {
      const next = Math.max(1, Math.round((s - 0.5) * 10) / 10);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setTurns(0);
    resetZoom();
  }, [open, activeSrc, resetZoom]);

  const checkStored = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) {
      setStoredSideways(landscapeCard && img.naturalHeight > img.naturalWidth);
    }
  };

  useEffect(() => {
    if (anim.rendered) checkStored(imgRef.current);
  }, [anim.rendered, activeSrc, landscapeCard]);

  useEffect(() => {
    if (open && anim.rendered) closeRef.current?.focus();
  }, [open, anim.rendered]);

  const goToPrev = useCallback(() => {
    if (!images || images.length <= 1) return;
    const nextIdx = activeIdx > 0 ? activeIdx - 1 : images.length - 1;
    setActiveIdx(nextIdx);
    onIndexChange?.(nextIdx);
  }, [images, activeIdx, onIndexChange]);

  const goToNext = useCallback(() => {
    if (!images || images.length <= 1) return;
    const nextIdx = activeIdx < images.length - 1 ? activeIdx + 1 : 0;
    setActiveIdx(nextIdx);
    onIndexChange?.(nextIdx);
  }, [images, activeIdx, onIndexChange]);

  // Keyboard navigation & zoom shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (scale > 1) {
          resetZoom();
        } else {
          onClose();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        setTurns((t) => t + 1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      } else if (e.key === 'ArrowLeft') {
        if (scale > 1) {
          setPan((p) => ({ ...p, x: p.x + 40 }));
        } else {
          goToPrev();
        }
      } else if (e.key === 'ArrowRight') {
        if (scale > 1) {
          setPan((p) => ({ ...p, x: p.x - 40 }));
        } else {
          goToNext();
        }
      } else if (e.key === 'ArrowUp') {
        if (scale > 1) {
          setPan((p) => ({ ...p, y: p.y + 40 }));
        }
      } else if (e.key === 'ArrowDown') {
        if (scale > 1) {
          setPan((p) => ({ ...p, y: p.y - 40 }));
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, goToPrev, goToNext, scale, zoomIn, zoomOut, resetZoom]);

  // Non-passive wheel listener to allow smooth zooming without background scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY < 0) {
        setScale((s) => Math.min(4, Math.round((s + 0.25) * 100) / 100));
      } else {
        setScale((s) => {
          const next = Math.max(1, Math.round((s - 0.25) * 100) / 100);
          if (next === 1) setPan({ x: 0, y: 0 });
          return next;
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  // Mouse pan drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsPanning(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || scale <= 1) return;
    e.preventDefault();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Touch pan & pinch-to-zoom handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && scale > 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartRef.current.dist = Math.hypot(dx, dy);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isPanning && scale > 1) {
      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      setPan({
        x: touchStartRef.current.panX + dx,
        y: touchStartRef.current.panY + dy,
      });
    } else if (e.touches.length === 2 && touchStartRef.current.dist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.hypot(dx, dy);
      const ratio = newDist / touchStartRef.current.dist;
      setScale((s) => {
        const next = Math.max(1, Math.min(4, s * ratio));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
      touchStartRef.current.dist = newDist;
    }
  };

  const handleTouchEnd = () => {
    setIsPanning(false);
  };

  if (!anim.rendered || typeof document === 'undefined' || !activeSrc) return null;

  const rotation = (storedSideways ? 90 : 0) + turns * 90;
  const sideways = Math.abs(rotation / 90) % 2 === 1;
  const btn = 'h-11 px-3 sm:px-4 rounded-full border flex items-center gap-2 text-sm font-bold cursor-pointer transition hover:brightness-110 active:scale-95 select-none shadow-xl shrink-0';
  const btnStyle = { background: 'rgba(15,23,42,0.85)', borderColor: 'rgba(255,255,255,0.18)', color: '#f8fafc' };

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} - full view`}
      data-state={anim.state}
      className="tv-overlay fixed inset-0 z-[10001] flex items-center justify-center overflow-hidden pt-4 pb-20 select-none"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      {...backdropCloseProps(() => {
        if (scale > 1) {
          resetZoom();
        } else {
          onClose();
        }
      }, { stopPropagation: true })}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <img
        src={activeSrc}
        alt={alt}
        ref={imgRef}
        onLoad={(e) => checkStored(e.currentTarget)}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (scale > 1) {
            resetZoom();
          } else {
            setScale(2);
          }
        }}
        className="shrink-0 select-none rounded-xl shadow-2xl"
        style={{
          maxWidth: sideways ? 'calc(100vh - 7rem)' : 'calc(100vw - 2rem)',
          maxHeight: sideways ? 'calc(100vw - 2rem)' : 'calc(100vh - 7rem)',
          transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${scale})`,
          transition: isPanning ? 'none' : reduceMotion ? 'none' : 'transform 200ms var(--ease-out)',
          cursor: scale > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in',
        }}
        draggable={false}
      />

      {/* Prev / Next floating edge buttons when multiple images exist */}
      {images && images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToPrev();
            }}
            aria-label="Previous image"
            className="fixed left-3 sm:left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full border flex items-center justify-center transition hover:scale-110 active:scale-95 cursor-pointer text-white shadow-2xl z-[10002]"
            style={btnStyle}
            title="Previous (Left Arrow)"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToNext();
            }}
            aria-label="Next image"
            className="fixed right-3 sm:right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full border flex items-center justify-center transition hover:scale-110 active:scale-95 cursor-pointer text-white shadow-2xl z-[10002]"
            style={btnStyle}
            title="Next (Right Arrow)"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* Bottom controls bar with Zoom, Rotate, and Close */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 z-[10002] max-w-[95vw] overflow-x-auto p-1"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {images && images.length > 1 && (
          <div
            className="h-11 px-3 sm:px-4 rounded-full border flex items-center justify-center text-xs font-mono font-bold select-none shadow-xl shrink-0"
            style={btnStyle}
          >
            {activeIdx + 1} / {images.length}
          </div>
        )}

        {/* Zoom Out */}
        <button
          type="button"
          disabled={scale <= 1}
          onClick={(e) => {
            e.stopPropagation();
            zoomOut();
          }}
          className={`${btn} ${scale <= 1 ? 'opacity-40 cursor-not-allowed' : ''}`}
          style={btnStyle}
          title="Zoom out (-)"
          aria-label="Zoom out"
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        {/* Zoom level / Reset */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            resetZoom();
          }}
          className="h-11 px-3 sm:px-4 rounded-full border flex items-center justify-center text-xs font-mono font-bold select-none shadow-xl cursor-pointer transition hover:brightness-110 active:scale-95 shrink-0"
          style={btnStyle}
          title={scale > 1 ? 'Reset zoom (0)' : 'Zoom level'}
        >
          {Math.round(scale * 100)}%
        </button>

        {/* Zoom In */}
        <button
          type="button"
          disabled={scale >= 4}
          onClick={(e) => {
            e.stopPropagation();
            zoomIn();
          }}
          className={`${btn} ${scale >= 4 ? 'opacity-40 cursor-not-allowed' : ''}`}
          style={btnStyle}
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        {/* Rotate */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTurns((t) => t + 1);
          }}
          className={btn}
          style={btnStyle}
          title="Rotate (R)"
          aria-label="Rotate image"
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 11-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
          <span className="hidden sm:inline">Rotate</span>
        </button>

        {/* Close */}
        <button
          ref={closeRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={btn}
          style={btnStyle}
          title="Close (Esc)"
          aria-label="Close image viewer"
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span className="hidden sm:inline">Close</span>
        </button>
      </div>
    </div>,
    document.body
  );
}

export const CardImageViewer = ImageViewer;
