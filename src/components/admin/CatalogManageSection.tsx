import React, { useCallback, useEffect, useState } from 'react';
import { cardThumbProps, supabase } from '../../lib/supabase';
import { clearApiCache } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { getGameShortName } from '../../lib/roles';
import { CardEditorModal } from './CardEditorModal';

interface SetRow {
  id: string;
  code: string;
  name: string;
  release_date: string | null;
  total_cards: number;
  game: string;
}

interface CatalogManageSectionProps {
  callerIsAdmin: boolean;
  moderatorGames: string[];
  allowedGameOptions: Array<{ id: string; label: string }>;
  onOpenErrataLegality: (card: any, tab: 'errata' | 'legality') => void;
  onNotice?: (type: 'ok' | 'err', text: string) => void;
}

type CatalogSubTab = 'cards' | 'sets' | 'tags';

export function CatalogManageSection({
  callerIsAdmin,
  moderatorGames,
  allowedGameOptions,
  onOpenErrataLegality,
  onNotice,
}: CatalogManageSectionProps) {
  const { t } = useLanguage();
  const [subTab, setSubTab] = useState<CatalogSubTab>('cards');
  const [selectedGame, setSelectedGame] = useState<string>(
    () => allowedGameOptions[0]?.id || (callerIsAdmin ? 'riftbound' : moderatorGames[0] || 'riftbound')
  );

  const [sets, setSets] = useState<SetRow[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Cards list & search
  const [cardQuery, setCardQuery] = useState('');
  const [filterSetId, setFilterSetId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [searchingCards, setSearchingCards] = useState(false);
  const [cards, setCards] = useState<any[]>([]);

  // Card editor modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingCard, setEditingCard] = useState<any | null>(null);

  // Set form state
  const [newSetName, setNewSetName] = useState('');
  const [newSetCode, setNewSetCode] = useState('');
  const [newSetDate, setNewSetDate] = useState('');
  const [newSetTotal, setNewSetTotal] = useState('0');
  const [savingSet, setSavingSet] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editSetName, setEditSetName] = useState('');
  const [editSetCode, setEditSetCode] = useState('');
  const [editSetDate, setEditSetDate] = useState('');
  const [editSetTotal, setEditSetTotal] = useState('0');

  // Tag form state
  const [newTagInput, setNewTagInput] = useState('');
  const [busyTag, setBusyTag] = useState<string | null>(null);

  const loadGameMeta = useCallback(async (game: string) => {
    setLoadingMeta(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/cards/manage?game=${encodeURIComponent(game)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        if (json?.error) onNotice?.('err', json.error);
        return;
      }
      setSets(json.sets || []);
      setCustomTags(json.customTags || []);
      setDefaultTags(json.defaultTags || []);
    } finally {
      setLoadingMeta(false);
    }
  }, [onNotice]);

  useEffect(() => {
    setFilterSetId('');
    setCards([]);
    loadGameMeta(selectedGame);
  }, [selectedGame, loadGameMeta]);

  const searchCatalogCards = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = cardQuery.trim();
    if (!q && !filterSetId) {
      setCards([]);
      return;
    }
    setSearchingCards(true);
    try {
      let query = supabase
        .from('cards')
        .select('*, sets ( id, name, code, release_date )')
        .eq('game', selectedGame)
        .is('deleted_at', null)
        .order('card_number', { ascending: true })
        .limit(60);

      if (!includeArchived) {
        query = query.eq('is_archived', false);
      }
      if (filterSetId) {
        query = query.eq('set_id', filterSetId);
      }
      if (q) {
        const safeLike = `%${q.replace(/[%_]/g, '')}%`;
        query = query.or(`name.ilike.${safeLike},card_number.ilike.${safeLike}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      setCards(data || []);
    } catch (err: any) {
      onNotice?.('err', err?.message || t('Card search failed.', 'A kártyakeresés nem sikerült.'));
    } finally {
      setSearchingCards(false);
    }
  }, [cardQuery, filterSetId, includeArchived, selectedGame, onNotice, t]);

  useEffect(() => {
    if (filterSetId) {
      searchCatalogCards();
    }
  }, [filterSetId, includeArchived]);

  const toggleArchiveCard = async (c: any) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'archive_card',
          card_id: c.id,
          archived: !c.is_archived,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed');
      clearApiCache();
      setCards((prev) =>
        prev
          .map((item) => (item.id === c.id ? { ...item, is_archived: json.is_archived } : item))
          .filter((item) => includeArchived || !item.is_archived)
      );
      onNotice?.('ok', json.is_archived ? t('Card archived.', 'Kártya archiválva.') : t('Card restored.', 'Kártya visszaállítva.'));
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Action failed');
    }
  };

  const handleCreateSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSetName.trim() || !newSetCode.trim()) return;
    setSavingSet(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'create_set',
          game: selectedGame,
          name: newSetName.trim(),
          code: newSetCode.trim().toUpperCase(),
          release_date: newSetDate.trim() || null,
          total_cards: parseInt(newSetTotal, 10) || 0,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to create set');
      clearApiCache();
      setSets((prev) => [...prev, json.set]);
      setNewSetName('');
      setNewSetCode('');
      setNewSetDate('');
      setNewSetTotal('0');
      onNotice?.('ok', t('Set created.', 'Szett létrehozva.'));
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed');
    } finally {
      setSavingSet(false);
    }
  };

  const handleSaveSetEdit = async (setId: string) => {
    if (!editSetName.trim() || !editSetCode.trim()) return;
    setSavingSet(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'update_set',
          set_id: setId,
          name: editSetName.trim(),
          code: editSetCode.trim().toUpperCase(),
          release_date: editSetDate.trim() || null,
          total_cards: parseInt(editSetTotal, 10) || 0,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to update set');
      clearApiCache();
      setSets((prev) => prev.map((s) => (s.id === setId ? json.set : s)));
      setEditingSetId(null);
      onNotice?.('ok', t('Set updated.', 'Szett frissítve.'));
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed');
    } finally {
      setSavingSet(false);
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newTagInput.trim();
    if (!tag) return;
    setBusyTag(tag);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add_tag', game: selectedGame, tag }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to add tag');
      clearApiCache();
      setCustomTags(json.customTags || []);
      setNewTagInput('');
      onNotice?.('ok', t('Tag added.', 'Tag hozzáadva.'));
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed');
    } finally {
      setBusyTag(null);
    }
  };

  const handleRenameTag = async (oldTag: string) => {
    const next = window.prompt(t(`Rename tag "${oldTag}" to:`, `"${oldTag}" tag átnevezése erre:`), oldTag);
    if (!next || next.trim() === oldTag) return;
    setBusyTag(oldTag);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'rename_tag', game: selectedGame, old_tag: oldTag, new_tag: next.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to rename tag');
      clearApiCache();
      setCustomTags(json.customTags || []);
      onNotice?.(
        'ok',
        t(`Tag renamed (${json.updatedCards ?? 0} cards updated).`, `Tag átnevezve (${json.updatedCards ?? 0} kártya frissítve).`)
      );
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed');
    } finally {
      setBusyTag(null);
    }
  };

  const handleDeleteTag = async (tag: string) => {
    if (!window.confirm(t(`Delete custom tag "${tag}" and remove it from cards?`, `Törlöd a(z) "${tag}" taget és eltávolítod a kártyákról?`))) {
      return;
    }
    setBusyTag(tag);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete_tag', game: selectedGame, tag, remove_from_cards: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to delete tag');
      clearApiCache();
      setCustomTags(json.customTags || []);
      onNotice?.('ok', t('Tag deleted.', 'Tag törölve.'));
    } catch (err: any) {
      onNotice?.('err', err?.message || 'Failed');
    } finally {
      setBusyTag(null);
    }
  };

  const inputCls = 'min-h-9 px-3 py-1.5 rounded-xl border text-xs outline-none focus:border-[var(--accent)]';
  const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

  return (
    <div className="rounded-2xl border p-4 sm:p-5 space-y-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
      {/* Top Header + Game & Sub-tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
            {t('Catalog Manager (Cards, Sets & Tags)', 'Katalóguskezelő (Kártyák, Szettek és Tagek)')}
          </h3>
          <select
            value={selectedGame}
            onChange={(e) => setSelectedGame(e.target.value)}
            className="min-h-8 px-2.5 py-1 rounded-lg border text-xs font-bold"
            style={inputStyle}
          >
            {allowedGameOptions.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-xl border p-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
            {([
              { id: 'cards' as const, label: t('Cards', 'Kártyák') },
              { id: 'sets' as const, label: `${t('Sets', 'Szettek')} (${sets.length})` },
              { id: 'tags' as const, label: `${t('Tags', 'Tagek')} (${customTags.length})` },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition"
                style={
                  subTab === tab.id
                    ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setEditorMode('create');
              setEditingCard(null);
              setEditorOpen(true);
            }}
            className="min-h-8 px-3.5 py-1 rounded-xl text-xs font-black cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {t('+ Add Card', '+ Új kártya')}
          </button>
        </div>
      </div>

      {/* SUBTAB 1: CARDS */}
      {subTab === 'cards' && (
        <div className="space-y-3">
          <form onSubmit={searchCatalogCards} className="flex flex-col sm:flex-row gap-2">
            <select
              value={filterSetId}
              onChange={(e) => setFilterSetId(e.target.value)}
              className={`${inputCls} sm:w-64 font-bold`}
              style={inputStyle}
            >
              <option value="">{loadingMeta ? t('Loading sets...', 'Szettek betöltése...') : t('All Sets (type to search)', 'Minden szett (keresés névre)')}</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
            <input
              type="search"
              value={cardQuery}
              onChange={(e) => setCardQuery(e.target.value)}
              placeholder={t('Search card name or number (e.g. KDA, Showstopper, OGN-270)...', 'Kártyanév vagy kártyaszám keresése...')}
              className={`flex-1 ${inputCls}`}
              style={inputStyle}
            />
            <label className="inline-flex items-center gap-1.5 px-2 text-xs cursor-pointer shrink-0" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
              <span>{t('Archived', 'Archiváltak')}</span>
            </label>
            <button
              type="submit"
              disabled={searchingCards || (!cardQuery.trim() && !filterSetId)}
              className="min-h-9 px-4 rounded-xl text-xs font-black cursor-pointer disabled:opacity-40"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              {searchingCards ? t('Searching...', 'Keresés...') : t('Search', 'Keresés')}
            </button>
          </form>

          {cards.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {cards.map((c) => {
                const thumb = c.image_path ? cardThumbProps(c.image_path, 'avatar') : null;
                const cmid = c.metadata?.cardmarket_id;
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border p-3 flex items-center justify-between gap-2.5"
                    style={{ background: 'var(--bg-surface-2)', borderColor: c.is_archived ? 'rgba(239, 68, 68, 0.35)' : 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {thumb && (
                        <img src={thumb.src} alt="" className="w-10 h-14 rounded-md object-cover border shrink-0" style={{ borderColor: 'var(--border)' }} />
                      )}
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-black truncate flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                          <span className="truncate">{c.name}</span>
                          {c.is_archived && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 uppercase">Archived</span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {getGameShortName(c.game || selectedGame)} · #{c.card_number} · {c.sets?.name || c.set_name || '-'}
                        </div>
                        <div className="text-[10px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                          <span>{c.rarity}</span>
                          {cmid ? <span className="text-emerald-400 font-mono">CM#{cmid}</span> : null}
                          {c.market_price_eur ? <span>EUR {Number(c.market_price_eur).toFixed(2)}</span> : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditorMode('edit');
                          setEditingCard(c);
                          setEditorOpen(true);
                        }}
                        className="min-h-8 px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {t('Edit', 'Szerkesztés')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenErrataLegality(c, 'errata')}
                        className="min-h-8 px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        Errata
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenErrataLegality(c, 'legality')}
                        className="min-h-8 px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        {t('Legality', 'Legalitás')}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleArchiveCard(c)}
                        className="min-h-8 px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                        style={{
                          background: 'var(--bg-surface)',
                          borderColor: c.is_archived ? 'rgba(16,185,129,0.4)' : 'var(--border)',
                          color: c.is_archived ? '#34d399' : 'var(--text-tertiary)',
                        }}
                      >
                        {c.is_archived ? t('Restore', 'Visszaállít') : t('Archive', 'Archivál')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
              {t('Select a set or enter a search query to manage cards, or click "+ Add Card" to add promos/special editions.', 'Válassz egy szettet vagy keress rá egy kártyára a szerkesztéshez, vagy kattints az "+ Új kártya" gombra.')}
            </p>
          )}
        </div>
      )}

      {/* SUBTAB 2: SETS */}
      {subTab === 'sets' && (
        <div className="space-y-4">
          <form onSubmit={handleCreateSet} className="rounded-xl border p-3.5 space-y-2.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
              {t('Add New Set / Promo Collection', 'Új szett / promó kollekció hozzáadása')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              <input
                type="text"
                required
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder={t('Set Name (e.g. K/DA Couture Collection)', 'Szett neve (pl. K/DA Couture Collection)')}
                className={`${inputCls} sm:col-span-2`}
                style={inputStyle}
              />
              <input
                type="text"
                required
                value={newSetCode}
                onChange={(e) => setNewSetCode(e.target.value.toUpperCase())}
                placeholder={t('Code (e.g. KDA)', 'Kód (pl. KDA)')}
                className={`${inputCls} font-mono`}
                style={inputStyle}
              />
              <input
                type="date"
                value={newSetDate}
                onChange={(e) => setNewSetDate(e.target.value)}
                className={inputCls}
                style={inputStyle}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={newSetTotal}
                  onChange={(e) => setNewSetTotal(e.target.value)}
                  placeholder={t('Cards', 'Db')}
                  className={`w-20 ${inputCls}`}
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={savingSet}
                  className="flex-1 min-h-9 px-3 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {t('Add Set', 'Hozzáadás')}
                </button>
              </div>
            </div>
          </form>

          <div className="divide-y rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
            {sets.map((s) => (
              <div key={s.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                {editingSetId === s.id ? (
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-5 gap-2 items-center">
                    <input
                      type="text"
                      value={editSetName}
                      onChange={(e) => setEditSetName(e.target.value)}
                      className={`${inputCls} sm:col-span-2`}
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      value={editSetCode}
                      onChange={(e) => setEditSetCode(e.target.value.toUpperCase())}
                      className={`${inputCls} font-mono`}
                      style={inputStyle}
                    />
                    <input
                      type="date"
                      value={editSetDate}
                      onChange={(e) => setEditSetDate(e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        value={editSetTotal}
                        onChange={(e) => setEditSetTotal(e.target.value)}
                        className={`w-16 ${inputCls}`}
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        disabled={savingSet}
                        onClick={() => handleSaveSetEdit(s.id)}
                        className="min-h-8 px-2.5 rounded-lg text-[11px] font-black cursor-pointer"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {t('Save', 'Mentés')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSetId(null)}
                        className="min-h-8 px-2 rounded-lg border text-[11px] font-bold cursor-pointer"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono font-black px-2 py-0.5 rounded border text-[11px]" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}>
                        {s.code}
                      </span>
                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {s.release_date ? s.release_date : t('No release date', 'Nincs dátum')} · {s.total_cards} {t('cards', 'kártya')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterSetId(s.id);
                          setSubTab('cards');
                        }}
                        className="min-h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        {t('View Cards', 'Kártyák')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSetId(s.id);
                          setEditSetName(s.name);
                          setEditSetCode(s.code);
                          setEditSetDate(s.release_date || '');
                          setEditSetTotal(String(s.total_cards || 0));
                        }}
                        className="min-h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        {t('Edit', 'Szerkesztés')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUBTAB 3: TAGS */}
      {subTab === 'tags' && (
        <div className="space-y-4">
          <form onSubmit={handleAddTag} className="flex gap-2">
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              placeholder={t('New custom tag (e.g. K/DA, Promo, Tournament)...', 'Új egyedi tag (pl. K/DA, Promo)...')}
              className={`flex-1 ${inputCls}`}
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!newTagInput.trim() || Boolean(busyTag)}
              className="min-h-9 px-4 rounded-xl text-xs font-black cursor-pointer disabled:opacity-40"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              {t('+ Add Tag', '+ Tag hozzáadása')}
            </button>
          </form>

          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              {t('Custom Tags', 'Egyedi tagek')} ({customTags.length})
            </div>
            {customTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {customTags.map((tg) => (
                  <div
                    key={tg}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-bold"
                    style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                  >
                    <span>{tg}</span>
                    <button
                      type="button"
                      disabled={busyTag === tg}
                      onClick={() => handleRenameTag(tg)}
                      className="text-[10px] underline cursor-pointer ml-1"
                    >
                      {t('Rename', 'Átnevez')}
                    </button>
                    <button
                      type="button"
                      disabled={busyTag === tg}
                      onClick={() => handleDeleteTag(tg)}
                      className="text-red-400 font-black cursor-pointer ml-0.5"
                      aria-label={`Delete ${tg}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t('No custom tags added yet for this game.', 'Ehhez a játékhoz még nincs egyedi tag hozzáadva.')}
              </p>
            )}
          </div>

          {defaultTags.length > 0 && (
            <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {t('Built-in Game Tags', 'Beépített tagek')} ({defaultTags.length})
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {defaultTags.map((tg) => (
                  <span
                    key={tg}
                    className="px-2 py-0.5 rounded-md border text-[11px]"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    {tg}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <CardEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        mode={editorMode}
        card={editingCard}
        defaultGame={selectedGame}
        allowedGames={allowedGameOptions}
        onSaved={(savedCard) => {
          clearApiCache();
          loadGameMeta(selectedGame);
          if (savedCard) {
            setCards((prev) => {
              const exists = prev.some((x) => x.id === savedCard.id);
              return exists
                ? prev.map((x) => (x.id === savedCard.id ? savedCard : x))
                : [savedCard, ...prev];
            });
          }
          onNotice?.(
            'ok',
            editorMode === 'create'
              ? t('Card created and added to catalog.', 'Kártya létrehozva a katalógusban.')
              : t('Card saved and catalog cache refreshed.', 'Kártya mentve és gyorsítótár frissítve.')
          );
        }}
      />
    </div>
  );
}
