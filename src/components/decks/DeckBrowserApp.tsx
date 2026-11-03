import React, { useEffect, useState } from 'react';
import { cardThumbProps } from '../../lib/supabase';
import { browsePublicDecks, type PublicDeckSummary } from '../../lib/publicDecks';
import { useLanguage } from '../../lib/i18n';

const DOMAIN_COLORS: Record<string, string> = {
  fury: '#ef4444', calm: '#22c55e', mind: '#3b82f6',
  body: '#f97316', chaos: '#a855f7', order: '#eab308', colorless: '#94a3b8',
};

const PAGE_SIZE = 24;

export function DeckBrowserApp() {
  const { t, lang } = useLanguage();
  const [decks, setDecks] = useState<PublicDeckSummary[]>([]);
  const [count, setCount] = useState(0);
  const game = 'riftbound';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deckArtView, setDeckArtView] = useState<Record<string, 'legend' | 'champion'>>({});

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      const result = await browsePublicDecks({ game, search, page, pageSize: PAGE_SIZE });
      if (!cancelled) {
        setDecks(prev => page === 1 ? result.data : [...prev, ...result.data]);
        setCount(result.count);
        setLoading(false);
      }
    }, search ? 300 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [game, search, page]);

  const hasMore = decks.length < count;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px)' }}>
      <h1 className="text-xl sm:text-2xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
        {t('Deck Browser', 'Pakliböngésző')}
      </h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
        {t('Decks the community has published publicly from the Deck Builder.', 'A közösség által közzétett paklik a Pakliépítőből.')}
      </p>

      <div className="flex items-center gap-3 flex-wrap mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('Search deck names...', 'Keresés paklinevek között...')}
          className="flex-1 min-w-[200px] px-3.5 py-2 rounded-xl text-sm outline-none border"
          style={{ background: 'var(--bg-input, var(--bg-surface-2))', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      {decks.length === 0 && !loading ? (
        <div className="p-12 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {t('No published decks match this search yet.', 'Nincs a keresésnek megfelelő közzétett pakli.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {decks.map(d => {
            const championDomain = d.champion_card?.domain ? d.champion_card.domain.split(',')[0].trim().toLowerCase() : null;
            const championColor = championDomain ? (DOMAIN_COLORS[championDomain] || '#94a3b8') : null;
            const isShowingChampion = deckArtView[d.id] === 'champion';
            const activeCard = (isShowingChampion && d.champion_card?.image_path) ? d.champion_card : (d.legend_card || d.champion_card);

            return (
              <div
                key={d.id}
                className="rounded-xl border overflow-hidden transition hover:-translate-y-0.5 flex flex-col"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="relative w-full overflow-hidden group" style={{ aspectRatio: '3 / 4', background: '#09090b' }}>
                  <a href={`/decks/view?deck=${d.id}`} className="block w-full h-full">
                    {activeCard?.image_path && (
                      <img
                        {...cardThumbProps(activeCard.image_path, 'tile')}
                        alt={activeCard.name}
                        className="w-full h-full object-cover transition group-hover:scale-105 duration-200"
                      />
                    )}
                  </a>

                  {d.champion_card?.image_path && d.legend_card?.image_path && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeckArtView((prev) => ({
                          ...prev,
                          [d.id]: prev[d.id] === 'champion' ? 'legend' : 'champion',
                        }));
                      }}
                      title={isShowingChampion ? t('Show Legend', 'Legenda mutatása') : t('Show Champion', 'Bajnok mutatása')}
                      className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded-lg text-[9px] font-black border flex items-center gap-1 shadow-md transition cursor-pointer backdrop-blur-md hover:scale-105"
                      style={{
                        background: 'rgba(9, 13, 22, 0.85)',
                        borderColor: isShowingChampion ? 'var(--accent)' : 'rgba(255, 255, 255, 0.25)',
                        color: isShowingChampion ? 'var(--text-accent)' : '#fff',
                      }}
                    >
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L13 16" />
                      </svg>
                      <span>{isShowingChampion ? t('Champion', 'Bajnok') : t('Legend', 'Legenda')}</span>
                    </button>
                  )}
                </div>
                <div className="p-2.5 flex flex-col flex-1 justify-between gap-1.5">
                  <div>
                    <a href={`/decks/view?deck=${d.id}`} className="text-xs font-bold truncate block hover:underline" style={{ color: 'var(--text-primary)' }}>
                      {d.name}
                    </a>
                    <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {lang === 'hu' ? `Készítő: ${d.owner_name}` : `by ${d.owner_name}`}
                    </div>
                  </div>

                  <div className="space-y-1 pt-1.5 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
                    {d.legend_card && (
                      <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-semibold">{t('Legend:', 'Legenda:')} </span>
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{d.legend_card.name}</span>
                      </div>
                    )}
                    {d.champion_card && (
                      <div className="flex items-center gap-1 min-w-0 flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-semibold shrink-0">{t('Champion:', 'Bajnok:')} </span>
                        <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>{d.champion_card.name}</span>
                        {championColor && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black text-white uppercase tracking-wider shrink-0 shadow-sm"
                            style={{ background: championColor }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-white/90" />
                            <span>{championDomain}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => setPage(p => p + 1)}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {loading ? t('Loading…', 'Betöltés…') : t('Load More', 'Továbbiak betöltése')}
          </button>
        </div>
      )}
    </div>
  );
}
