import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase, cardThumbProps } from '../../lib/supabase';
import { getCurrentUser } from '../../lib/auth';
import { STORAGE_KEYS } from '../../lib/constants';
import { useExitTransition } from '../../lib/useExitTransition';
import { useLanguage } from '../../lib/i18n';
import { backdropCloseProps } from '../../lib/modalBackdrop';
import { formatCondition, LISTING_CONDITIONS } from '../../lib/collectionDefaults';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { getSellerHandoverMethods, type DynamicHandoverMethod } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';
import { ListingPhotoUploader } from './ListingPhotoUploader';
import { ListingHandoverSelector } from './ListingHandoverSelector';
import { CardSearchAutocomplete } from './CardSearchAutocomplete';
import type { CatalogCard } from '../../types';

interface CreateTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (type?: 'trade') => void;
  initialCard?: CatalogCard | null;
  embedded?: boolean;
}

interface DraftOfferedItem {
  key: string;
  card: CatalogCard;
  condition: string;
  isFoil: boolean;
  quantity: number;
}

interface DraftWantedItem {
  key: string;
  card: CatalogCard;
  minCondition: string;
  foilPref: 'any' | 'foil' | 'non_foil';
  quantity: number;
}

const CONDITIONS = LISTING_CONDITIONS;

function makeKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CreateTradeModal({
  isOpen,
  onClose,
  onSuccess,
  initialCard = null,
  embedded = false,
}: CreateTradeModalProps) {
  const { t, lang } = useLanguage();
  const [activeGame, setActiveGame] = useState('riftbound');

  // Multi-card Offered & Wanted lists
  const [offeredList, setOfferedList] = useState<DraftOfferedItem[]>(() =>
    initialCard
      ? [{ key: makeKey(), card: initialCard, condition: 'Near Mint', isFoil: false, quantity: 1 }]
      : []
  );
  const [offeredPhotos, setOfferedPhotos] = useState<string[]>([]);
  const [wantedList, setWantedList] = useState<DraftWantedItem[]>([]);

  // Trade Terms & Handover
  const [cashDiffType, setCashDiffType] = useState<'even' | 'give' | 'request'>('even');
  const [cashDiffAmount, setCashDiffAmount] = useState('0');
  const [allowedHandovers, setAllowedHandovers] = useState<string[]>([
    'personal',
    'foxpost',
    'packeta',
    'other',
  ]);
  const [availableHandovers, setAvailableHandovers] = useState<DynamicHandoverMethod[]>([]);
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME) || 'riftbound';
      setActiveGame(saved);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      getCurrentUser().then((u) => {
        setIsSignedIn(Boolean(u));
        if (u?.id) {
          fetchShippingSettings([u.id]).then((map) => {
            const settings = map[u.id];
            const methods = getSellerHandoverMethods(settings);
            setAvailableHandovers(methods);
            setAllowedHandovers(methods.map((m) => m.id));
          });
        }
      });
      setErrorMsg(null);
      if (initialCard) {
        setOfferedList((prev) =>
          prev.length === 0
            ? [{ key: makeKey(), card: initialCard, condition: 'Near Mint', isFoil: false, quantity: 1 }]
            : prev
        );
      }
    }
  }, [isOpen, initialCard]);

  useBodyScrollLock(isOpen);

  const handleAddOfferedCard = (card: CatalogCard) => {
    setErrorMsg(null);
    setOfferedList((prev) => {
      const existingIdx = prev.findIndex(
        (item) => item.card.id === card.id && item.condition === 'Near Mint' && !item.isFoil
      );
      if (existingIdx !== -1) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: Math.min(99, item.quantity + 1) } : item
        );
      }
      return [
        ...prev,
        { key: makeKey(), card, condition: 'Near Mint', isFoil: false, quantity: 1 },
      ];
    });
  };

  const handleAddWantedCard = (card: CatalogCard) => {
    setErrorMsg(null);
    setWantedList((prev) => {
      const existingIdx = prev.findIndex(
        (item) => item.card.id === card.id && item.minCondition === 'Near Mint' && item.foilPref === 'any'
      );
      if (existingIdx !== -1) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: Math.min(99, item.quantity + 1) } : item
        );
      }
      return [
        ...prev,
        { key: makeKey(), card, minCondition: 'Near Mint', foilPref: 'any', quantity: 1 },
      ];
    });
  };

  const updateOfferedItem = (key: string, patch: Partial<DraftOfferedItem>) => {
    setOfferedList((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };

  const removeOfferedItem = (key: string) => {
    setOfferedList((prev) => prev.filter((it) => it.key !== key));
  };

  const updateWantedItem = (key: string, patch: Partial<DraftWantedItem>) => {
    setWantedList((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };

  const removeWantedItem = (key: string) => {
    setWantedList((prev) => prev.filter((it) => it.key !== key));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (offeredList.length === 0) {
      setErrorMsg(
        t(
          'Please add at least one card you are offering.',
          'Kérjük, adj hozzá legalább egy felkínált kártyát.'
        )
      );
      return;
    }
    if (wantedList.length === 0) {
      setErrorMsg(
        t(
          'Please add at least one card you want in return.',
          'Kérjük, adj hozzá legalább egy keresett kártyát.'
        )
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        setErrorMsg(
          t(
            'You must be signed in to create a trade listing.',
            'Cserehirdetés feladásához be kell jelentkezned.'
          )
        );
        setSubmitting(false);
        return;
      }

      let diffNum = 0;
      if (cashDiffType === 'give') {
        diffNum = Math.abs(parseInt(cashDiffAmount, 10) || 0);
      } else if (cashDiffType === 'request') {
        diffNum = -Math.abs(parseInt(cashDiffAmount, 10) || 0);
      }

      const offeredPayload = offeredList.map((it) => ({
        card_id: it.card.id,
        condition: it.condition,
        is_foil: it.isFoil,
        quantity: it.quantity,
      }));
      const wantedPayload = wantedList.map((it) => ({
        card_id: it.card.id,
        condition: it.minCondition,
        is_foil: it.foilPref === 'any' ? null : it.foilPref === 'foil',
        quantity: it.quantity,
      }));

      const firstOff = offeredPayload[0];
      const firstWant = wantedPayload[0];

      const res = await fetch('/api/marketplace/trades', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          offered_card_id: firstOff.card_id,
          offered_condition: firstOff.condition,
          offered_is_foil: firstOff.is_foil,
          offered_quantity: firstOff.quantity,
          offered_images: offeredPhotos,
          offered_items: offeredPayload,
          wanted_card_id: firstWant.card_id,
          wanted_min_condition: firstWant.condition,
          wanted_is_foil: firstWant.is_foil,
          wanted_quantity: firstWant.quantity,
          wanted_items: wantedPayload,
          cash_difference_huf: diffNum,
          handover_methods: allowedHandovers,
          description,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || t('Failed to create trade listing.', 'Nem sikerült létrehozni a cserehirdetést.'));
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      }

      setOfferedList([]);
      setWantedList([]);
      setOfferedPhotos([]);
      setDescription('');
      onSuccess('trade');
      onClose();
    } catch (err: any) {
      setErrorMsg(
        err.message || t('An error occurred while creating the trade.', 'Hiba történt a csere létrehozásakor.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const { rendered, state } = useExitTransition(isOpen, 250);
  if (!embedded && !rendered) return null;
  const modalState = embedded ? 'open' : state;

  const totalOfferedCount = offeredList.reduce((sum, it) => sum + it.quantity, 0);
  const totalWantedCount = wantedList.reduce((sum, it) => sum + it.quantity, 0);

  const formElement = (
    <form onSubmit={handleSubmit} className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
      {errorMsg && (
        <div
          className="p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2"
          style={{
            background: 'var(--negative-muted)',
            borderColor: 'var(--negative-border)',
            color: 'var(--negative)',
          }}
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorMsg}</span>
        </div>
      )}

      {!isSignedIn && (
        <div
          className="p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
        >
          <span>{t('You need to be logged in to create a trade listing.', 'Cserehirdetés feladásához be kell jelentkezned.')}</span>
          <a
            href="/login"
            className="px-3 py-1 rounded-lg text-xs font-bold border transition hover:brightness-110"
            style={{
              borderColor: 'var(--accent)',
              background: 'var(--accent-strong)',
              color: 'var(--text-on-accent, #000)',
            }}
          >
            {t('Sign in', 'Bejelentkezés')}
          </a>
        </div>
      )}

      {/* Side by side: Cards You Offer vs Cards You Want */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* ── OFFERED CARDS ── */}
        <div
          className="p-4 rounded-2xl border flex flex-col gap-3"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {t('1. Cards You Offer', '1. Felkínált kártyák')}
            </span>
            {totalOfferedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {lang === 'hu' ? `${totalOfferedCount} db` : `${totalOfferedCount} card${totalOfferedCount === 1 ? '' : 's'}`}
              </span>
            )}
          </div>

          <CardSearchAutocomplete
            label=""
            activeGame={activeGame}
            onSelect={handleAddOfferedCard}
            placeholder={t(
              'Search & add offered card(s)...',
              'Keress és adj hozzá felkínált kártyá(ka)t...'
            )}
          />

          {offeredList.length === 0 ? (
            <div
              className="py-6 px-3 rounded-xl border border-dashed text-center text-xs font-medium"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
            >
              {t(
                'Search above to add one or more cards you want to trade away.',
                'Keress fent egy vagy több kártyát, amelyet cserére kínálsz.'
              )}
            </div>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-0.5">
              {offeredList.map((item) => (
                <div
                  key={item.key}
                  className="p-2.5 rounded-xl border space-y-2"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-9 h-12 rounded overflow-hidden shrink-0 border flex items-center justify-center"
                        style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                      >
                        {item.card.image_path ? (
                          <img
                            {...cardThumbProps(item.card.image_path, 'avatar')}
                            alt={item.card.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-[8px] font-mono text-[var(--text-muted)]">TCG</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.card.name}
                        </div>
                        <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                          #{item.card.card_number} · {item.card.rarity || 'Common'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOfferedItem(item.key)}
                      title={t('Remove card', 'Kártya eltávolítása')}
                      className="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer hover:bg-rose-500/15 hover:text-rose-400 transition"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <select
                      value={item.condition}
                      onChange={(e) => updateOfferedItem(item.key, { condition: e.target.value })}
                      className="h-7 px-2 rounded-lg text-[11px] border outline-none font-semibold cursor-pointer min-w-0"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {formatCondition(c, lang)}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => updateOfferedItem(item.key, { isFoil: !item.isFoil })}
                      className={`h-7 px-2.5 rounded-lg text-[11px] font-bold border transition cursor-pointer shrink-0 ${
                        item.isFoil
                          ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                          : 'border-[var(--border)] text-[var(--text-secondary)]'
                      }`}
                      style={item.isFoil ? undefined : { background: 'var(--bg-input)' }}
                    >
                      {item.isFoil ? t('Foil', 'Fóliás') : t('Normal', 'Normál')}
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          updateOfferedItem(item.key, { quantity: Math.max(1, item.quantity - 1) })
                        }
                        className="w-6 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                      >
                        -
                      </button>
                      <span className="text-xs font-bold tabular-nums w-5 text-center">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateOfferedItem(item.key, { quantity: Math.min(99, item.quantity + 1) })
                        }
                        className="w-6 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Photos upload */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <ListingPhotoUploader
              photos={offeredPhotos}
              onPhotosChange={setOfferedPhotos}
              maxPhotos={6}
              label={t('Condition Photos', 'Állapotfotók')}
              subtitle={t('(optional)', '(opcionális)')}
            />
          </div>
        </div>

        {/* ── WANTED CARDS ── */}
        <div
          className="p-4 rounded-2xl border flex flex-col gap-3"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              {t('2. Cards You Want', '2. Keresett kártyák')}
            </span>
            {totalWantedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-sky-500/15 text-sky-400 border border-sky-500/30">
                {lang === 'hu' ? `${totalWantedCount} db` : `${totalWantedCount} card${totalWantedCount === 1 ? '' : 's'}`}
              </span>
            )}
          </div>

          <CardSearchAutocomplete
            label=""
            activeGame={activeGame}
            onSelect={handleAddWantedCard}
            placeholder={t(
              'Search & add wanted card(s)...',
              'Keress és adj hozzá keresett kártyá(ka)t...'
            )}
          />

          {wantedList.length === 0 ? (
            <div
              className="py-6 px-3 rounded-xl border border-dashed text-center text-xs font-medium"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
            >
              {t(
                'Search above to add one or more cards you are looking for.',
                'Keress fent egy vagy több kártyát, amelyet cserébe keresel.'
              )}
            </div>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-0.5">
              {wantedList.map((item) => (
                <div
                  key={item.key}
                  className="p-2.5 rounded-xl border space-y-2"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-9 h-12 rounded overflow-hidden shrink-0 border flex items-center justify-center"
                        style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                      >
                        {item.card.image_path ? (
                          <img
                            {...cardThumbProps(item.card.image_path, 'avatar')}
                            alt={item.card.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-[8px] font-mono text-[var(--text-muted)]">TCG</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.card.name}
                        </div>
                        <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                          #{item.card.card_number} · {item.card.rarity || 'Common'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeWantedItem(item.key)}
                      title={t('Remove card', 'Kártya eltávolítása')}
                      className="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer hover:bg-rose-500/15 hover:text-rose-400 transition"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <select
                      value={item.minCondition}
                      onChange={(e) => updateWantedItem(item.key, { minCondition: e.target.value })}
                      className="h-7 px-2 rounded-lg text-[11px] border outline-none font-semibold cursor-pointer min-w-0"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      title={t('Minimum condition', 'Minimális állapot')}
                    >
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {formatCondition(c, lang)}+
                        </option>
                      ))}
                    </select>

                    <select
                      value={item.foilPref}
                      onChange={(e) =>
                        updateWantedItem(item.key, {
                          foilPref: e.target.value as 'any' | 'foil' | 'non_foil',
                        })
                      }
                      className="h-7 px-2 rounded-lg text-[11px] border outline-none font-semibold cursor-pointer shrink-0"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <option value="any">{t('Any', 'Mindegy')}</option>
                      <option value="non_foil">{t('Normal', 'Normál')}</option>
                      <option value="foil">{t('Foil', 'Fóliás')}</option>
                    </select>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          updateWantedItem(item.key, { quantity: Math.max(1, item.quantity - 1) })
                        }
                        className="w-6 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                      >
                        -
                      </button>
                      <span className="text-xs font-bold tabular-nums w-5 text-center">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateWantedItem(item.key, { quantity: Math.min(99, item.quantity + 1) })
                        }
                        className="w-6 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 3. TERMS & HANDOVER ── */}
      <div
        className="p-4 rounded-2xl border space-y-4"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
      >
        <span className="text-xs font-black uppercase tracking-wider block" style={{ color: 'var(--text-tertiary)' }}>
          {t('3. Trade Terms & Handover', '3. Cserefeltételek és átadás')}
        </span>

        {/* Cash Difference */}
        <div>
          <label className="text-xs font-bold block mb-2" style={{ color: 'var(--text-secondary)' }}>
            {t('Cash adjustment (optional):', 'Készpénzes korrekció (opcionális):')}
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {[
              { id: 'even', label: t('Even trade', 'Egyenértékű csere') },
              { id: 'give', label: t('I will add cash (+ HUF)', 'Ráfizetek (+ Ft)') },
              { id: 'request', label: t('I request cash difference (- HUF)', 'Pótdíjat kérek (- Ft)') },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setCashDiffType(opt.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  cashDiffType === opt.id
                    ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)]'
                    : 'border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
                style={cashDiffType === opt.id ? undefined : { background: 'var(--bg-surface)' }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {cashDiffType !== 'even' && (
            <div className="flex items-center gap-2 max-w-xs mt-2">
              <input
                type="number"
                min="100"
                step="100"
                placeholder={t('Amount in HUF', 'Összeg Ft-ban')}
                value={cashDiffAmount}
                onChange={(e) => setCashDiffAmount(e.target.value)}
                className="w-full h-9 rounded-xl px-3 text-xs outline-none border font-bold"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
              <span className="text-xs font-bold shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                Ft
              </span>
            </div>
          )}
        </div>

        {/* Handover Methods */}
        <div className="p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
          <ListingHandoverSelector
            allowedHandovers={allowedHandovers}
            onChange={setAllowedHandovers}
            availableMethods={availableHandovers}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-bold block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            {t('Trade notes / description (optional):', 'Megjegyzések a cseréhez (opcionális):')}
          </label>
          <textarea
            rows={2}
            placeholder={t(
              'e.g. Can meet in Budapest near Nyugati, or send via Foxpost locker. Open to partial offers too!',
              'pl. Személyes átvétel Budapesten a Nyugatinál, vagy Foxpost csomagautomata. Részleges ajánlatokra is nyitott vagyok!'
            )}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl p-2.5 text-xs outline-none border transition focus:border-[var(--accent)]"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      {/* Footer Actions */}
      <div className="pt-2 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-xs font-bold border transition cursor-pointer hover:bg-[var(--bg-raised)]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          {t('Cancel', 'Mégse')}
        </button>
        <button
          type="submit"
          disabled={submitting || !isSignedIn}
          className="px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-md flex items-center gap-2 hover:brightness-110 disabled:opacity-50"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-contrast, #000)',
            boxShadow: '0 4px 14px var(--accent-muted, rgba(0,0,0,0.2))',
          }}
        >
          {submitting ? (
            <span>{t('Publishing trade...', 'Közzététel folyamatban...')}</span>
          ) : (
            <>
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{t('Post Trade Listing', 'Cserehirdetés közzététele')}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );

  if (embedded) {
    return <div className="flex flex-col flex-1 overflow-hidden">{formElement}</div>;
  }

  const content = (
    <div
      data-state={modalState}
      className="tv-overlay fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-black/80 backdrop-blur-sm"
      {...backdropCloseProps(onClose)}
    >
      <div
        data-state={modalState}
        onClick={(e) => e.stopPropagation()}
        className="tv-modal-panel w-full max-w-4xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-xs"
              style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent)',
                color: 'var(--text-accent)',
              }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">
                {t('Set Up Card Trade', 'Cserehirdetés feladása')}
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t(
                  'Offer one or more cards in exchange for the cards you want',
                  'Kínálj fel egy vagy több kártyát a keresett lapokért cserébe'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border flex items-center justify-center transition cursor-pointer hover:brightness-110"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {formElement}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
