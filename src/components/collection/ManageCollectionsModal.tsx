import { useEffect, useState } from 'react';
import { CollectionModal } from './CollectionModal';
import { useLanguage } from '../../lib/i18n';
import { handoverLabel } from '../../lib/handover';
import { HANDOVER_METHODS } from '../../lib/handover';
import {
  DEFAULT_LIST_DEFAULTS,
  LISTING_CONDITIONS,
  MAX_COLLECTION_NAME,
  PERSONAL_COLLECTION_ID,
  formatCondition,
  type ListDefaults,
  type NamedCollection,
} from '../../lib/collectionDefaults';
import {
  createCollection,
  deleteCollection,
  recalculateCollectionPrices,
  savePersonalSettings,
  setActiveCollection,
  updateCollection,
  useCollectionsStore,
} from '../../lib/collectionsStore';

const countOf = (cards: Record<string, number>) => Object.values(cards).reduce((s, n) => s + (n || 0), 0);
const inputCls = 'w-full h-9 rounded-lg px-3 text-xs font-semibold border outline-none focus:border-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };
const labelCls = 'text-[10px] font-bold uppercase tracking-wider';

/** How an always-list collection lists its cards: condition, price, stock rules, and delivery methods. */
export function DefaultsEditor({ value, onChange }: { value: ListDefaults; onChange: (v: ListDefaults) => void }) {
  const { t, lang } = useLanguage();
  const set = (patch: Partial<ListDefaults>) => onChange({ ...value, ...patch });
  const adaptive = value.price_mode !== 'fixed';

  // Local draft states to prevent "0" lock-in when deleting and typing (e.g. 0-10% or 023)
  const [adjustPctDraft, setAdjustPctDraft] = useState<string>(String(value.price_adjust_pct ?? 0));
  const [fallbackPriceDraft, setFallbackPriceDraft] = useState<string>(String(value.base_price_huf ?? 500));
  const [minPriceDraft, setMinPriceDraft] = useState<string>(String(value.min_price_huf ?? 0));
  const [fixedPriceDraft, setFixedPriceDraft] = useState<string>(String(value.base_price_huf ?? 500));

  useEffect(() => {
    setAdjustPctDraft(String(value.price_adjust_pct ?? 0));
  }, [value.price_adjust_pct]);

  useEffect(() => {
    setFallbackPriceDraft(String(value.base_price_huf ?? 500));
    setFixedPriceDraft(String(value.base_price_huf ?? 500));
  }, [value.base_price_huf]);

  useEffect(() => {
    setMinPriceDraft(String(value.min_price_huf ?? 0));
  }, [value.min_price_huf]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2">
      <label className="flex flex-col gap-1">
        <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Condition', 'Állapot')}</span>
        <select value={value.condition} onChange={(e) => set({ condition: e.target.value })} className={inputCls} style={inputStyle}>
          {LISTING_CONDITIONS.map((c) => <option key={c} value={c}>{formatCondition(c, lang)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Pricing mode', 'Árazási mód')}</span>
        <select value={value.price_mode} onChange={(e) => set({ price_mode: e.target.value as ListDefaults['price_mode'] })} className={inputCls} style={inputStyle}>
          <option value="market">{t('Market price', 'Piaci ár')}</option>
          <option value="estimate">{t('Estimated value', 'Becsült érték')}</option>
          <option value="fixed">{t('One fixed price', 'Fix egységár')}</option>
        </select>
      </label>

      {adaptive ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('If no price data', 'Ha nincs áradat')}</span>
            <select
              value={value.skip_unpriced ? 'skip' : 'fallback'}
              onChange={(e) => set({ skip_unpriced: e.target.value === 'skip' })}
              className={inputCls}
              style={inputStyle}
            >
              <option value="skip">{t('Never list (skip card)', 'Ne hirdesse (kártya kihagyása)')}</option>
              <option value="fallback">{t('Use fallback price (Ft)', 'Biztonsági ár használata (Ft)')}</option>
            </select>
          </label>
          {!value.skip_unpriced ? (
            <label className="flex flex-col gap-1">
              <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Fallback price (Ft)', 'Biztonsági ár (Ft)')}</span>
              <input
                type="text"
                inputMode="numeric"
                value={fallbackPriceDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^\d*$/.test(val)) {
                    setFallbackPriceDraft(val);
                    const parsed = parseInt(val, 10);
                    if (!isNaN(parsed) && parsed > 0) {
                      set({ base_price_huf: parsed });
                    }
                  }
                }}
                onBlur={() => {
                  const parsed = Math.max(1, parseInt(fallbackPriceDraft, 10) || 500);
                  set({ base_price_huf: parsed });
                  setFallbackPriceDraft(String(parsed));
                }}
                placeholder="500"
                className={inputCls}
                style={inputStyle}
              />
            </label>
          ) : (
            <div className="flex flex-col justify-end pb-1">
              <span className="text-[11px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
                {t("Cards without market or estimated price data will stay private and won't be listed.", 'A piaci vagy becsült ár nélküli lapok privátak maradnak és nem kerülnek meghirdetésre.')}
              </span>
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Adjust price (%)', 'Ármódosítás (%)')}</span>
            <input
              type="text"
              inputMode="numeric"
              value={adjustPctDraft}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || val === '-' || /^-?\d*$/.test(val)) {
                  setAdjustPctDraft(val);
                  const parsed = parseInt(val, 10);
                  if (!isNaN(parsed)) {
                    set({ price_adjust_pct: Math.max(-90, Math.min(500, parsed)) });
                  } else if (val === '' || val === '-') {
                    set({ price_adjust_pct: 0 });
                  }
                }
              }}
              onBlur={() => {
                setAdjustPctDraft(String(value.price_adjust_pct ?? 0));
              }}
              placeholder="0"
              className={inputCls}
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Never list below (Ft)', 'Minimális eladási ár (Ft)')}</span>
            <input
              type="text"
              inputMode="numeric"
              value={minPriceDraft}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^\d*$/.test(val)) {
                  setMinPriceDraft(val);
                  const parsed = parseInt(val, 10);
                  set({ min_price_huf: isNaN(parsed) ? 0 : Math.max(0, parsed) });
                }
              }}
              onBlur={() => {
                const parsed = Math.max(0, parseInt(minPriceDraft, 10) || 0);
                set({ min_price_huf: parsed });
                setMinPriceDraft(String(parsed));
              }}
              placeholder="0"
              className={inputCls}
              style={inputStyle}
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Fixed price per copy (Ft)', 'Fix ár példányonként (Ft)')}</span>
          <input
            type="text"
            inputMode="numeric"
            value={fixedPriceDraft}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || /^\d*$/.test(val)) {
                setFixedPriceDraft(val);
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed) && parsed > 0) {
                  set({ base_price_huf: parsed });
                }
              }
            }}
            onBlur={() => {
              const parsed = Math.max(1, parseInt(fixedPriceDraft, 10) || 500);
              set({ base_price_huf: parsed });
              setFixedPriceDraft(String(parsed));
            }}
            placeholder="500"
            className={inputCls}
            style={inputStyle}
          />
        </label>
      )}

      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Keep copies unlisted (per card)', 'Megtartandó példányok (kártyánként)')}</span>
        <select
          value={String(value.keep_copies || 0)}
          onChange={(e) => set({ keep_copies: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}
          className={inputCls}
          style={inputStyle}
        >
          <option value="0">{t('0 — List all copies', '0 — Minden példány hirdetése')}</option>
          <option value="1">{t('1 — Keep 1 copy (list 2nd+)', '1 — 1 példány megtartása (a 2.-tól hirdetve)')}</option>
          <option value="2">{t('2 — Keep 2 copies (list 3rd+)', '2 — 2 példány megtartása (a 3.-tól hirdetve)')}</option>
          <option value="3">{t('3 — Keep playset of 3 (list 4th+)', '3 — 3 fős playset megtartása (a 4.-től hirdetve)')}</option>
          <option value="4">{t('4 — Keep 4 copies (list 5th+)', '4 — 4 példány megtartása (az 5.-től hirdetve)')}</option>
        </select>
      </label>

      <div className="sm:col-span-2 flex flex-col gap-1">
        <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Delivery methods', 'Átadási és szállítási módok')}</span>
        <div className="flex flex-wrap gap-1.5">
          {HANDOVER_METHODS.map((m) => {
            const on = value.handover_methods.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? value.handover_methods.filter((x) => x !== m.id) : [...value.handover_methods, m.id];
                  if (next.length) set({ handover_methods: next });
                }}
                className="h-7 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer"
                style={on
                  ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                  : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {handoverLabel(m.id, lang)}
              </button>
            );
          })}
        </div>
      </div>
      <p className="sm:col-span-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        Saving updates your collection rules and syncs active listings. Use <strong>Recalculate Prices</strong> anytime to refresh all listed cards to the latest market prices.
      </p>
    </div>
  );
}

