import { useEffect, useState } from 'react';

interface NumericInputProps {
  value: number;
  onChangeValue: (val: number) => void;
  min?: number;
  max?: number;
  allowNegative?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
}

/**
 * Controlled integer input that lets the user clear the field completely ("")
 * or type multi-digit numbers without immediate clamping jumping the cursor.
 * Clamps and commits `min`/`max` cleanly on blur or Enter.
 */
export function NumericInput({
  value,
  onChangeValue,
  min = 0,
  max = 10_000_000,
  allowNegative = false,
  disabled = false,
  className = '',
  style,
  title,
  ariaLabel,
}: NumericInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
    }
  }, [value, focused]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const parsed = parseInt(trimmed, 10);
    if (!trimmed || Number.isNaN(parsed)) {
      const fallback = Math.max(min, Math.min(max, value || min));
      setDraft(String(fallback));
      onChangeValue(fallback);
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    setDraft(String(clamped));
    if (clamped !== value) {
      onChangeValue(clamped);
    }
  };

  return (
    <input
      type="text"
      inputMode={allowNegative ? 'text' : 'numeric'}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      value={focused ? draft : String(value)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const next = e.target.value;
        const pattern = allowNegative ? /^-?\d*$/ : /^\d*$/;
        if (!pattern.test(next)) return;
        setDraft(next);
        if (next === '' || next === '-') return;
        const parsed = parseInt(next, 10);
        if (!Number.isNaN(parsed) && parsed >= min && parsed <= max) {
          onChangeValue(parsed);
        }
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className={className}
      style={style}
    />
  );
}
