import { describe, it, expect, vi } from 'vitest';
import { backdropCloseProps } from '../src/lib/modalBackdrop';
import type React from 'react';

function fakeMouseEvent(
  currentTarget: EventTarget,
  target: EventTarget,
  button = 0,
  stopPropagation = vi.fn(),
): React.MouseEvent<HTMLElement> {
  return {
    currentTarget,
    target,
    button,
    stopPropagation,
  } as unknown as React.MouseEvent<HTMLElement>;
}

describe('backdropCloseProps', () => {
  it('closes when both mousedown and mouseup occur directly on the backdrop', () => {
    const onClose = vi.fn();
    const props = backdropCloseProps(onClose);
    const backdrop = {} as EventTarget;

    props.onMouseDownCapture(fakeMouseEvent(backdrop, backdrop));
    props.onMouseUpCapture(fakeMouseEvent(backdrop, backdrop));
    props.onClick(fakeMouseEvent(backdrop, backdrop));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when mousedown starts inside modal and mouseup ends on backdrop', () => {
    const onClose = vi.fn();
    const props = backdropCloseProps(onClose);
    const backdrop = {} as EventTarget;
    const innerInput = {} as EventTarget;

    props.onMouseDownCapture(fakeMouseEvent(backdrop, innerInput));
    props.onMouseUpCapture(fakeMouseEvent(backdrop, backdrop));
    // Browser synthesizes click on lowest common ancestor (backdrop)
    props.onClick(fakeMouseEvent(backdrop, backdrop));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT close when mousedown starts on backdrop and mouseup ends inside modal', () => {
    const onClose = vi.fn();
    const props = backdropCloseProps(onClose);
    const backdrop = {} as EventTarget;
    const innerPanel = {} as EventTarget;

    props.onMouseDownCapture(fakeMouseEvent(backdrop, backdrop));
    props.onMouseUpCapture(fakeMouseEvent(backdrop, innerPanel));
    props.onClick(fakeMouseEvent(backdrop, backdrop));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('respects disabled and stopPropagation options', () => {
    const onClose = vi.fn();
    const stopProp = vi.fn();
    const props = backdropCloseProps(onClose, { disabled: true, stopPropagation: true });
    const backdrop = {} as EventTarget;

    props.onMouseDownCapture(fakeMouseEvent(backdrop, backdrop));
    props.onMouseUpCapture(fakeMouseEvent(backdrop, backdrop));
    props.onClick(fakeMouseEvent(backdrop, backdrop, 0, stopProp));

    expect(stopProp).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores non-primary mouse buttons (e.g. right-click)', () => {
    const onClose = vi.fn();
    const props = backdropCloseProps(onClose);
    const backdrop = {} as EventTarget;

    props.onMouseDownCapture(fakeMouseEvent(backdrop, backdrop, 2));
    props.onMouseUpCapture(fakeMouseEvent(backdrop, backdrop, 2));
    props.onClick(fakeMouseEvent(backdrop, backdrop, 2));

    expect(onClose).not.toHaveBeenCalled();
  });
});
