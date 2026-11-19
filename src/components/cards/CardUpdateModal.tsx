import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';
import { Modal } from '../ui/Modal';
import { getGameShortName } from '../../lib/roles';
import {
  getCardErrataEntries,
  getCardLegalityMap,
  getFormatsForGame,
  getLegalityBadgeStyle,
  LEGALITY_STATUS_OPTIONS,
  type CardErrataEntry,
  type CardUpdateRequest,
  type CardUpdateType,
} from '../../lib/cardUpdates';

export interface CardUpdateModalProps {
  open: boolean;
  onClose: () => void;
  /** Card object (must have at least id, name, card_number, game; metadata/text/ability/effect for direct editing). */
  card: {
    id: string;
    name: string;
    card_number?: string;
    game?: string;
    metadata?: Record<string, any> | null;
    text?: string | null;
    ability?: string | null;
    effect?: string | null;
    sets?: { name?: string } | null;
    set_name?: string | null;
  } | null;
  /** `'direct'`: mod/admin/owner edits card directly; `'request'`: regular user suggests change with description. */
  mode: 'direct' | 'request';
  /** Which tab opens first. */
  initialTab?: CardUpdateType;
  /** Optional pending request being reviewed & approved by a moderator/admin/owner. */
  reviewingRequest?: CardUpdateRequest | null;
  /** Called with updated card after a successful direct save or approval. */
  onSaved?: (updatedCard: any) => void;
  /** Called after a user successfully submits a request. */
  onSubmittedRequest?: (request: CardUpdateRequest) => void;
}