export function CollectionRow({
  coll,
  pricesFor,
  onToast,
  onChanged,
  navigateOnOpen,
}: {
  coll: NamedCollection;
  pricesFor: (coll: NamedCollection, defaults: ListDefaults) => Promise<Record<string, number>> | Record<string, number>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
  onChanged?: () => void;
  navigateOnOpen?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(coll.name);
  const [alwaysList, setAlwaysList] = useState(coll.always_list);
  const [isPublic, setIsPublic] = useState(coll.is_public ?? false);
  const [defaults, setDefaults] = useState<ListDefaults>(coll.list_defaults);
  const [busy, setBusy] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    setName(coll.name);
    setAlwaysList(coll.always_list);
    setIsPublic(coll.is_public ?? false);
    setDefaults(coll.list_defaults);
  }, [coll.id, coll.name, coll.always_list, coll.is_public, coll.list_defaults]);

  const copies = countOf(coll.cards);
  const uniqueCards = Object.values(coll.cards).filter((n) => (n || 0) > 0).length;

  const save = async () => {
    const turningOn = alwaysList && !coll.always_list;
    const turningOff = !alwaysList && coll.always_list;
    if (turningOn && copies > 0 && !confirm(`List eligible copies in "${name}" on the marketplace now? From then on, adding or removing a copy here updates the listing automatically.`)) return;
    if (turningOff && !confirm(`Take everything "${coll.name}" listed off the marketplace? Copies buyers are holding stay until those holds are done.`)) return;
    setBusy(true);
    try {
      const prices = alwaysList ? await pricesFor(coll, defaults) : undefined;
      const res = await updateCollection(
        coll.id,
        { name, always_list: alwaysList, list_defaults: defaults, is_public: isPublic },
        prices
      );
      if (turningOn) {
        const skippedMsg = res.sync?.skippedUnpriced ? ` (${res.sync.skippedUnpriced} unpriced skipped)` : '';
        onToast(`"${name}" is now listed on the marketplace${skippedMsg}.`, 'success');
      } else {
        onToast(t('Collection settings saved and listings updated.', 'Gyűjtemény beállításai elmentve és a hirdetések frissítve.'), 'success');
      }
      setEditing(false);
      onChanged?.();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      }
    } catch (e: any) {
      onToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRecalculate = async () => {
    if (!coll.always_list) return;
    setRecalculating(true);
    try {
      const targetDefaults = editing ? defaults : coll.list_defaults;
      const prices = await pricesFor(coll, targetDefaults);
      const res = await recalculateCollectionPrices(coll.id, prices);
      const listedCount = res.sync?.listed ?? 0;
      const cardsCount = res.sync?.cardsListed ?? 0;
      const skippedCount = res.sync?.skippedUnpriced ?? 0;
      const skippedSuffix = skippedCount > 0 ? ` (${skippedCount} unpriced card${skippedCount === 1 ? '' : 's'} skipped)` : '';
      onToast(`Recalculated "${coll.name}": ${listedCount} cop${listedCount === 1 ? 'y' : 'ies'} across ${cardsCount} card${cardsCount === 1 ? '' : 's'} updated${skippedSuffix}.`, 'success');
      onChanged?.();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      }
    } catch (e: any) {
      onToast(e.message || 'Failed to recalculate prices', 'error');
    } finally {
      setRecalculating(false);
    }
  };

  const remove = async () => {
    const extra = coll.always_list ? ' Its listings come off the marketplace too.' : '';
    if (!confirm(`Delete "${coll.name}" and the ${copies} cop${copies === 1 ? 'y' : 'ies'} counted in it?${extra} This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteCollection(coll.id);
      onToast(`Deleted "${coll.name}".`, 'success');
      onChanged?.();
    } catch (e: any) {
      onToast(e.message, 'error');
      setBusy(false);
    }
  };

  const handleOpen = () => {
    setActiveCollection(coll.id);
    if (navigateOnOpen && typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  return (
    <div className="rounded-xl border p-3.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{coll.name}</span>
            {coll.always_list && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border"
                style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
              >
                {t('Always listed', 'Mindig hirdetve')}
              </span>
            )}
            {coll.is_public ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
              >
                {t('Public', 'Nyilvános')}
              </span>
            ) : (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
              >
                {t('Private', 'Privát')}
              </span>
            )}
          </div>
          <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: 'var(--text-tertiary)' }}>
            <span>
              {lang === 'hu'
                ? `${copies} példány (${uniqueCards} különböző)`
                : `${copies} cop${copies === 1 ? 'y' : 'ies'} (${uniqueCards} unique)`}
            </span>
            {coll.always_list && (
              <span>
                · {formatCondition(coll.list_defaults.condition, lang)} ·{' '}
                {coll.list_defaults.price_mode === 'market'
                  ? `${t('Market price', 'Piaci ár')}${coll.list_defaults.price_adjust_pct ? ` (${coll.list_defaults.price_adjust_pct > 0 ? '+' : ''}${coll.list_defaults.price_adjust_pct}%)` : ''}`
                  : coll.list_defaults.price_mode === 'estimate'
                    ? `${t('Estimated value', 'Becsült érték')}${coll.list_defaults.price_adjust_pct ? ` (${coll.list_defaults.price_adjust_pct > 0 ? '+' : ''}${coll.list_defaults.price_adjust_pct}%)` : ''}`
                    : `${coll.list_defaults.base_price_huf.toLocaleString('hu-HU')} Ft ${t('fixed', 'fix')}`}
                {coll.list_defaults.price_mode !== 'fixed' && coll.list_defaults.skip_unpriced ? ` · ${t('Skip unpriced', 'Áradat nélküliek kihagyva')}` : ''}
                {coll.list_defaults.keep_copies > 0 ? ` · ${lang === 'hu' ? `${coll.list_defaults.keep_copies} megtartva` : `Keep ${coll.list_defaults.keep_copies}`}` : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {coll.always_list && copies > 0 && (
            <button
              type="button"
              onClick={handleRecalculate}
              disabled={recalculating || busy}
              title={t('Recalculate and update all active listings in this collection using current market prices and rules', 'A gyűjtemény összes aktív hirdetésének újraszámolása és frissítése az aktuális piaci árak alapján')}
              className="h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer transition inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}
            >
              <svg className={`w-3.5 h-3.5 ${recalculating ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span>{recalculating ? t('Recalculating…', 'Újraszámolás…') : t('Recalculate prices', 'Árak újraszámolása')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleOpen}
            className="h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer transition"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {navigateOnOpen ? t('Open in Catalog', 'Megnyitás a Katalógusban') : t('Open', 'Megnyitás')}
          </button>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer transition"
            style={editing
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {editing ? t('Close', 'Bezárás') : t('Settings', 'Beállítások')}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <label className="flex flex-col gap-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Name', 'Név')}</span>
            <input value={name} maxLength={MAX_COLLECTION_NAME} aria-label="Collection name" onChange={(e) => setName(e.target.value)} className={inputCls} style={inputStyle} />
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={alwaysList} aria-label="Always list on Marketplace" onChange={(e) => setAlwaysList(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="block text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t('Always list on Marketplace', 'Mindig hirdetve a Piactéren')}</span>
              <span className="block text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {t("Everything in this collection is for sale: adding a copy lists it (or adds to the listing's stock), removing one takes it off, and a sale takes it out of the collection.", 'Minden lap ebben a gyűjteményben eladó: új lap hozzáadásakor automatikusan meghirdetésre kerül, kivételekor törlődik a hirdetés, eladáskor pedig kikerül a gyűjteményből.')}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isPublic} aria-label="Share on public profile" onChange={(e) => setIsPublic(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="block text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t('Share on public profile', 'Megosztás a nyilvános profilodon')}</span>
              <span className="block text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {t('Allow other collectors to view this collection on your profile under the Collection tab.', 'Más gyűjtők is megtekinthetik ezt a gyűjteményt a profilodon a Gyűjtemény fül alatt.')}
              </span>
            </span>
          </label>
          {alwaysList && <DefaultsEditor value={defaults} onChange={setDefaults} />}

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button type="button" onClick={remove} disabled={busy || recalculating} className="tv-btn-danger h-9 px-3 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50">
              {t('Delete', 'Törlés')}
            </button>
            <div className="flex items-center gap-2">
              {coll.always_list && copies > 0 && (
                <button
                  type="button"
                  onClick={handleRecalculate}
                  disabled={recalculating || busy}
                  className="h-9 px-3 rounded-lg border text-xs font-bold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <svg className={`w-3.5 h-3.5 ${recalculating ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span>{recalculating ? t('Recalculating…', 'Újraszámolás…') : t('Recalculate prices', 'Árak újraszámolása')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={save}
                disabled={busy || recalculating || !name.trim()}
                className="h-9 px-4 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                {busy ? t('Saving…', 'Mentés…') : t('Save & apply', 'Mentés és alkalmazás')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PersonalCollectionRow({
  personalCards,
  onToast,
  navigateOnOpen,
}: {
  personalCards?: Record<string, number>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
  navigateOnOpen?: boolean;
}) {
  const { t, lang } = useLanguage();
  const store = useCollectionsStore();
  const settings = store.personalSettings;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(settings?.name || 'Personal');
  const [isPublic, setIsPublic] = useState(settings?.is_public ?? false);
  const [description, setDescription] = useState(settings?.description || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(settings?.name || 'Personal');
    setIsPublic(settings?.is_public ?? false);
    setDescription(settings?.description || '');
  }, [settings?.name, settings?.is_public, settings?.description]);

  const cards = personalCards || {};
  const copies = countOf(cards);
  const uniqueCards = Object.values(cards).filter((n) => (n || 0) > 0).length;

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePersonalSettings({
        name: name.trim() || 'Personal',
        is_public: isPublic,
        description: description.trim(),
      });
      onToast(t('Personal collection settings saved.', 'Személyes gyűjtemény beállításai elmentve.'), 'success');
      setEditing(false);
    } catch (e: any) {
      onToast(e?.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = () => {
    setActiveCollection(PERSONAL_COLLECTION_ID);
    if (navigateOnOpen && typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  const displayName = name === 'Personal' ? t('Personal', 'Személyes') : name;

  return (
    <div className="rounded-xl border p-3.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{displayName}</span>
            {isPublic ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
              >
                {t('Public', 'Nyilvános')}
              </span>
            ) : (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
              >
                {t('Private', 'Privát')}
              </span>
            )}
          </div>
          <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: 'var(--text-tertiary)' }}>
            <span>
              {lang === 'hu'
                ? `${copies} példány (${uniqueCards} különböző)`
                : `${copies} cop${copies === 1 ? 'y' : 'ies'} (${uniqueCards} unique)`}
            </span>
            <span>· {t('Main collection', 'Fő gyűjtemény')}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={handleOpen}
            className="h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer transition"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {navigateOnOpen ? t('Open in Catalog', 'Megnyitás a Katalógusban') : t('Open', 'Megnyitás')}
          </button>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer transition"
            style={editing
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {editing ? t('Close', 'Bezárás') : t('Settings', 'Beállítások')}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <label className="flex flex-col gap-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Name', 'Név')}</span>
            <input
              value={name}
              maxLength={MAX_COLLECTION_NAME}
              aria-label="Collection name"
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder={t('Personal', 'Személyes')}
            />
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isPublic}
              aria-label="Share on public profile"
              onChange={(e) => setIsPublic(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                {t('Share on public profile', 'Megosztás a nyilvános profilodon')}
              </span>
              <span className="block text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {t('Visible on your public profile under the Collection tab for other collectors to browse.', 'Megjelenik a nyilvános profilodon a Gyűjtemény fül alatt, így más gyűjtők is böngészhetik.')}
              </span>
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Description (optional)', 'Leírás (opcionális)')}</span>
            <input
              value={description}
              maxLength={200}
              aria-label="Collection description"
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder={t('e.g. My main collection of Riftbound cards', 'pl. Saját Riftbound kártyagyűjteményem')}
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-9 px-4 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              {saving ? t('Saving…', 'Mentés…') : t('Save & apply', 'Mentés és alkalmazás')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Create, rename, configure and delete collections.
 */
export function ManageCollectionsModal({
  open,
  onClose,
  personalCards,
  pricesFor,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  personalCards?: Record<string, number>;
  /** Suggested listing prices for every card in a collection, for switching "always list" on. */
  pricesFor: (coll: NamedCollection, defaults: ListDefaults) => Promise<Record<string, number>> | Record<string, number>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const store = useCollectionsStore();
  const [newName, setNewName] = useState('');
  const [newAlwaysList, setNewAlwaysList] = useState(false);
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [newDefaults, setNewDefaults] = useState<ListDefaults>(DEFAULT_LIST_DEFAULTS);
  const [creating, setCreating] = useState(false);
  const { t } = useLanguage();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const coll = await createCollection(newName.trim(), newAlwaysList, newDefaults, newIsPublic);
      setActiveCollection(coll.id);
      setNewName('');
      setNewAlwaysList(false);
      setNewIsPublic(false);
      setNewDefaults(DEFAULT_LIST_DEFAULTS);
      onToast(`Created "${coll.name}" - it's open in the catalog now.`, 'success');
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <CollectionModal open={open} onClose={onClose} title={t("Collections", "Gyűjtemények")} subtitle={t("Keep cards apart - your own binder, trade stock, a set you're building...", "Tartsd külön a kártyákat - saját mappa, csereállomány, épülő szett...")} maxWidth="max-w-xl">
      <form onSubmit={create} className="rounded-xl border p-3 mb-4" style={{ borderColor: 'var(--border)' }}>
        <div className="text-xs font-black mb-2" style={{ color: 'var(--text-primary)' }}>{t("New collection", "Új gyűjtemény")}</div>
        <div className="flex gap-2">
          <input
            value={newName}
            maxLength={MAX_COLLECTION_NAME}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("e.g. For sale, Trade binder", "pl. Eladó, Csere mappa")}
            className={inputCls}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="h-9 px-4 rounded-lg text-xs font-black cursor-pointer shrink-0 disabled:opacity-50"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {creating ? t('Creating…', 'Létrehozás…') : t('Create', 'Létrehozás')}
          </button>
        </div>
        <div className="flex flex-col gap-2 mt-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={newAlwaysList} aria-label="Always list on marketplace" onChange={(e) => setNewAlwaysList(e.target.checked)} />
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Always list - everything I add here goes on the marketplace', 'Mindig hirdetve - minden ide felvett kártya felkerül a piactérre')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={newIsPublic} aria-label="Share on public profile" onChange={(e) => setNewIsPublic(e.target.checked)} />
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Share on public profile - other collectors can view this collection on your profile', 'Megosztás a nyilvános profilodon - más gyűjtők láthatják ezt a gyűjteményt a profilodon')}</span>
          </label>
        </div>
        {newAlwaysList && <DefaultsEditor value={newDefaults} onChange={setNewDefaults} />}
      </form>

      <div className="flex flex-col gap-2">
        <PersonalCollectionRow personalCards={personalCards} onToast={onToast} />
        {store.collections.map((c) => (
          <CollectionRow key={c.id} coll={c} pricesFor={pricesFor} onToast={onToast} />
        ))}
      </div>
    </CollectionModal>
  );
}

