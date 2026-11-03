import { useEffect, useRef, useState } from 'react';
import { PERSONAL_COLLECTION_ID } from '../../lib/collectionDefaults';
import { setActiveCollection, useCollectionsStore } from '../../lib/collectionsStore';
import { useLanguage } from '../../lib/i18n';

const countOf = (cards: Record<string, number>) => Object.values(cards).reduce((s, n) => s + (n || 0), 0);

export interface CollectionSwitcherOption {
  id: string;
  name: string;
  count: number;
  alwaysList?: boolean;
  isPublic?: boolean;
}

export interface CollectionSwitcherProps {
  personalCount?: number;
  onManage?: () => void;
  onMove?: () => void;
  customCollections?: CollectionSwitcherOption[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

/**
 * Which collection the Catalog / Profile shows and edits: Personal, or one of the named ones.
 */
export function CollectionSwitcher({
  personalCount = 0,
  onManage,
  onMove,
  customCollections,
  activeId,
  onSelect,
  className = '',
}: CollectionSwitcherProps) {
  const { t } = useLanguage();
  const store = useCollectionsStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  // If using store and signed out without custom collections, render nothing
  if (!customCollections && (store.status === 'signed-out' || store.needsMigration)) return null;

  const personalDisplayName = store.personalSettings?.name && store.personalSettings.name !== 'Personal'
    ? store.personalSettings.name
    : t('Personal', 'Személyes');

  let active: { id: string; name: string; count: number; alwaysList?: boolean; isPublic?: boolean } | null = null;
  let options: Array<{ id: string; name: string; count: number; alwaysList?: boolean; isPublic?: boolean }> = [];

  if (customCollections && customCollections.length > 0) {
    options = customCollections;
    active = options.find((c) => c.id === activeId) || options[0] || null;
  } else {
    options = [
      { id: PERSONAL_COLLECTION_ID, name: personalDisplayName, count: personalCount, alwaysList: false, isPublic: store.personalSettings?.is_public },
      ...store.collections.map((c) => ({ id: c.id, name: c.name, count: countOf(c.cards), alwaysList: c.always_list, isPublic: c.is_public })),
    ];
    active = options.find((c) => c.id === store.activeId) || options[0] || null;
  }

  const selectedId = customCollections ? (activeId || options[0]?.id) : store.activeId;

  return (
    <div ref={ref} className={`relative inline-flex items-center gap-2 flex-wrap ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full lg:w-auto h-10 sm:h-9 pl-3 pr-2.5 rounded-xl border inline-flex items-center justify-between lg:justify-start gap-2 text-xs font-bold cursor-pointer max-w-none lg:max-w-[16rem] transition hover:bg-[var(--bg-raised)]"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        title={t('Switch collection', 'Gyűjtemény váltása')}
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          <span className="truncate">{active ? active.name : personalDisplayName}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {active && active.count !== undefined && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
              {active.count}
            </span>
          )}
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {active?.alwaysList && (
        <span
          className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md border"
          style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
          title={t('Every copy in this collection is listed on the marketplace; changing a count changes the listing', 'Minden példány ebben a gyűjteményben megjelenik a piacon; a darabszám változtatása módosítja a hirdetést')}
        >
          {t('Always listed', 'Mindig hirdetve')}
        </span>
      )}

      {open && (
        <div
          role="listbox"
          aria-label={t('Collections', 'Gyűjtemények')}
          className="absolute left-0 top-full mt-1.5 z-50 w-full sm:w-64 rounded-xl border shadow-2xl p-1.5"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          {options.map((o) => {
            const selected = o.id === selectedId;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  if (onSelect) onSelect(o.id);
                  else setActiveCollection(o.id);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs cursor-pointer hover:bg-[var(--bg-raised)]"
                style={selected ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' } : { color: 'var(--text-secondary)' }}
              >
                <span className="flex-1 min-w-0 truncate font-bold">{o.name}</span>
                {o.alwaysList && (
                  <span className="text-[9px] font-black uppercase tracking-wider px-1 rounded" style={{ color: 'var(--positive)' }}>Listed</span>
                )}
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{o.count}</span>
              </button>
            );
          })}
          {onManage && (
            <>
              <div className="h-px my-1" style={{ background: 'var(--border-subtle)' }} />
              <button
                type="button"
                onClick={() => { setOpen(false); onManage(); }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                style={{ color: 'var(--text-primary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('New / manage collections', 'Új / gyűjtemények kezelése')}
              </button>
            </>
          )}
          {onMove && (
            <button
              type="button"
              onClick={() => { setOpen(false); onMove(); }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              {t('Move cards between collections', 'Kártyák áthelyezése gyűjtemények között')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
