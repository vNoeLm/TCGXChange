import { useEffect, useState } from 'react';
import { STORE_BRANDS, STORE_CATEGORIES, STORE_GAMES } from '../../lib/storeConstants';
import { storeApi } from './storeClient';
import type { StoreTaxonomies, StoreCategoryItem, StoreGameItem } from '../../pages/api/store/taxonomies';
import type { StoreProduct } from '../../types';

interface StoreTaxonomyModalProps {
  products?: StoreProduct[];
  onClose: () => void;
  onSaved: () => void;
}

type TabKey = 'brands' | 'categories' | 'games';

const inputClass = 'w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

export function StoreTaxonomyModal({ products = [], onClose, onSaved }: StoreTaxonomyModalProps) {
  const [tab, setTab] = useState<TabKey>('brands');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [taxonomies, setTaxonomies] = useState<StoreTaxonomies>({
    brands: [],
    categories: [],
    games: [],
  });

  const [brands, setBrands] = useState<string[]>([]);
  const [categories, setCategories] = useState<StoreCategoryItem[]>([]);
  const [games, setGames] = useState<StoreGameItem[]>([]);

  // Deletion confirmation modals
  const [brandToDelete, setBrandToDelete] = useState<{ name: string; inUseCount: number } | null>(null);
  const [catToDelete, setCatToDelete] = useState<{ cat: StoreCategoryItem; inUseCount: number } | null>(null);
  const [gameToDelete, setGameToDelete] = useState<{ game: StoreGameItem; inUseCount: number } | null>(null);

  // New item inputs
  const [newBrand, setNewBrand] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatLabelHu, setNewCatLabelHu] = useState('');
  const [newCatId, setNewCatId] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [newGameId, setNewGameId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    storeApi<StoreTaxonomies>('/api/store/taxonomies').then((res) => {
      if (cancelled) return;
      if (res.ok) {
        const loaded = res.data;
        const initialBrands = Array.isArray(loaded.brands) && loaded.brands.length > 0
          ? loaded.brands
          : Array.from(new Set([...STORE_BRANDS, ...(loaded.customBrands || [])])).sort();

        const initialCategories = Array.isArray(loaded.categories) && loaded.categories.length > 0
          ? loaded.categories
          : STORE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, label_hu: c.label_hu || c.label }));

        const initialGames = Array.isArray(loaded.games) && loaded.games.length > 0
          ? loaded.games
          : STORE_GAMES.map((g) => ({ id: g.id, name: g.name }));

        setTaxonomies(loaded);
        setBrands(initialBrands);
        setCategories(initialCategories);
        setGames(initialGames);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveTaxonomies = async (nextBrands: string[], nextCats: StoreCategoryItem[], nextGames: StoreGameItem[]) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const payload: StoreTaxonomies = {
      brands: nextBrands,
      customBrands: nextBrands,
      categories: nextCats,
      games: nextGames,
    };
    const res = await storeApi<{ ok?: boolean; error?: string }>('/api/store/taxonomies', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      setTaxonomies(payload);
      setBrands(nextBrands);
      setCategories(nextCats);
      setGames(nextGames);
      onSaved();
    } else {
      setError(res.data.error || 'Failed to save taxonomies.');
    }
  };

  // ── Brands ──
  const handleAddBrand = (e: React.FormEvent) => {
    e.preventDefault();
    const b = newBrand.trim();
    if (!b) return;
    if (brands.some((x) => x.toLowerCase() === b.toLowerCase())) {
      setError(`Brand "${b}" already exists.`);
      return;
    }
    const nextBrands = [...brands, b].sort();
    setNewBrand('');
    saveTaxonomies(nextBrands, categories, games);
  };

  const handleDeleteBrandClick = (b: string) => {
    setError(null);
    setStatusMessage(null);
    const inUseCount = products.filter((p) => p.brand === b).length;
    if (inUseCount > 0) {
      setBrandToDelete({ name: b, inUseCount });
    } else {
      executeDeleteBrand(b);
    }
  };

  const executeDeleteBrand = async (brandName: string) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const res = await storeApi<{ ok?: boolean; reassignedCount?: number; error?: string }>('/api/store/taxonomies', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_brand', brand: brandName }),
    });
    setSaving(false);
    if (res.ok) {
      const next = brands.filter((x) => x !== brandName);
      setBrands(next);
      setBrandToDelete(null);
      if (res.data.reassignedCount && res.data.reassignedCount > 0) {
        setStatusMessage(`Deleted brand "${brandName}". ${res.data.reassignedCount} product(s) reassigned to 'None'.`);
      } else {
        setStatusMessage(`Deleted brand "${brandName}".`);
      }
      onSaved();
    } else {
      setError(res.data.error || 'Failed to delete brand.');
    }
  };

  // ── Categories ──
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newCatLabel.trim();
    const labelHu = newCatLabelHu.trim() || label;
    const id = (newCatId.trim() || label).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    if (!label || !id) return;
    if (categories.some((c) => c.id === id)) {
      setError(`Category ID "${id}" already exists.`);
      return;
    }
    const nextCats = [...categories, { id, label, label_hu: labelHu }];
    setNewCatLabel('');
    setNewCatLabelHu('');
    setNewCatId('');
    saveTaxonomies(brands, nextCats, games);
  };

  const handleDeleteCategoryClick = (cat: StoreCategoryItem) => {
    if (cat.id === 'other') {
      setError('Cannot delete the default fallback category "other".');
      return;
    }
    setError(null);
    setStatusMessage(null);
    const inUseCount = products.filter((p) => p.category === cat.id).length;
    if (inUseCount > 0) {
      setCatToDelete({ cat, inUseCount });
    } else {
      executeDeleteCategory(cat.id);
    }
  };

  const executeDeleteCategory = async (catId: string) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const res = await storeApi<{ ok?: boolean; reassignedCount?: number; error?: string }>('/api/store/taxonomies', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_category', category: catId }),
    });
    setSaving(false);
    if (res.ok) {
      const next = categories.filter((c) => c.id !== catId);
      setCategories(next);
      setCatToDelete(null);
      if (res.data.reassignedCount && res.data.reassignedCount > 0) {
        setStatusMessage(`Deleted category "${catId}". ${res.data.reassignedCount} product(s) reassigned to 'other'.`);
      } else {
        setStatusMessage(`Deleted category "${catId}".`);
      }
      onSaved();
    } else {
      setError(res.data.error || 'Failed to delete category.');
    }
  };

  // ── Games ──
  const handleAddGame = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newGameName.trim();
    const id = (newGameId.trim() || name).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    if (!name || !id) return;
    if (games.some((g) => g.id === id)) {
      setError(`Game ID "${id}" already exists.`);
      return;
    }
    const nextGames = [...games, { id, name }];
    setNewGameName('');
    setNewGameId('');
    saveTaxonomies(brands, categories, nextGames);
  };

  const handleDeleteGameClick = (game: StoreGameItem) => {
    setError(null);
    setStatusMessage(null);
    const inUseCount = products.filter((p) => p.game === game.id).length;
    if (inUseCount > 0) {
      setGameToDelete({ game, inUseCount });
    } else {
      executeDeleteGame(game.id);
    }
  };

  const executeDeleteGame = async (gameId: string) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const res = await storeApi<{ ok?: boolean; reassignedCount?: number; error?: string }>('/api/store/taxonomies', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_game', game: gameId }),
    });
    setSaving(false);
    if (res.ok) {
      const next = games.filter((g) => g.id !== gameId);
      setGames(next);
      setGameToDelete(null);
      if (res.data.reassignedCount && res.data.reassignedCount > 0) {
        setStatusMessage(`Deleted game "${gameId}". ${res.data.reassignedCount} product(s) reassigned to Universal.`);
      } else {
        setStatusMessage(`Deleted game "${gameId}".`);
      }
      onSaved();
    } else {
      setError(res.data.error || 'Failed to delete game.');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-xs" onClick={() => !saving && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage Taxonomies"
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl z-10 overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div>
            <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>Manage Taxonomies</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Brands, categories, and games</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl border cursor-pointer hover:bg-[var(--bg-raised)] transition"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-4 shrink-0 gap-2 pt-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
          {(['brands', 'categories', 'games'] as TabKey[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setError(null); setStatusMessage(null); }}
              className={`px-4 py-2 text-xs font-bold capitalize border-b-2 cursor-pointer transition ${
                tab === t
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t} ({t === 'brands' ? brands.length : t === 'categories' ? categories.length : games.length})
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3 rounded-xl text-xs border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>
              {error}
            </div>
          )}

          {statusMessage && (
            <div className="p-3 rounded-xl text-xs border" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#10b981' }}>
              {statusMessage}
            </div>
          )}

          {/* Delete Brand Confirmation Warning */}
          {brandToDelete && (
            <div className="p-4 rounded-xl border space-y-3" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.35)' }}>
              <div className="flex items-start gap-2.5">
                <svg className="w-5 h-5 shrink-0 text-red-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <p className="text-xs font-bold text-red-300">
                    Warning: Brand &quot;{brandToDelete.name}&quot; is currently used by {brandToDelete.inUseCount} product{brandToDelete.inUseCount === 1 ? '' : 's'}.
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Deleting it will reassign these products to default brand <strong className="text-zinc-200">&apos;None&apos;</strong>.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBrandToDelete(null)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteBrand(brandToDelete.name)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Deleting...' : `Delete & Reassign to 'None'`}
                </button>
              </div>
            </div>
          )}

          {/* Delete Category Confirmation Warning */}
          {catToDelete && (
            <div className="p-4 rounded-xl border space-y-3" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.35)' }}>
              <div className="flex items-start gap-2.5">
                <svg className="w-5 h-5 shrink-0 text-red-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <p className="text-xs font-bold text-red-300">
                    Warning: Category &quot;{catToDelete.cat.label}&quot; is currently used by {catToDelete.inUseCount} product{catToDelete.inUseCount === 1 ? '' : 's'}.
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Deleting it will reassign these products to default category <strong className="text-zinc-200">&apos;other&apos; (Other Accessories)</strong>.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCatToDelete(null)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteCategory(catToDelete.cat.id)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Deleting...' : `Delete & Reassign to 'other'`}
                </button>
              </div>
            </div>
          )}

          {/* Delete Game Confirmation Warning */}
          {gameToDelete && (
            <div className="p-4 rounded-xl border space-y-3" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.35)' }}>
              <div className="flex items-start gap-2.5">
                <svg className="w-5 h-5 shrink-0 text-red-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <p className="text-xs font-bold text-red-300">
                    Warning: Game &quot;{gameToDelete.game.name}&quot; is currently used by {gameToDelete.inUseCount} product{gameToDelete.inUseCount === 1 ? '' : 's'}.
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Deleting it will reassign these products to default <strong className="text-zinc-200">Universal (no game)</strong>.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setGameToDelete(null)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteGame(gameToDelete.game.id)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Deleting...' : `Delete & Reassign to Universal`}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Loading taxonomies...</div>
          ) : tab === 'brands' ? (
            <div className="space-y-4">
              <form onSubmit={handleAddBrand} className="flex gap-2">
                <input
                  required
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  placeholder="New brand name (e.g. Ultra PRO, Bandai)..."
                  className={inputClass}
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={saving || !newBrand.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold shrink-0 cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {saving ? 'Adding...' : '+ Add Brand'}
                </button>
              </form>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Brands ({brands.length})
                  </span>
                </div>
                {brands.length === 0 ? (
                  <p className="text-xs italic" style={{ color: 'var(--text-placeholder)' }}>No brands configured.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {brands.map((b) => {
                      const count = products.filter((p) => p.brand === b).length;
                      return (
                        <span
                          key={b}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold"
                          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                        >
                          <span>{b}</span>
                          {count > 0 && (
                            <span className="text-[10px] font-normal opacity-60" title={`Used by ${count} product(s)`}>
                              ({count})
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteBrandClick(b)}
                            aria-label={`Delete brand ${b}`}
                            className="hover:text-red-400 text-zinc-400 transition cursor-pointer p-0.5 rounded"
                            title={count > 0 ? `Used by ${count} product(s) - click to delete and reassign` : `Delete brand ${b}`}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'categories' ? (
            <div className="space-y-4">
              <form onSubmit={handleAddCategory} className="space-y-2 p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                <span className="text-xs font-bold block" style={{ color: 'var(--text-primary)' }}>Add Category</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    required
                    value={newCatLabel}
                    onChange={(e) => {
                      setNewCatLabel(e.target.value);
                      if (!newCatId) setNewCatId(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, ''));
                    }}
                    placeholder="English name (e.g. Playmats)"
                    className={inputClass}
                    style={inputStyle}
                  />
                  <input
                    required
                    value={newCatLabelHu}
                    onChange={(e) => setNewCatLabelHu(e.target.value)}
                    placeholder="Hungarian name (e.g. Játszószőnyegek)"
                    className={inputClass}
                    style={inputStyle}
                  />
                  <input
                    required
                    value={newCatId}
                    onChange={(e) => setNewCatId(e.target.value)}
                    placeholder="ID slug (e.g. playmats)"
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving || !newCatLabel.trim()}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                  >
                    {saving ? 'Adding...' : '+ Add Category'}
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>
                  Categories ({categories.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {categories.map((c) => {
                    const count = products.filter((p) => p.category === c.id).length;
                    const isDefaultOther = c.id === 'other';
                    return (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border text-xs"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-bold flex items-center gap-1.5 truncate" style={{ color: 'var(--text-primary)' }}>
                            <span>{c.label}</span>
                            {c.label_hu && c.label_hu !== c.label && (
                              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                                {c.label_hu}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            id: {c.id} {count > 0 ? `· (${count} products)` : ''}
                          </div>
                        </div>

                        {!isDefaultOther ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteCategoryClick(c)}
                            aria-label={`Delete category ${c.label}`}
                            className="p-1 rounded text-zinc-400 hover:text-red-400 transition cursor-pointer"
                            title={count > 0 ? `Used by ${count} product(s) - click to delete and reassign to 'other'` : `Delete category ${c.label}`}
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-zinc-400 bg-zinc-800/50">
                            default
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleAddGame} className="space-y-2 p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                <span className="text-xs font-bold block" style={{ color: 'var(--text-primary)' }}>Add Game</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    required
                    value={newGameName}
                    onChange={(e) => {
                      setNewGameName(e.target.value);
                      if (!newGameId) setNewGameId(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, ''));
                    }}
                    placeholder="Game name (e.g. Disney Lorcana)"
                    className={inputClass}
                    style={inputStyle}
                  />
                  <input
                    required
                    value={newGameId}
                    onChange={(e) => setNewGameId(e.target.value)}
                    placeholder="ID slug (e.g. lorcana)"
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving || !newGameName.trim()}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                  >
                    {saving ? 'Adding...' : '+ Add Game'}
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>
                  Games ({games.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {games.map((g) => {
                    const count = products.filter((p) => p.game === g.id).length;
                    return (
                      <div
                        key={g.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border text-xs"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {g.name}
                          </div>
                          <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            id: {g.id} {count > 0 ? `· (${count} products)` : ''}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteGameClick(g)}
                          aria-label={`Delete game ${g.name}`}
                          className="p-1 rounded text-zinc-400 hover:text-red-400 transition cursor-pointer"
                          title={count > 0 ? `Used by ${count} product(s) - click to delete and reassign to Universal` : `Delete game ${g.name}`}
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)] transition"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
