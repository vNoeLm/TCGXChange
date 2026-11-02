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
            const domains = d.legend_card?.domain ? d.legend_card.domain.split(',').map(x => x.trim().toLowerCase()) : [];
            const championDomain = d.champion_card?.domain ? d.champion_card.domain.split(',')[0].trim().toLowerCase() : null;
            const championColor = championDomain ? (DOMAIN_COLORS[championDomain] || '#94a3b8') : null;
            return (
              <a
                key={d.id}
                href={`/decks/view?deck=${d.id}`}
                className="rounded-xl border overflow-hidden transition hover:-translate-y-0.5 cursor-pointer flex flex-col"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="relative w-full" style={{ aspectRatio: '3 / 4', background: '#09090b' }}>
                  {d.legend_card?.image_path && (
                    <img {...cardThumbProps(d.legend_card.image_path, 'tile')} alt={d.legend_card.name} className="w-full h-full object-cover" />
                  )}
                  {championColor && d.champion_card && (
                    <span
                      className="absolute top-2 right-2 w-4 h-4 rounded-full"
                      style={{ background: championColor, border: '2px solid rgba(9,9,11,0.85)', boxShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
                      title={lang === 'hu' ? `Bajnok: ${d.champion_card.name}` : `Champion: ${d.champion_card.name}`}
                    />
                  )}
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-bold truncate mb-0.5" style={{ color: 'var(--text-primary)' }}>{d.name}</div>
                  <div className="text-[11px] truncate mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    {lang === 'hu' ? `Készítő: ${d.owner_name}` : `by ${d.owner_name}`}
                  </div>
                  <div className="flex items-center gap-1">
                    {domains.map(dom => (
                      <div key={dom} className="w-2 h-2 rounded-full" style={{ background: DOMAIN_COLORS[dom] || '#94a3b8' }} title={dom} />
                    ))}
                  </div>
                </div>
              </a>
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