export function CardUpdateModal({
  open,
  onClose,
  card,
  mode,
  initialTab = 'errata',
  reviewingRequest = null,
  onSaved,
  onSubmittedRequest,
}: CardUpdateModalProps) {
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<CardUpdateType>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Direct / Approve state
  const [errataEntries, setErrataEntries] = useState<CardErrataEntry[]>([]);
  const [newErrataText, setNewErrataText] = useState('');
  const [newErrataDate, setNewErrataDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [legalityMap, setLegalityMap] = useState<Record<string, string>>({});
  const [customFormatName, setCustomFormatName] = useState('');

  const [cardText, setCardText] = useState('');
  const [cardAbility, setCardAbility] = useState('');
  const [cardEffect, setCardEffect] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');

  // Request mode state
  const [description, setDescription] = useState('');
  const [proposedErrata, setProposedErrata] = useState('');
  const [proposedLegality, setProposedLegality] = useState<Record<string, string>>({});
  const [sourceUrl, setSourceUrl] = useState('');

  const cardGame = (card?.game || reviewingRequest?.game || 'riftbound').toLowerCase();
  const formatList = getFormatsForGame(
    cardGame,
    mode === 'direct' ? legalityMap : { ...getCardLegalityMap(card), ...proposedLegality }
  );

  useEffect(() => {
    if (!open || !card) return;
    setTab(reviewingRequest?.update_type || initialTab || 'errata');
    setError(null);
    setBusy(false);

    const existingErrata = getCardErrataEntries(card);
    if (reviewingRequest?.proposed_errata) {
      setErrataEntries(existingErrata);
      setNewErrataText(reviewingRequest.proposed_errata);
    } else {
      setErrataEntries(existingErrata);
      setNewErrataText('');
    }
    setNewErrataDate(new Date().toISOString().slice(0, 10));

    const currentLeg = getCardLegalityMap(card);
    const mergedLeg = reviewingRequest?.proposed_legality
      ? { ...currentLeg, ...reviewingRequest.proposed_legality }
      : currentLeg;
    setLegalityMap(mergedLeg);
    setCustomFormatName('');

    setCardText(card.text || '');
    setCardAbility(card.ability || '');
    setCardEffect(card.effect || '');
    setReviewerNote('');

    setDescription('');
    setProposedErrata('');
    setProposedLegality(currentLeg);
    setSourceUrl('');
  }, [open, card?.id, initialTab, reviewingRequest?.id]);

  if (!card) return null;

  const addErrataEntry = () => {
    const trimmed = newErrataText.trim();
    if (!trimmed) return;
    setErrataEntries((prev) => [
      {
        id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: trimmed,
        date: newErrataDate || undefined,
        updated_at: new Date().toISOString(),
      },
      ...prev,
    ]);
    setNewErrataText('');
  };

  const removeErrataEntry = (id: string) => {
    setErrataEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const addCustomFormat = () => {
    const clean = customFormatName.trim();
    if (!clean) return;
    if (mode === 'direct') {
      setLegalityMap((prev) => ({ ...prev, [clean]: prev[clean] || 'Legal' }));
    } else {
      setProposedLegality((prev) => ({ ...prev, [clean]: prev[clean] || 'Legal' }));
    }
    setCustomFormatName('');
  };

  const handleSaveDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error(t('Please sign in first.', 'Kérlek jelentkezz be előbb.'));

      // If moderator typed an errata note without clicking "Add to list", include it automatically!
      let finalErrata = errataEntries;
      if (newErrataText.trim()) {
        finalErrata = [
          {
            id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            text: newErrataText.trim(),
            date: newErrataDate || undefined,
            updated_at: new Date().toISOString(),
          },
          ...errataEntries,
        ];
      }

      const payload: Record<string, any> = {
        card_id: card.id,
        errata_entries: finalErrata,
        legality: legalityMap,
        text: cardText.trim() ? cardText : null,
        ability: cardAbility.trim() ? cardAbility : null,
        effect: cardEffect.trim() ? cardEffect : null,
      };
      if (reviewingRequest?.id) {
        payload.request_id = reviewingRequest.id;
        if (reviewerNote.trim()) payload.reviewer_note = reviewerNote.trim();
      }

      const res = await fetch('/api/cards/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Error ${res.status}`);
      }
      onSaved?.(json.card);
      onClose();
    } catch (err: any) {
      setError(err?.message || t('Could not save changes.', 'Nem sikerült elmenteni a változtatásokat.'));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (description.trim().length < 4) {
      setError(t('Please describe what changed (at least 4 characters).', 'Kérlek írd le, mi változott (legalább 4 karakter).'));
      return;
    }

    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error(t('Please sign in to submit an update request.', 'Jelentkezz be a frissítési kérelem beküldéséhez.'));

      // Compare proposedLegality against current card legality so we only send changed entries (if any)
      const baseline = getCardLegalityMap(card);
      const changedLegality: Record<string, string> = {};
      for (const [k, v] of Object.entries(proposedLegality)) {
        if (baseline[k] !== v && v) {
          changedLegality[k] = v;
        }
      }

      const res = await fetch('/api/cards/update-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'submit',
          card_id: card.id,
          update_type: tab,
          description: description.trim(),
          proposed_errata: proposedErrata.trim() || null,
          proposed_legality: Object.keys(changedLegality).length > 0 ? changedLegality : null,
          source_url: sourceUrl.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Error ${res.status}`);
      }
      onSubmittedRequest?.(json.request);
      onClose();
    } catch (err: any) {
      setError(err?.message || t('Failed to submit update request.', 'Nem sikerült elküldeni a kérelmet.'));
    } finally {
      setBusy(false);
    }
  };

  const gameLabel = getGameShortName(cardGame);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeDisabled={busy}
      maxWidth="max-w-2xl"
      zIndexClass="z-[220]"
      bare
      ariaLabel={
        mode === 'direct'
          ? t('Edit Card Errata & Legality', 'Kártya errata és legalitás szerkesztése')
          : t('Suggest Card Update', 'Kártyafrissítés kérése')
      }
      className="max-h-[92dvh] flex flex-col"
    >
      {/* Header */}
      <div
        className="px-5 py-4 border-b flex items-start justify-between gap-3 shrink-0"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-wider"
              style={
                mode === 'direct'
                  ? { background: 'rgba(16, 185, 129, 0.14)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#34d399' }
                  : { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              }
            >
              {reviewingRequest
                ? t('Review & Approve Request', 'Kérelem elbírálása')
                : mode === 'direct'
                ? `${gameLabel} ${t('Direct Card Edit', 'Közvetlen kártyaszerkesztés')}`
                : `${gameLabel} · ${t('Update Request', 'Frissítési kérelem')}`}
            </span>
            {card.card_number && (
              <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                #{card.card_number}
              </span>
            )}
          </div>
          <h2 className="text-base sm:text-lg font-black truncate mt-1" style={{ color: 'var(--text-primary)' }}>
            {card.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t('Close', 'Bezárás')}
          className="tv-touch-target w-8 h-8 rounded-xl border flex items-center justify-center hover:bg-[var(--bg-raised)] transition cursor-pointer shrink-0 disabled:opacity-40"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Category Tabs */}
      <div className="px-5 pt-3 border-b shrink-0 flex items-center gap-1.5 flex-wrap" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
        {([
          { id: 'errata' as const, label: t('Card Errata', 'Kártya errata') },
          { id: 'legality' as const, label: t('Legality', 'Legalitás') },
          { id: 'card_data' as const, label: t('Card Text / Details', 'Kártyaszöveg / Adatok') },
        ]).map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 transition cursor-pointer"
              style={
                active
                  ? { borderColor: 'var(--accent)', color: 'var(--text-accent)', background: 'var(--bg-surface)' }
                  : { borderColor: 'transparent', color: 'var(--text-secondary)' }
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Form Body */}
      <form
        onSubmit={mode === 'direct' ? handleSaveDirect : handleSubmitRequest}
        className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4"
      >
        {reviewingRequest && (
          <div className="rounded-xl border p-3.5 space-y-1.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent-border)' }}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-black" style={{ color: 'var(--text-accent)' }}>
                {t('Submitted by', 'Beküldő:')} {reviewingRequest.requester_name}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {new Date(reviewingRequest.created_at).toLocaleString(lang === 'hu' ? 'hu-HU' : 'en-GB')}
              </span>
            </div>
            <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>
              {reviewingRequest.description}
            </p>
            {reviewingRequest.source_url && (
              <a
                href={reviewingRequest.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold underline inline-block"
                style={{ color: 'var(--text-accent)' }}
              >
                {reviewingRequest.source_url}
              </a>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl border text-xs font-semibold" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}>
            {error}
          </div>
        )}

        {mode === 'request' && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl border text-xs leading-relaxed" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {t(
                `Standard users can submit an update request here. A ${gameLabel} Moderator or Admin will review what changed and apply it to the card.`,
                `Felhasználóként itt küldhetsz frissítési javaslatot. Egy ${gameLabel} moderátor vagy admin átnézi a leírást, és jóváhagyás után élesíti a kártyán.`
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('What changed? (Required)', 'Mi változott? (Kötelező)')}
              </label>
              <textarea
                rows={3}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t(
                  'Describe the official errata, wording update, or format ban/restriction change...',
                  'Írd le pontosan, mi változott (pl. új errata szöveg, tiltás vagy korlátozás dátuma, hibás szövegrész)...'
                )}
                className="w-full px-3 py-2.5 rounded-xl border text-xs leading-relaxed"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>

            {tab === 'errata' && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {t('Suggested Errata Text (Optional)', 'Javasolt errata szöveg (opcionális)')}
                </label>
                <textarea
                  rows={3}
                  value={proposedErrata}
                  onChange={(e) => setProposedErrata(e.target.value)}
                  placeholder={t('Paste the official corrected card text or ruling...', 'Másold be a pontos errata szöveget vagy szabálymódosítást...')}
                  className="w-full px-3 py-2.5 rounded-xl border text-xs leading-relaxed"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            )}

            {tab === 'legality' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    {t('Suggested Format Legality', 'Javasolt formátum legalitás')}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {formatList.map((fmt) => (
                    <div key={fmt} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                      <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{fmt}</span>
                      <select
                        value={proposedLegality[fmt] || ''}
                        onChange={(e) =>
                          setProposedLegality((prev) => {
                            const next = { ...prev };
                            if (!e.target.value) delete next[fmt];
                            else next[fmt] = e.target.value;
                            return next;
                          })
                        }
                        className="px-2 py-1 rounded-lg border text-xs font-bold"
                      >
                        <option value="">{t('Unchanged', 'Változatlan')}</option>
                        {LEGALITY_STATUS_OPTIONS.map((st) => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('Official Source Link (Optional)', 'Hivatalos forrás link (opcionális)')}
              </label>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 rounded-xl border text-xs"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
        )}

        {mode === 'direct' && tab === 'errata' && (
          <div className="space-y-3.5">
            <div className="rounded-xl border p-3.5 space-y-2.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  {t('Add New Errata Entry', 'Új errata bejegyzés')}
                </label>
                <input
                  type="date"
                  value={newErrataDate}
                  onChange={(e) => setNewErrataDate(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border text-xs font-mono"
                />
              </div>
              <textarea
                rows={3}
                value={newErrataText}
                onChange={(e) => setNewErrataText(e.target.value)}
                placeholder={t(
                  'Enter the official errata text or wording update...',
                  'Írd be a hivatalos errata szöveget vagy szabályváltozást...'
                )}
                className="w-full px-3 py-2 rounded-xl border text-xs leading-relaxed"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addErrataEntry}
                  disabled={!newErrataText.trim()}
                  className="min-h-8 px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer disabled:opacity-40"
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                >
                  {t('+ Add Entry to Card', '+ Bejegyzés hozzáadása')}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {t('Active Errata Entries', 'Aktív errata bejegyzések')} ({errataEntries.length})
              </div>
              {errataEntries.length === 0 ? (
                <p className="text-xs italic py-2" style={{ color: 'var(--text-muted)' }}>
                  {t('No errata entries recorded for this card yet.', 'Ehhez a kártyához még nincs errata rögzítve.')}
                </p>
              ) : (
                errataEntries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border p-3 flex items-start justify-between gap-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {entry.date && <span className="font-mono font-bold" style={{ color: 'var(--text-accent)' }}>{entry.date}</span>}
                        {entry.updated_by_name && <span>· {entry.updated_by_name}</span>}
                      </div>
                      <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>
                        {entry.text}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeErrataEntry(entry.id)}
                      aria-label={t('Remove errata entry', 'Errata törlése')}
                      className="tv-touch-target px-2 py-1 rounded-lg border text-[11px] font-bold text-rose-400 border-rose-500/30 hover:bg-rose-500/10 cursor-pointer shrink-0"
                    >
                      {t('Remove', 'Törlés')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {mode === 'direct' && tab === 'legality' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {formatList.map((fmt) => {
                const status = legalityMap[fmt] || '';
                const badge = status ? getLegalityBadgeStyle(status) : null;
                return (
                  <div
                    key={fmt}
                    className="rounded-xl border p-3 flex items-center justify-between gap-2"
                    style={{
                      background: 'var(--bg-input)',
                      borderColor: badge ? badge.border : 'var(--border-subtle)',
                    }}
                  >
                    <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {fmt}
                    </span>
                    <select
                      value={status}
                      onChange={(e) =>
                        setLegalityMap((prev) => {
                          const next = { ...prev };
                          if (!e.target.value) delete next[fmt];
                          else next[fmt] = e.target.value;
                          return next;
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-bold"
                    >
                      <option value="">{t('Not set', 'Nincs megadva')}</option>
                      {LEGALITY_STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={customFormatName}
                onChange={(e) => setCustomFormatName(e.target.value)}
                placeholder={t('Add custom format (e.g. Sealed)...', 'Egyedi formátum hozzáadása...')}
                className="flex-1 px-3 py-2 rounded-xl border text-xs"
              />
              <button
                type="button"
                onClick={addCustomFormat}
                disabled={!customFormatName.trim()}
                className="min-h-9 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer disabled:opacity-40"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {t('Add Format', 'Formátum hozzáadása')}
              </button>
            </div>
          </div>
        )}

        {mode === 'direct' && tab === 'card_data' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('Ability Text', 'Képesség szöveg')}
              </label>
              <textarea
                rows={3}
                value={cardAbility}
                onChange={(e) => setCardAbility(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-xs leading-relaxed"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('Effect Text', 'Hatás szöveg')}
              </label>
              <textarea
                rows={3}
                value={cardEffect}
                onChange={(e) => setCardEffect(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-xs leading-relaxed"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('Card Text / Flavor Text', 'Kártyaszöveg / Hangulatszöveg')}
              </label>
              <textarea
                rows={3}
                value={cardText}
                onChange={(e) => setCardText(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-xs leading-relaxed"
              />
            </div>
          </div>
        )}

        {mode === 'direct' && reviewingRequest && (
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              {t('Moderator Note (Optional)', 'Moderátori megjegyzés (opcionális)')}
            </label>
            <input
              type="text"
              value={reviewerNote}
              onChange={(e) => setReviewerNote(e.target.value)}
              placeholder={t('e.g. Verified against official FAQ', 'pl. Hivatalos FAQ alapján frissítve')}
              className="w-full px-3 py-2 rounded-xl border text-xs"
            />
          </div>
        )}

        {/* Footer */}
        <div
          className="pt-3 border-t flex items-center justify-end gap-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-9 px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)] transition disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Cancel', 'Mégse')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-9 px-5 py-2 rounded-xl text-xs font-black cursor-pointer transition hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {busy
              ? t('Saving...', 'Küldés...')
              : reviewingRequest
              ? t('Approve & Save Card', 'Jóváhagyás és mentés')
              : mode === 'direct'
              ? t('Save Card Changes', 'Kártya mentése')
              : t('Submit Update Request', 'Frissítési kérelem küldése')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
