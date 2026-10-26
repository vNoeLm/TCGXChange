import React from 'react';
import { useCurrency } from '../../lib/currency';

export const DURATION_PRESETS = [
  { label: '1 Hour', mins: 60 },
  { label: '6 Hours', mins: 360 },
  { label: '12 Hours', mins: 720 },
  { label: '24 Hours', mins: 1440 },
  { label: '3 Days', mins: 4320 },
  { label: '7 Days', mins: 10080 },
];

export interface AuctionSettingsFormProps {
  basePriceHuf: number | string;
  onBasePriceHufChange: (val: string) => void;
  bidStepHuf: number | string;
  onBidStepHufChange: (val: string) => void;
  durationMinutes: number;
  onDurationMinutesChange: (mins: number) => void;
  extensionMinutes: number | string;
  onExtensionMinutesChange: (val: string) => void;
}

export function AuctionSettingsForm({
  basePriceHuf,
  onBasePriceHufChange,
  bidStepHuf,
  onBidStepHufChange,
  durationMinutes,
  onDurationMinutesChange,
  extensionMinutes,
  onExtensionMinutesChange,
}: AuctionSettingsFormProps) {
  const { currency } = useCurrency();

  return (
    <div className="space-y-4 p-4 rounded-2xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center border"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div>
          <span className="text-xs font-black uppercase tracking-wider block" style={{ color: 'var(--text-primary)' }}>
            Auction Rules & Pricing
          </span>
          <span className="text-[11px] block" style={{ color: 'var(--text-tertiary)' }}>
            Configure starting price, minimum bid increments, and anti-sniping extension
          </span>
        </div>
      </div>

      {/* Starting Price & Bid Step */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Starting Base Price ({currency}) <span className="text-rose-400">*</span>
          </label>
          <div className="relative">
            <input
              type="number"
              min={1}
              required
              value={basePriceHuf}
              onChange={(e) => onBasePriceHufChange(e.target.value)}
              placeholder="e.g. 500"
              className="w-full px-3 py-2 rounded-xl text-xs font-black border outline-none"
              style={{
                background: 'var(--bg-input)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <span className="absolute right-3 top-2 text-[10px] font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>
              {currency}
            </span>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Bid Step Increment ({currency}) <span className="text-rose-400">*</span>
          </label>
          <div className="relative">
            <input
              type="number"
              min={10}
              step={10}
              required
              value={bidStepHuf}
              onChange={(e) => onBidStepHufChange(e.target.value)}
              placeholder="e.g. 50"
              className="w-full px-3 py-2 rounded-xl text-xs font-black border outline-none"
              style={{
                background: 'var(--bg-input)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <span className="absolute right-3 top-2 text-[10px] font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>
              {currency}
            </span>
          </div>
        </div>
      </div>

      {/* Duration Presets */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          Auction Duration
        </label>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((p) => {
            const isSelected = durationMinutes === p.mins;
            return (
              <button
                key={p.mins}
                type="button"
                onClick={() => onDurationMinutesChange(p.mins)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer select-none ${
                  isSelected ? 'shadow-xs' : 'hover:brightness-105'
                }`}
                style={
                  isSelected
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent-border)',
                        color: 'var(--text-accent)',
                      }
                    : {
                        background: 'var(--bg-input)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-tertiary)',
                      }
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Minute Rule Extension */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-secondary)' }}>
            Minute Rule (Anti-Sniping Timer Extension)
          </label>
          <span className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
            Only extends if under {extensionMinutes || 0} min remaining
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={60}
            value={extensionMinutes}
            onChange={(e) => onExtensionMinutesChange(e.target.value)}
            className="w-24 px-3 py-1.5 rounded-xl text-xs font-bold border outline-none"
            style={{
              background: 'var(--bg-input)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            minutes added only when bid occurs in the last {extensionMinutes || 0} min
          </span>
        </div>
      </div>

      {/* Cancellation Penalty Policy Notice */}
      <div className="p-3 rounded-xl border flex items-start gap-2.5" style={{ background: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
        <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="text-[11px] leading-relaxed text-amber-200/90 font-medium">
          <strong>Auction Honor Rule:</strong> When the auction ends, the winning bidder automatically receives a message and hold request. If you cancel an auction with a winning bidder, <strong>a 1-star system review is automatically recorded on your profile</strong> stating you did not honor the auction price.
        </p>
      </div>
    </div>
  );
}
