import type React from 'react';

const mouseDownOnBackdrop = new WeakSet<EventTarget>();
const mouseUpOnBackdrop = new WeakSet<EventTarget>();

export interface BackdropCloseOptions {
  disabled?: boolean;
  stopPropagation?: boolean;
}

/**
 * Event handlers for a modal backdrop/overlay container so it only closes when BOTH
 * mousedown and mouseup occurred directly on the backdrop element itself (`e.target === e.currentTarget`).
 *
 * Prevents accidental closes when clicking/dragging inside a modal and releasing the mouse button
 * outside on the backdrop (or pressing on the backdrop and releasing inside the modal).
 */
export function backdropCloseProps(
  onClose: () => void,
  options?: BackdropCloseOptions,
) {
  return {
    onMouseDownCapture: (e: React.MouseEvent<HTMLElement>) => {
      if (e.target === e.currentTarget && e.button === 0) {
        mouseDownOnBackdrop.add(e.currentTarget);
      } else {
        mouseDownOnBackdrop.delete(e.currentTarget);
      }
      mouseUpOnBackdrop.delete(e.currentTarget);
    },
    onMouseUpCapture: (e: React.MouseEvent<HTMLElement>) => {
      if (e.target === e.currentTarget && e.button === 0) {
        mouseUpOnBackdrop.add(e.currentTarget);
      } else {
        mouseUpOnBackdrop.delete(e.currentTarget);
      }
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (options?.stopPropagation) {
        e.stopPropagation();
      }
      const startedOnBackdrop = mouseDownOnBackdrop.has(e.currentTarget);
      const endedOnBackdrop = mouseUpOnBackdrop.has(e.currentTarget);
      mouseDownOnBackdrop.delete(e.currentTarget);
      mouseUpOnBackdrop.delete(e.currentTarget);
      if (options?.disabled) return;
      if (e.target === e.currentTarget && startedOnBackdrop && endedOnBackdrop) {
        onClose();
      }
    },
  };
}
