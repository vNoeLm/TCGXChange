import React, { useState } from 'react';
import { useCardValueData, valueOfCard, marketEurOf } from '../lib/cardValues';
import { hasFoilVariant } from '../lib/cardVariants';
import { roundHuf } from '../lib/priceSuggestion';
import { PriceHistoryChart } from './marketplace/PriceHistoryChart';
import { useCurrency } from '../lib/currency';

interface CardValuePanelProps {
  card: {
    id: string;
    name?: string | null;
    game?: string | null;
    rarity?: string | null;
    market_price_eur?: number | null;
    market_price_foil_eur?: number | null;
  };
  className?: string;
  isFoil?: boolean;
}


/**
 * What a card is worth: the estimate, the market price it started from, and what sellers on the
 * site are asking. Common and Uncommon cards get a figure per finish.
 *
 * Each figure sits under its label rather than beside it, so a narrow panel (two finishes side by
 * side) can never squeeze a value onto two lines.
 */
export function CardValuePanel({ card, className, isFoil }: CardValuePanelProps) {
  const values = useCardValueData();
  const { formatPrice, currency } = useCurrency();
  const [tab, setTab] = useState<'value' | 'graph'>('value');
  const game = (card.game || 'riftbound').toLowerCase();
  const cmSlug =
    game === 'mtg' ? 'Magic' :
    game === 'onepiece' ? 'OnePiece' :
    game === 'lorcana' ? 'Lorcana' :
    game === 'starwars' ? 'StarWarsUnlimited' :
    game === 'fab' ? 'FleshAndBlood' :
    'Riftbound';
  const cmUrl = card.name
    ? `https://www.cardmarket.com/en/${cmSlug}/Products/Search?searchString=${encodeURIComponent(card.name)}`
    : `https://www.cardmarket.com/en/${cmSlug}`;

  const finishes = hasFoilVariant(card)
    ? [{ label: 'Normal', foil: false }, { label: 'Foil', foil: true }]
    : [{ label: null as string | null, foil: false }];

  const rows = finishes
    .map((finish) => {
      const estimate = valueOfCard(card, finish.foil, values);
      const eur = marketEurOf(card, finish.foil);
      return { ...finish, estimate, eur: eur ?? null };
    })
    .filter((row) => row.estimate.valueHuf !== null);

  const muted = { color: 'var(--text-tertiary)' } as const;

  // No market price and nobody selling it here - typically a set that isn't out yet. Say so, rather
  // than dropping the panel (and with it the graph tab) without a word.
  if (rows.length === 0) {
    return (
      <div className={`rounded-2xl p-4 sm:p-5 border ${className ?? 'mb-4'}`} style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
        <div className="text-sm font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Value</div>
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>No price yet</p>
        <p className="text-xs leading-relaxed mt-1" style={muted}>
          This card has no market price and nobody is selling it here. New cards get a price once they start selling - usually
          around their set's release - and the price graph starts from then.
        </p>
      </div>
    );
  }
  const strong = { color: 'var(--text-primary)' } as const;

  return (
    <div className={`rounded-2xl p-4 sm:p-5 border overflow-hidden ${className ?? 'mb-4'}`} style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
      <div
        className="flex items-center gap-1 pb-1.5 mb-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {(['value', 'graph'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="px-2.5 py-1 rounded-lg text-sm font-black uppercase tracking-wider transition cursor-pointer"
            style={{
              background: tab === t ? 'var(--accent-muted)' : 'transparent',
              color: tab === t ? 'var(--text-accent)' : 'var(--text-tertiary)',
            }}
          >
            {t === 'value' ? 'Value' : 'Graph'}
          </button>
        ))}
      </div>

      {tab === 'value' ? (
        <div className={`grid gap-3 ${rows.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
          {rows.map(({ label, foil, estimate, eur }) => {
            const isSelectedFinish = isFoil !== undefined && isFoil === foil;
            return (
              <div
                key={foil ? 'foil' : 'normal'}
                className="rounded-xl p-3.5 border transition"
                style={{
                  background: isSelectedFinish ? 'var(--accent-muted)' : 'var(--bg-input)',
                  borderColor: isSelectedFinish ? 'var(--accent)' : 'var(--border-subtle)',
                  boxShadow: isSelectedFinish ? '0 0 12px var(--accent-glow, rgba(245, 158, 11, 0.2))' : undefined,
                }}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="text-xs font-black uppercase tracking-wider" style={{ color: isSelectedFinish ? 'var(--text-accent)' : 'var(--text-secondary)' }}>
                    {label ? `${label} value` : 'Estimated value'}
                  </div>
                  {isSelectedFinish && (
                    <span
                      className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border"
                      style={{ background: 'var(--accent)', color: 'var(--text-on-accent, #000)', borderColor: 'var(--accent)' }}
                    >
                      This Listing
                    </span>
                  )}
                </div>
                <div className="text-2xl sm:text-3xl font-black whitespace-nowrap" style={strong}>
                  ~{formatPrice(estimate.valueHuf!)}
                </div>

                <dl className="mt-3 pt-3 space-y-2.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <dt className="text-xs" style={muted}>Market price</dt>
                    <dd className="text-sm font-bold" style={strong}>
                      {estimate.referenceHuf ? (
                        <>
                          <span className="whitespace-nowrap">{formatPrice(estimate.referenceHuf)}</span>
                          {eur && currency === 'HUF' ? <span className="ml-2 text-xs font-medium whitespace-nowrap" style={muted}>(Cardmarket: €{eur.toFixed(2)})</span> : null}
                        </>
                      ) : (
                        <span className="font-medium" style={muted}>none</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs" style={muted}>For sale here</dt>
                    <dd className="text-sm font-bold" style={strong}>
                      {estimate.site ? (
                        <>
                          <span className="whitespace-nowrap">
                            {estimate.site.count} listing{estimate.site.count === 1 ? '' : 's'}
                          </span>
                          <span className="ml-2 text-xs font-medium" style={muted}>
                            from {formatPrice(estimate.site.lowest)}
                            {estimate.site.count > 1 ? `, middle ${formatPrice(estimate.site.median)}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="font-medium" style={muted}>nobody yet</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
          <p className="text-[11px] sm:col-span-2" style={muted}>
            {game === 'mtg' ? (
              <>
                Market prices are from{' '}
                <a href={cmUrl} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">Cardmarket</a>{' '}
                (via <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">Scryfall</a> EUR market data).
              </>
            ) : game === 'onepiece' ? (
              <>
                Market reference prices are converted from TCGplayer / OPTCG market data (compare European listings on{' '}
                <a href={cmUrl} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">Cardmarket One Piece</a>).
              </>
            ) : (
              <>
                Market prices are from the{' '}
                <a href={cmUrl} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">Cardmarket</a>{' '}
                price guide, updated daily (a few cards it doesn't list use TCGplayer prices).
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="-mx-4 sm:-mx-5 -mb-4 sm:-mb-5">
          <PriceHistoryChart cardId={card.id} card={{ id: card.id, rarity: card.rarity, is_foil: isFoil, game: card.game }} initialFoil={isFoil} />
        </div>
      )}
    </div>
  );
}
