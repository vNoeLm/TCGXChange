import React, { useEffect, useState } from 'react';
import { supabase, cardThumbProps } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';
import { GAMES } from '../../lib/constants';
import { clearApiCache } from '../../lib/api';
import { formatModeratorRoleLabel, getGameShortName } from '../../lib/roles';
import type { CardUpdateRequest } from '../../lib/cardUpdates';
import { CardUpdateModal } from '../cards/CardUpdateModal';
import { CatalogManageSection } from './CatalogManageSection';

interface CardModerationPanelProps {
  callerIsAdmin: boolean;
  callerIsOwner: boolean;
  moderatorGames: string[];
  onNotice?: (type: 'ok' | 'err', text: string) => void;
}

export function CardModerationPanel({
  callerIsAdmin,
  callerIsOwner,
  moderatorGames,
  onNotice,
}: CardModerationPanelProps) {
  const { t, lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<CardUpdateRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [gameFilter, setGameFilter] = useState<string>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modal state
  const [modalCard, setModalCard] = useState<any | null>(null);
  const [modalRequest, setModalRequest] = useState<CardUpdateRequest | null>(null);
  const [modalInitialTab, setModalInitialTab] = useState<'errata' | 'legality' | 'card_data'>('errata');

  const allowedGameOptions = callerIsAdmin
    ? GAMES.map((g) => ({ id: g.id, label: g.name }))
    : GAMES.filter((g) => moderatorGames.includes(g.id)).map((g) => ({ id: g.id, label: g.name }));

  const loadRequests = async () => {
    setLoading(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/cards/update-requests?status=all', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setRequests(json.requests || []);
      } else if (json?.error) {
        onNotice?.('err', json.error);
      }
    } catch (e: any) {
      onNotice?.('err', e?.message || 'Failed to load card update requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const openRequestInEditor = async (req: CardUpdateRequest) => {
    setBusyId(req.id);
    try {
      const { data, error } = await supabase
        .from('cards')
        .select('*, sets ( id, name, code, release_date )')
        .eq('id', req.card_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(t('Card no longer exists.', 'A kártya már nem található.'));
      setModalCard(data);
      setModalRequest(req);
      setModalInitialTab(req.update_type);
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed to load card');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: CardUpdateRequest) => {
    const note = window.prompt(t('Optional reason for rejection:', 'Elutasítás oka (opcionális):'), '');
    if (note === null) return;
    setBusyId(req.id);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/update-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'reject', request_id: req.id, reviewer_note: note }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Action failed');
      setRequests((prev) => prev.map((r) => (r.id === req.id ? json.request : r)));
      onNotice?.('ok', t('Request rejected.', 'Kérelem elutasítva.'));
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteLog = async (req: CardUpdateRequest) => {
    if (!window.confirm(t('Delete this request entry?', 'Törlöd ezt a kérelmet?'))) return;
    setBusyId(req.id);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/update-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', request_id: req.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed');
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  const filteredRequests = requests.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (gameFilter !== 'all' && (r.game || '').toLowerCase() !== gameFilter) return false;
    return true;
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Scope Info Banner */}
      <div className="rounded-2xl border p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
              {t('Card Errata & Legality Moderation', 'Kártya errata és legalitás moderáció')}
            </h2>
            {callerIsAdmin ? (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full border border-indigo-500/40 bg-indigo-500/15 text-indigo-300 uppercase">
                {callerIsOwner ? t('Owner · All Games', 'Owner · Minden játék') : t('Admin · All Games', 'Admin · Minden játék')}
              </span>
            ) : (
              moderatorGames.map((g) => (
                <span key={g} className="text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 uppercase">
                  {formatModeratorRoleLabel(g, lang)}
                </span>
              ))
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {callerIsAdmin
              ? t(
                  'You can review user update requests and edit card errata/legality across all games.',
                  'Láthatod és kezelheted az összes játék kártyafrissítési kérelmeit, valamint közvetlenül módosíthatod a kártyákat.'
                )
              : t(
                  'You see update requests for your assigned game(s) only, and can directly edit cards in your game(s).',
                  'Csak a hozzád rendelt játék(ok) változásait látod és hagyhatod jóvá, illetve közvetlenül szerkesztheted a játék kártyáit.'
                )}
          </p>
        </div>

        <button
          type="button"
          onClick={loadRequests}
          disabled={loading}
          className="min-h-9 px-3.5 rounded-xl border text-xs font-bold cursor-pointer transition disabled:opacity-50"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          {loading ? t('Loading...', 'Betöltés...') : t('Refresh Queue', 'Lista frissítése')}
        </button>
      </div>

      {/* Catalog Manager: Create / Edit Cards, Sets, Tags & Cardmarket Link */}
      <CatalogManageSection
        callerIsAdmin={callerIsAdmin}
        moderatorGames={moderatorGames}
        allowedGameOptions={allowedGameOptions}
        onOpenErrataLegality={(c, tab) => {
          setModalRequest(null);
          setModalInitialTab(tab);
          setModalCard(c);
        }}
        onNotice={onNotice}
      />

      {/* Requests Queue */}
      <div className="rounded-2xl border p-4 sm:p-5 space-y-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
              {t('User Update Requests', 'Felhasználói frissítési kérelmek')} ({filteredRequests.length})
            </h3>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black tabular-nums bg-amber-500/20 border border-amber-500/40 text-amber-300">
                {pendingCount} {t('pending', 'függőben')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
              className="min-h-8 px-2.5 py-1 rounded-lg border text-xs font-bold"
            >
              <option value="all">{t('All Allowed Games', 'Összes engedélyezett játék')}</option>
              {allowedGameOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>

            <div className="inline-flex rounded-xl border p-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
              {(['pending', 'approved', 'rejected', 'all'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition"
                  style={
                    statusFilter === st
                      ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' }
                      : { color: 'var(--text-secondary)' }
                  }
                >
                  {st === 'pending'
                    ? t('Pending', 'Függőben')
                    : st === 'approved'
                    ? t('Approved', 'Jóváhagyva')
                    : st === 'rejected'
                    ? t('Rejected', 'Elutasítva')
                    : t('All', 'Mind')}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filteredRequests.map((req) => {
            const thumb = req.card_image_path ? cardThumbProps(req.card_image_path, 'avatar') : null;
            const statusStyle =
              req.status === 'pending'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : req.status === 'approved'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-400';

            return (
              <div
                key={req.id}
                className="rounded-xl border p-4 flex flex-col justify-between gap-3"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-start gap-3">
                  {thumb && (
                    <img src={thumb.src} alt="" className="w-12 h-16 rounded-lg object-cover border shrink-0" style={{ borderColor: 'var(--border)' }} />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap text-xs">
                      <span className={`px-2 py-0.5 rounded-md border text-[10px] font-black uppercase ${statusStyle}`}>
                        {req.status}
                      </span>
                      <span className="px-2 py-0.5 rounded-md border text-[10px] font-black uppercase" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                        {getGameShortName(req.game)}
                      </span>
                      <span className="px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}>
                        {req.update_type === 'legality' ? t('Legality', 'Legalitás') : req.update_type === 'errata' ? 'Errata' : t('Card Text', 'Kártyaadat')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`/card?id=${encodeURIComponent(req.card_id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-black hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {req.card_name}
                      </a>
                      <span className="text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                        #{req.card_number} {req.set_name ? `· ${req.set_name}` : ''}
                      </span>
                    </div>

                    <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {t('By', 'Beküldte:')} <span className="font-semibold">{req.requester_name}</span> · {new Date(req.created_at).toLocaleString(lang === 'hu' ? 'hu-HU' : 'en-GB')}
                    </div>

                    <div className="p-2.5 rounded-lg border text-xs whitespace-pre-line leading-relaxed" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
                      {req.description}
                    </div>

                    {req.proposed_errata && (
                      <div className="p-2 rounded-lg border text-[11px]" style={{ background: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.3)', color: 'var(--text-secondary)' }}>
                        <span className="font-bold">{t('Proposed errata:', 'Javasolt errata:')} </span>
                        {req.proposed_errata}
                      </div>
                    )}

                    {req.proposed_legality && Object.keys(req.proposed_legality).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(req.proposed_legality).map(([fmt, st]) => (
                          <span key={fmt} className="px-2 py-0.5 rounded-md border text-[10px] font-bold" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                            {fmt}: {st}
                          </span>
                        ))}
                      </div>
                    )}

                    {req.source_url && (
                      <a href={req.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] underline inline-block" style={{ color: 'var(--text-accent)' }}>
                        {req.source_url}
                      </a>
                    )}

                    {req.reviewed_at && (
                      <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {req.status} · {req.reviewed_by_name || 'Moderator'} · {new Date(req.reviewed_at).toLocaleString(lang === 'hu' ? 'hu-HU' : 'en-GB')}
                        {req.reviewer_note ? ` — "${req.reviewer_note}"` : ''}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 flex-wrap pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  {req.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => openRequestInEditor(req)}
                        className="min-h-8 px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer transition disabled:opacity-50"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {t('Review, Edit & Approve', 'Ellenőrzés és jóváhagyás')}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => handleReject(req)}
                        className="min-h-8 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 cursor-pointer transition disabled:opacity-50"
                      >
                        {t('Reject', 'Elutasítás')}
                      </button>
                    </>
                  )}
                  {callerIsAdmin && (
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleDeleteLog(req)}
                      className="min-h-8 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-400 cursor-pointer transition disabled:opacity-50"
                    >
                      {t('Delete', 'Törlés')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {!loading && filteredRequests.length === 0 && (
            <p className="text-xs py-8 text-center xl:col-span-2" style={{ color: 'var(--text-tertiary)' }}>
              {t('No card update requests match the selected filters.', 'Nincs a szűrőknek megfelelő kártyafrissítési kérelem.')}
            </p>
          )}
        </div>
      </div>

      <CardUpdateModal
        open={Boolean(modalCard)}
        onClose={() => {
          setModalCard(null);
          setModalRequest(null);
        }}
        card={modalCard}
        mode="direct"
        initialTab={modalInitialTab}
        reviewingRequest={modalRequest}
        onSaved={() => {
          clearApiCache();
          if (modalRequest) {
            setRequests((prev) =>
              prev.map((r) =>
                r.id === modalRequest.id
                  ? { ...r, status: 'approved', reviewed_at: new Date().toISOString() }
                  : r
              )
            );
          }
          onNotice?.('ok', t('Card updated and cached data refreshed.', 'Kártya frissítve és gyorsítótár érvénytelenítve.'));
        }}
      />
    </div>
  );
}
