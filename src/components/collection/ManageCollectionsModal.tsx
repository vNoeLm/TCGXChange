import { useEffect, useState } from 'react';
import { CollectionModal } from './CollectionModal';
import { useLanguage } from '../../lib/i18n';
import {
  MAX_COLLECTION_NAME,
  PERSONAL_COLLECTION_ID,
  type NamedCollection,
} from '../../lib/collectionDefaults';
import {
  createCollection,
  deleteCollection,
  savePersonalSettings,
  setActiveCollection,
  updateCollection,
  useCollectionsStore,
} from '../../lib/collectionsStore';

const countOf = (cards: Record<string, number>) => Object.values(cards).reduce((s, n) => s + (n || 0), 0);
const inputCls = 'w-full h-9 rounded-lg px-3 text-xs font-semibold border outline-none focus:border-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };
const labelCls = 'text-[10px] font-bold uppercase tracking-wider';

export function CollectionRow({
  coll,
  onToast,
  onChanged,
  navigateOnOpen,
}: {
  coll: NamedCollection;
  onToast: (msg: string, type?: 'success' | 'error') => void;
  onChanged?: () => void;
  navigateOnOpen?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(coll.name);
  const [isPublic, setIsPublic] = useState(coll.is_public ?? false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(coll.name);
    setIsPublic(coll.is_public ?? false);
  }, [coll.id, coll.name, coll.is_public]);

  const copies = countOf(coll.cards);
  const uniqueCards = Object.values(coll.cards).filter((n) => (n || 0) > 0).length;

  const save = async () => {
    setBusy(true);
    try {
      await updateCollection(coll.id, { name, is_public: isPublic });
      onToast(t('Collection settings saved.', 'Gyűjtemény beállításai elmentve.'), 'success');
      setEditing(false);
      onChanged?.();
    } catch (e: any) {
      onToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${coll.name}" and the ${copies} cop${copies === 1 ? 'y' : 'ies'} counted in it? This can't be undone.`)) return;
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
            <input value={name} maxLength={MAX_COLLECTION_NAME} aria-label="Collection name" onChange={(e) => setName(e.target.value)} className={inputCls} style={inputStyle} />
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

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button type="button" onClick={remove} disabled={busy} className="tv-btn-danger h-9 px-3 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50">
              {t('Delete', 'Törlés')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !name.trim()}
              className="h-9 px-4 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              {busy ? t('Saving…', 'Mentés…') : t('Save & apply', 'Mentés és alkalmazás')}
            </button>
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
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  personalCards?: Record<string, number>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const store = useCollectionsStore();
  const [newName, setNewName] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);
  const { t } = useLanguage();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const coll = await createCollection(newName.trim(), newIsPublic);
      setActiveCollection(coll.id);
      setNewName('');
      setNewIsPublic(false);
      onToast(`Created "${coll.name}" - it's open in the catalog now.`, 'success');
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <CollectionModal open={open} onClose={onClose} title={t("Collections", "Gyűjtemények")} subtitle={t("Keep cards apart - your own binder, a set you're building, trade stock...", "Tartsd külön a kártyákat - saját mappa, épülő szett, csereállomány...")} maxWidth="max-w-xl">
      <form onSubmit={create} className="rounded-xl border p-3 mb-4" style={{ borderColor: 'var(--border)' }}>
        <div className="text-xs font-black mb-2" style={{ color: 'var(--text-primary)' }}>{t("New collection", "Új gyűjtemény")}</div>
        <div className="flex gap-2">
          <input
            value={newName}
            maxLength={MAX_COLLECTION_NAME}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("e.g. Binder, Set Collection", "pl. Mappa, Szett gyűjtemény")}
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
            <input type="checkbox" checked={newIsPublic} aria-label="Share on public profile" onChange={(e) => setNewIsPublic(e.target.checked)} />
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Share on public profile - other collectors can view this collection on your profile', 'Megosztás a nyilvános profilodon - más gyűjtők láthatják ezt a gyűjteményt a profilodon')}</span>
          </label>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <PersonalCollectionRow personalCards={personalCards} onToast={onToast} />
        {store.collections.map((c) => (
          <CollectionRow key={c.id} coll={c} onToast={onToast} />
        ))}
      </div>
    </CollectionModal>
  );
}
