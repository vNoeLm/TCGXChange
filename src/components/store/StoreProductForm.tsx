import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoreProduct, StoreProductCategory, StoreProductStatus, StoreVariantKind } from '../../types';
import { STORE_BRANDS, STORE_CATEGORIES, STORE_GAMES, STORE_SUBCATEGORIES_BY_CATEGORY, STORE_VARIANT_KINDS } from '../../lib/storeConstants';
import { subcategoryOf } from '../../lib/storeProducts';
import { storeApi } from './storeClient';

interface StoreProductFormProps {
  /** The product being edited, or null to create one. */
  product: StoreProduct | null;
  /** Pre-filled values for a new product, e.g. a copy of a sibling when adding a variant. */
  template?: Partial<StoreProduct> | null;
  existingGroups: string[];
  existingBrands?: string[];
  availableCategories?: { id: string; label: string }[];
  availableGames?: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}

const inputClass = 'w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  );
}

export function StoreProductForm({
  product,
  template,
  existingGroups,
  existingBrands = [],
  availableCategories,
  availableGames,
  onClose,
  onSaved,
}: StoreProductFormProps) {
  const categoryList = availableCategories && availableCategories.length > 0 ? availableCategories : STORE_CATEGORIES;
  const gameList = availableGames && availableGames.length > 0 ? availableGames : STORE_GAMES;

  const src = product ?? template ?? {};
  const [name, setName] = useState(src.name ?? '');

  // Category: standard or custom
  const isCustomCategoryInit = Boolean(src.category && !categoryList.some((c) => c.id === src.category));
  const [categorySelect, setCategorySelect] = useState<string>(isCustomCategoryInit ? '__custom__' : (src.category ?? 'sleeves'));
  const [customCategory, setCustomCategory] = useState<string>(isCustomCategoryInit ? (src.category || '') : '');

  // Brand: optional text input with datalist suggestions
  const [brand, setBrand] = useState(src.brand && src.brand !== 'None' ? src.brand : '');

  // Game: standard or custom
  const isCustomGameInit = Boolean(src.game && src.game !== 'universal' && !gameList.some((g) => g.id === src.game));
  const [gameSelect, setGameSelect] = useState<string>(isCustomGameInit ? '__custom__' : (src.game ?? 'universal'));
  const [customGame, setCustomGame] = useState<string>(isCustomGameInit ? (src.game || '') : '');

  const [sku, setSku] = useState(product ? src.sku ?? '' : '');
  const [ean, setEan] = useState(product ? src.ean ?? '' : '');
  const [price, setPrice] = useState(src.price_huf !== undefined ? String(src.price_huf) : '');
  const [originalPrice, setOriginalPrice] = useState(src.original_price_huf ? String(src.original_price_huf) : '');
  const [msrp, setMsrp] = useState(src.attributes?.msrp_huf ? String(src.attributes.msrp_huf) : '');
  const [stock, setStock] = useState(product ? String(src.stock_quantity ?? 0) : '0');
  const [maxPerOrder, setMaxPerOrder] = useState(src.attributes?.max_per_order ? String(src.attributes.max_per_order) : '');
  const [status, setStatus] = useState<StoreProductStatus>(
    product ? (src.status === 'draft' ? 'draft' : 'active') : 'active'
  );
  const [releaseAt, setReleaseAt] = useState(() => {
    const raw = src.attributes?.release_at;
    if (typeof raw === 'string' && raw.trim() && Number.isFinite(Date.parse(raw))) {
      const d = new Date(Date.parse(raw));
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return '';
  });
  const [cost, setCost] = useState(src.cost_price_huf ? String(src.cost_price_huf) : '');
  const [subcategory, setSubcategory] = useState(src.attributes?.subcategory ?? (src.name ? subcategoryOf(src as StoreProduct) ?? '' : ''));
  const [color, setColor] = useState(product ? src.attributes?.color ?? '' : '');
  const [size, setSize] = useState(src.attributes?.size ?? '');
  const [language, setLanguageAttr] = useState(src.attributes?.language ?? '');
  const [variantGroup, setVariantGroup] = useState(src.variant_group ?? '');
  const [variantLabel, setVariantLabel] = useState(product ? src.variant_label ?? '' : '');
  const [variantKind, setVariantKind] = useState<StoreVariantKind>(src.variant_kind ?? 'color');
  const [images, setImages] = useState<string[]>(product ? src.images ?? [] : []);
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState(src.description ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Dynamic brand list combining known brands and existing DB brands
  const allBrands = useMemo(() => {
    const set = new Set<string>([...STORE_BRANDS, ...existingBrands]);
    return Array.from(set).sort();
  }, [existingBrands]);

  // Live margin calculation
  const numPrice = Number(price) || 0;
  const numCost = Number(cost) || 0;
  const liveMargin = numCost > 0 ? numPrice - numCost : null;
  const liveMarginPercent = (liveMargin !== null && numPrice > 0) ? Math.round((liveMargin / numPrice) * 100) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    const res = await storeApi<{ urls?: string[]; error?: string }>('/api/admin/upload-image', { method: 'POST', body: form });
    if (res.ok && res.data.urls) setImages((prev) => [...prev, ...res.data.urls!]);
    else setError(res.data.error || 'Image upload failed.');
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const addImageUrl = () => {
    const url = imageUrl.trim();
    if (!url) return;
    setImages((prev) => [...prev, url]);
    setImageUrl('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Resolve category
    const finalCategory = categorySelect === '__custom__'
      ? customCategory.trim().toLowerCase().replace(/\s+/g, '_')
      : categorySelect;

    if (!finalCategory) {
      setError('Please select or specify a category.');
      return;
    }

    // Resolve brand (optional, defaults to 'None' for schema compatibility)
    const finalBrand = brand.trim() || 'None';

    // Resolve game
    const finalGame = gameSelect === 'universal'
      ? null
      : (gameSelect === '__custom__' ? customGame.trim() : gameSelect);

    if (variantGroup.trim() && !variantLabel.trim()) {
      setError('A product in a variant group needs a variant label, e.g. "Black" or "Radiance".');
      return;
    }

    setSaving(true);
    const payload = {
      id: product?.id,
      name: name.trim(),
      category: finalCategory,
      brand: finalBrand,
      game: finalGame,
      sku: sku.trim() || null,
      ean: ean.trim() || null,
      price_huf: price,
      original_price_huf: originalPrice || null,
      stock_quantity: stock,
      status,
      cost_price_huf: cost || null,
      description: description.trim() || null,
      images,
      attributes: {
        color: color.trim(),
        size: size.trim(),
        ...(language.trim() ? { language: language.trim() } : {}),
        ...(subcategory.trim() ? { subcategory: subcategory.trim() } : {}),
        ...(maxPerOrder.trim() ? { max_per_order: Math.max(1, parseInt(maxPerOrder, 10) || 1) } : {}),
        ...(msrp.trim() ? { msrp_huf: Math.max(0, parseInt(msrp, 10) || 0) } : {}),
        ...(releaseAt.trim() && Number.isFinite(Date.parse(releaseAt)) ? { release_at: new Date(Date.parse(releaseAt)).toISOString() } : {}),
      },
      variant_group: variantGroup.trim() || null,
      variant_label: variantGroup.trim() ? variantLabel.trim() : null,
      variant_kind: variantGroup.trim() ? variantKind : null,
    };

    const res = await storeApi<{ error?: string }>('/api/store/products', {
      method: product ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    setSaving(false);
    if (!res.ok) {
      setError(res.data.error || 'Could not save the product.');
      return;
    }
    onSaved();
  };

  const title = product ? 'Edit product' : template ? 'Add variant' : 'Add product';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-xs" onClick={() => !saving && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl z-10 overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div>
            <h2 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            {!product && template && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Copied from {template.name}. Set the new SKU, label and price.</p>
            )}
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

        {/* Scrollable Form Body */}
        <div className="overflow-y-auto p-4 sm:p-6 flex-1 space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-xl mb-4 text-xs border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>
              {error}
            </div>
          )}

          <form id="store-product-form" onSubmit={submit} className="space-y-4">
            <Field label="Product title *">
              <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} placeholder="Ultimate Guard Katana Sleeves Standard Size (100)" />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Field label="Category *">
                  <select
                    value={categorySelect}
                    onChange={(e) => setCategorySelect(e.target.value)}
                    className={`${inputClass} cursor-pointer`}
                    style={inputStyle}
                  >
                    {categoryList.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    <option value="__custom__">+ Custom category...</option>
                  </select>
                </Field>
                {categorySelect === '__custom__' && (
                  <input
                    required
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="e.g. figurines, apparel"
                    className={`${inputClass} mt-2`}
                    style={inputStyle}
                  />
                )}
              </div>

              <div>
                <Field label="Brand (optional)" hint="Manufacturer or publisher (can be left blank)">
                  <input
                    list="store-brands"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="Leave empty or specify brand..."
                  />
                  <datalist id="store-brands">
                    {allBrands.map((b) => <option key={b} value={b} />)}
                  </datalist>
                </Field>
              </div>

              <div>
                <Field label="Game" hint="Specific TCG or Universal supplies">
                  <select
                    value={gameSelect}
                    onChange={(e) => setGameSelect(e.target.value)}
                    className={`${inputClass} cursor-pointer`}
                    style={inputStyle}
                  >
                    {gameList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    <option value="__custom__">+ Custom game...</option>
                  </select>
                </Field>
                {gameSelect === '__custom__' && (
                  <input
                    required
                    value={customGame}
                    onChange={(e) => setCustomGame(e.target.value)}
                    placeholder="e.g. yugioh, pokemon"
                    className={`${inputClass} mt-2`}
                    style={inputStyle}
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="SKU" hint="Used to match this product on partner CSV imports.">
                <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} style={inputStyle} placeholder="UGD011166" />
              </Field>
              <Field label="EAN / barcode">
                <input value={ean} onChange={(e) => setEan(e.target.value)} className={inputClass} style={inputStyle} inputMode="numeric" placeholder="4056133011101" />
              </Field>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <Field label="Price (HUF) *">
                <input required type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} style={inputStyle} placeholder="4290" />
              </Field>
              <Field label="Old price">
                <input type="number" min={0} value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} className={inputClass} style={inputStyle} placeholder="4590" />
              </Field>
              <Field label="MSRP (HUF)" hint="Shown in product specs">
                <input type="number" min={0} value={msrp} onChange={(e) => setMsrp(e.target.value)} className={inputClass} style={inputStyle} placeholder="4990" />
              </Field>
              <Field label="Stock *">
                <input required type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Max/order" hint="Anti-scalping limit">
                <input type="number" min={1} value={maxPerOrder} onChange={(e) => setMaxPerOrder(e.target.value)} className={inputClass} style={inputStyle} placeholder="e.g. 2" />
              </Field>
              <Field label="Status" hint="Out of stock is automatic based on inventory count">
                <select value={status} onChange={(e) => setStatus(e.target.value as StoreProductStatus)} className={`${inputClass} cursor-pointer`} style={inputStyle}>
                  <option value="active">Active (visible in store)</option>
                  <option value="draft">Draft (hidden from shoppers)</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <Field label="Timed product release (optional)" hint="Stays hidden as Draft until this date & time, then automatically becomes active.">
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={releaseAt}
                    onChange={(e) => setReleaseAt(e.target.value)}
                    className={`${inputClass} flex-1`}
                    style={inputStyle}
                  />
                  {releaseAt && (
                    <button
                      type="button"
                      onClick={() => setReleaseAt('')}
                      className="px-2.5 py-2 rounded-xl border text-xs font-bold cursor-pointer shrink-0 hover:bg-[var(--bg-raised)]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </Field>
              <Field label="Product type / Subcategory" hint="Used for specific Store filters (e.g. Booster Pack, Booster Display, Vault, Starter Deck, Playmat)">
                <input
                  list="store-subcategories"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="e.g. Booster Display, Booster Pack, Vault, Starter Deck..."
                />
                <datalist id="store-subcategories">
                  {(STORE_SUBCATEGORIES_BY_CATEGORY[categorySelect] || []).map((sub) => (
                    <option key={sub} value={sub} />
                  ))}
                </datalist>
              </Field>
            </div>

            {/* Cost price & Live Margin */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <Field label="Cost price (HUF)" hint="Admin only. Used to calculate profit margin.">
                <input
                  type="number"
                  min={0}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="e.g. 2750"
                />
              </Field>
              <div>
                <span className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Estimated Margin
                </span>
                <div className="h-[38px] px-3 rounded-xl border flex items-center gap-2 text-xs font-bold" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                  {liveMargin !== null ? (
                    <span style={{ color: liveMargin >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                      {liveMargin >= 0 ? '+' : ''}{liveMargin.toLocaleString('hu-HU')} Ft
                      {liveMarginPercent !== null && ` (${liveMarginPercent}%)`}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Enter price &amp; cost to calculate</span>
                  )}
                </div>
                <span className="block text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Profit margin based on selling price
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Color attribute">
                <input value={color} onChange={(e) => setColor(e.target.value)} className={inputClass} style={inputStyle} placeholder="Black, Ruby, Petrol Blue..." />
              </Field>
              <Field label="Size / capacity attribute">
                <input value={size} onChange={(e) => setSize(e.target.value)} className={inputClass} style={inputStyle} placeholder="Standard, Japanese, 100+, 360..." />
              </Field>
              <Field label="Language attribute" hint="English, Japanese, Simplified Chinese...">
                <input
                  list="store-languages"
                  value={language}
                  onChange={(e) => setLanguageAttr(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="English, Japanese, Simplified Chinese..."
                />
                <datalist id="store-languages">
                  <option value="English" />
                  <option value="Japanese" />
                  <option value="Simplified Chinese" />
                  <option value="Traditional Chinese" />
                  <option value="Korean" />
                  <option value="German" />
                  <option value="French" />
                  <option value="Italian" />
                  <option value="Spanish" />
                </datalist>
              </Field>
            </div>

            {/* Clean Variants Card (No awkward overlapping legend border) */}
            <div className="p-4 rounded-xl border space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-black tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                  Variants (colours, sets, sizes)
                </span>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Each option is its own product with its own SKU, price and stock. Give products the same group key and
                the product page lets shoppers switch between them seamlessly.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <Field label="Group key" hint="e.g. ug-katana-standard-100">
                  <input list="store-groups" value={variantGroup} onChange={(e) => setVariantGroup(e.target.value)} className={inputClass} style={inputStyle} placeholder="ug-katana-standard-100" />
                  <datalist id="store-groups">{existingGroups.map((g) => <option key={g} value={g} />)}</datalist>
                </Field>
                <Field label="Option name" hint="e.g. Black / Radiance / 60ct">
                  <input value={variantLabel} onChange={(e) => setVariantLabel(e.target.value)} disabled={!variantGroup.trim()} className={inputClass} style={inputStyle} placeholder="Jet Black" />
                </Field>
                <Field label="Option type">
                  <select value={variantKind} onChange={(e) => setVariantKind(e.target.value as StoreVariantKind)} disabled={!variantGroup.trim()} className={`${inputClass} cursor-pointer`} style={inputStyle}>
                    {STORE_VARIANT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <div>
              <span className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>Images (the first one is the cover)</span>
              {images.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2">
                  {images.map((url, i) => (
                    <div key={url + i} className="relative w-16 h-16 rounded-lg border overflow-hidden" style={{ borderColor: i === 0 ? 'var(--accent)' : 'var(--border)', background: 'var(--bg-surface-2)' }}>
                      <img src={url} alt="" className="w-full h-full object-contain p-1" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Remove image ${i + 1}`}
                        className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center rounded-bl-lg cursor-pointer"
                        style={{ background: 'rgba(0,0,0,0.75)', color: '#fff' }}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => uploadFiles(e.target.files)} className="hidden" id="store-image-upload" />
                <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="px-3 py-2 text-xs font-bold rounded-xl border cursor-pointer disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-surface-2)' }}>
                  {uploading ? 'Uploading...' : 'Upload images'}
                </button>
                <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImageUrl(); } }} placeholder="or paste an image URL" aria-label="Image URL" className={`${inputClass} flex-1 min-w-[160px]`} style={inputStyle} />
                <button type="button" onClick={addImageUrl} className="px-3 py-2 text-xs font-bold rounded-xl border cursor-pointer" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Add</button>
              </div>
            </div>

            <Field label="Description">
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} style={inputStyle} placeholder="Product features, contents and specifications..." />
            </Field>
          </form>
        </div>

        {/* Fixed Footer */}
        <div className="flex items-center justify-end gap-3 p-4 sm:p-5 border-t shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button type="button" disabled={saving} onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)] transition" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Cancel
          </button>
          <button form="store-product-form" type="submit" disabled={saving || uploading} className="px-5 py-2 rounded-xl text-xs font-bold shadow-sm active:scale-95 cursor-pointer disabled:opacity-50 transition" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
            {saving ? 'Saving...' : product ? 'Update product' : 'Create product'}
          </button>
        </div>
      </div>
    </div>
  );
}
