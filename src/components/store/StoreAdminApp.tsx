import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StoreProduct, Order } from '../../types';
import { STORE_BRANDS, STORE_CATEGORIES, STORE_GAMES } from '../../lib/storeConstants';
import { useCurrency } from '../../lib/currency';
import { gameOf, isSoldOut } from '../../lib/storeProducts';
import { StoreClosed, StoreSpinner } from './StoreStates';
import { StoreProductForm } from './StoreProductForm';
import { StoreImportModal } from './StoreImportModal';
import { StoreTaxonomyModal } from './StoreTaxonomyModal';
import { StoreAnalyticsTab } from './StoreAnalyticsTab';
import { StoreOrdersTab } from './StoreOrdersTab';
import { StoreWithdrawalsTab, type StoreWithdrawal } from './StoreWithdrawalsTab';
import { StoreShippingTab } from './StoreShippingTab';
import { storeApi, useStoreAuth } from './storeClient';
import type { StoreTaxonomies } from '../../pages/api/store/taxonomies';
import type { ProductRequestEntry } from '../../pages/api/store/product-requests';

type StatusTab = 'all' | 'active' | 'low_stock' | 'out_of_stock' | 'draft';

const LOW_STOCK = 5;
const selectClass = 'px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer';
const selectStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  active: { label: 'Live', bg: 'var(--positive-muted)', color: 'var(--positive)', border: 'var(--positive-border)' },
  low_stock: { label: 'Low stock', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.4)' },
  draft: { label: 'Draft', bg: 'rgba(234,179,8,0.15)', color: '#eab308', border: 'rgba(234,179,8,0.4)' },
  out_of_stock: { label: 'Out of stock', bg: 'var(--negative-muted)', color: 'var(--negative)', border: 'var(--negative-border)' },
};

function getEffectiveStatus(p: StoreProduct): 'draft' | 'out_of_stock' | 'low_stock' | 'active' {
  if (p.status === 'draft' || p.status === 'archived') return 'draft';
  if (p.stock_quantity === 0 || isSoldOut(p)) return 'out_of_stock';
  if (p.stock_quantity <= LOW_STOCK) return 'low_stock';
  return 'active';
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded-lg border transition cursor-pointer hover:bg-[var(--bg-raised)] ${danger ? 'hover:text-red-400' : 'hover:text-[var(--text-accent)]'}`}
      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
    >
      {children}
    </button>
  );
}

const svgProps = { className: 'w-3.5 h-3.5', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** /store/admin - manage the store catalogue. Admins only. */
export function StoreAdminApp({ embedded = false }: { embedded?: boolean } = {}) {
  const { loading: authLoading, isAdmin } = useStoreAuth();
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<StatusTab>('all');
  const [category, setCategory] = useState('all');
  const [brand, setBrand] = useState('all');
  const [game, setGame] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);

  // View mode switcher: products catalogue vs orders vs stock analytics vs withdrawals vs product requests vs store shipping
  const [viewMode, setViewMode] = useState<'products' | 'orders' | 'analytics' | 'withdrawals' | 'requests' | 'shipping'>('products');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [withdrawals, setWithdrawals] = useState<StoreWithdrawal[]>([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [updatingWithdrawalId, setUpdatingWithdrawalId] = useState<string | null>(null);
  const [productRequests, setProductRequests] = useState<ProductRequestEntry[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  const [form, setForm] = useState<null | { product: StoreProduct | null; template: Partial<StoreProduct> | null }>(null);
  const [importing, setImporting] = useState(false);
  const [taxonomiesOpen, setTaxonomiesOpen] = useState(false);
  const [customTaxonomies, setCustomTaxonomies] = useState<StoreTaxonomies>({
    customBrands: [],
    customCategories: [],
    customGames: [],
  });

  const loadWithdrawals = useCallback(async () => {
    setLoadingWithdrawals(true);
    try {
      const res = await storeApi<{ withdrawals?: StoreWithdrawal[]; success?: boolean }>('/api/store/withdrawals');
      if (res.ok && res.data.withdrawals) {
        setWithdrawals(res.data.withdrawals);
      }
    } catch (e) {
      console.error('Failed to load withdrawals:', e);
    } finally {
      setLoadingWithdrawals(false);
    }
  }, []);

  const updateWithdrawalStatus = async (id: string, status: StoreWithdrawal['status'], adminNotes?: string) => {
    setUpdatingWithdrawalId(id);
    try {
      const res = await storeApi('/api/store/withdrawals', {
        method: 'PATCH',
        body: JSON.stringify({ id, status, admin_notes: adminNotes }),
      });
      if (res.ok) {
        setWithdrawals((prev) => prev.map((w) => (w.id === id ? { ...w, status, admin_notes: adminNotes !== undefined ? adminNotes : w.admin_notes } : w)));
      }
    } catch (e) {
      console.error('Failed to update withdrawal:', e);
    } finally {
      setUpdatingWithdrawalId(null);
    }
  };

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const res = await storeApi<{ orders?: Order[]; success?: boolean }>('/api/orders');
      if (res.ok && res.data.orders) {
        setOrders(res.data.orders);
      }
    } catch (e) {
      console.error('Failed to load store orders:', e);
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const load = useCallback(async () => {
    const res = await storeApi<{ products?: StoreProduct[]; warning?: string; error?: string }>('/api/store/products');
    if (res.ok) {
      setProducts(res.data.products || []);
      setNotice(res.data.warning || null);
      setError(null);
    } else {
      setError(res.data.error || 'Could not load products.');
    }
    setLoading(false);
  }, []);

  const loadTaxonomies = useCallback(async () => {
    const res = await storeApi<StoreTaxonomies>('/api/store/taxonomies');
    if (res.ok && res.data) {
      setCustomTaxonomies(res.data);
    }
  }, []);

  const loadProductRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await storeApi<{ requests?: ProductRequestEntry[] }>('/api/store/product-requests');
      if (res.ok && res.data.requests) {
        setProductRequests(res.data.requests);
      }
    } catch (e) {
      console.error('Failed to load product requests:', e);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  const updateProductRequestStatus = async (id: string, status: ProductRequestEntry['status']) => {
    const res = await storeApi('/api/store/product-requests', {
      method: 'PATCH',
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      setProductRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    }
  };

  const deleteProductRequest = async (id: string) => {
    const res = await storeApi(`/api/store/product-requests?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setProductRequests((prev) => prev.filter((r) => r.id !== id));
    }
  };

  useEffect(() => {
    if (!authLoading && isAdmin) {
      load();
      loadTaxonomies();
      loadWithdrawals();
      loadProductRequests();
      loadOrders();
    }
  }, [authLoading, isAdmin, load, loadTaxonomies, loadWithdrawals, loadProductRequests, loadOrders]);

  const counts = useMemo(
    () => ({
      all: products.length,
      active: products.filter((p) => p.status === 'active' && !isSoldOut(p)).length,
      low_stock: products.filter((p) => p.status !== 'draft' && p.stock_quantity > 0 && p.stock_quantity <= LOW_STOCK).length,
      out_of_stock: products.filter((p) => p.status !== 'draft' && isSoldOut(p)).length,
      draft: products.filter((p) => p.status === 'draft').length,
    }),
    [products]
  );

  const allCategories = useMemo(() => {
    if (Array.isArray(customTaxonomies.categories) && customTaxonomies.categories.length > 0) {
      return customTaxonomies.categories;
    }
    const map = new Map<string, string>();
    STORE_CATEGORIES.forEach((c) => map.set(c.id, c.label));
    (customTaxonomies.customCategories || []).forEach((c) => {
      if (!map.has(c.id)) map.set(c.id, c.label);
    });
    products.forEach((p) => {
      if (p.category && !map.has(p.category)) {
        map.set(p.category, p.category.charAt(0).toUpperCase() + p.category.slice(1));
      }
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [customTaxonomies, products]);

  const allGames = useMemo(() => {
    if (Array.isArray(customTaxonomies.games) && customTaxonomies.games.length > 0) {
      return customTaxonomies.games;
    }
    const map = new Map<string, string>();
    STORE_GAMES.forEach((g) => map.set(g.id, g.name));
    (customTaxonomies.customGames || []).forEach((g) => {
      if (!map.has(g.id)) map.set(g.id, g.name);
    });
    products.forEach((p) => {
      const g = p.game || (p.attributes?.game as string);
      if (g && !map.has(g)) {
        map.set(g, g.charAt(0).toUpperCase() + g.slice(1));
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [customTaxonomies, products]);

  const brands = useMemo(() => {
    const list = Array.isArray(customTaxonomies.brands) && customTaxonomies.brands.length > 0
      ? customTaxonomies.brands
      : Array.from(new Set([...STORE_BRANDS, ...(customTaxonomies.customBrands || [])]));
    const set = new Set([...list, ...products.map((p) => p.brand)]);
    set.delete('None');
    set.delete('Default');
    set.delete('');
    return Array.from(set).filter(Boolean).sort();
  }, [products, customTaxonomies]);
  const groups = useMemo(() => [...new Set(products.map((p) => p.variant_group).filter((g): g is string => Boolean(g)))].sort(), [products]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !`${p.name} ${p.brand} ${p.sku ?? ''} ${p.ean ?? ''} ${p.variant_group ?? ''} ${p.supplier ?? ''}`.toLowerCase().includes(q)) return false;
      if (tab === 'active' && !(p.status === 'active' && !isSoldOut(p))) return false;
      if (tab === 'low_stock' && !(p.status !== 'draft' && p.stock_quantity > 0 && p.stock_quantity <= LOW_STOCK)) return false;
      if (tab === 'draft' && p.status !== 'draft') return false;
      if (tab === 'out_of_stock' && !(p.status !== 'draft' && isSoldOut(p))) return false;
      if (category !== 'all' && p.category !== category) return false;
      if (brand !== 'all' && p.brand !== brand) return false;
      if (game !== 'all' && gameOf(p) !== game) return false;
      if (lowOnly && !(p.stock_quantity <= LOW_STOCK)) return false;
      return true;
    });
  }, [products, search, tab, category, brand, game, lowOnly]);

  const filtersActive = search || category !== 'all' || brand !== 'all' || game !== 'all' || lowOnly || tab !== 'all';
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    setPage(1);
  }, [search, tab, category, brand, game, lowOnly]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const paginatedVisible = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return visible.slice(start, start + PAGE_SIZE);
  }, [visible, page]);

  const clearFilters = () => {
    setSearch('');
    setTab('all');
    setCategory('all');
    setBrand('all');
    setGame('all');
    setLowOnly(false);
  };

  const adjustStock = async (p: StoreProduct, delta: number) => {
    const next = Math.max(0, p.stock_quantity + delta);
    if (next === p.stock_quantity) return;
    const status = next > 0 && p.status !== 'draft' ? 'active' : p.status;
    setProducts((cur) => cur.map((x) => (x.id === p.id ? { ...x, stock_quantity: next, status } : x)));
    const res = await storeApi('/api/store/products', { method: 'PATCH', body: JSON.stringify({ id: p.id, stock_quantity: next, status }) });
    if (!res.ok) {
      setProducts((cur) => cur.map((x) => (x.id === p.id ? p : x)));
      setError('Could not update the stock.');
    }
  };

  const setExactStock = async (p: StoreProduct, next: number) => {
    const nextStock = Math.max(0, next);
    if (nextStock === p.stock_quantity) return;
    const status = nextStock > 0 && p.status !== 'draft' ? 'active' : p.status;
    setProducts((cur) => cur.map((x) => (x.id === p.id ? { ...x, stock_quantity: nextStock, status } : x)));
    const res = await storeApi('/api/store/products', { method: 'PATCH', body: JSON.stringify({ id: p.id, stock_quantity: nextStock, status }) });
    if (!res.ok) {
      setProducts((cur) => cur.map((x) => (x.id === p.id ? p : x)));
      setError('Could not update the stock.');
    }
  };

  const archive = async (p: StoreProduct) => {
    if (!window.confirm(`Archive "${p.name}"? It disappears from the store; its SKU stays reserved.`)) return;
    const res = await storeApi(`/api/store/products?id=${p.id}`, { method: 'DELETE' });
    if (res.ok) setProducts((cur) => cur.filter((x) => x.id !== p.id));
    else setError('Could not archive the product.');
  };

  const addVariantOf = async (p: StoreProduct) => {
    let group = p.variant_group;
    let kind = p.variant_kind || (p.attributes?.color ? 'color' : 'other');
    if (!group) {
      // The product is not in a group yet, so start one with it: otherwise the shop's switcher would
      // list the new variant but not the product it was copied from.
      group = p.sku || p.slug;
      const label = p.attributes?.color || p.attributes?.size || 'Default';
      kind = p.attributes?.color ? 'color' : p.attributes?.size ? 'size' : 'other';
      const res = await storeApi('/api/store/products', {
        method: 'PATCH',
        body: JSON.stringify({ id: p.id, variant_group: group, variant_label: label, variant_kind: kind }),
      });
      if (!res.ok) {
        setError('Could not group the original product.');
        return;
      }
      load();
    }
    setForm({
      product: null,
      template: { ...p, variant_group: group, variant_label: '', variant_kind: kind, sku: '', ean: '', stock_quantity: 0, images: [] },
    });
  };

  if (authLoading) return <StoreSpinner />;
  if (!isAdmin) return <StoreClosed />;

  const totalUnits = products.reduce((n, p) => n + p.stock_quantity, 0);
  const lowCount = products.filter((p) => p.status !== 'draft' && p.stock_quantity > 0 && p.stock_quantity <= LOW_STOCK).length;
  const outCount = products.filter((p) => p.status !== 'draft' && p.stock_quantity === 0).length;

  const tabs: { id: StatusTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Live' },
    { id: 'low_stock', label: 'Low stock' },
    { id: 'out_of_stock', label: 'Out of stock' },
    { id: 'draft', label: 'Draft' },
  ];

  return (
    <div className={embedded ? 'space-y-4' : 'max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-8'}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border mb-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}>
              Store admin
            </span>
            {/* View Mode Switcher */}
            <div className="inline-flex rounded-lg border p-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setViewMode('products')}
                className="px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
                style={viewMode === 'products' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
                <span>Products ({products.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('orders');
                  loadOrders();
                }}
                className="px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
                style={viewMode === 'orders' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                <span>Orders ({orders.length})</span>
                {orders.filter((o) => o.status === 'Pending').length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('analytics');
                  if (orders.length === 0) loadOrders();
                }}
                className="px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
                style={viewMode === 'analytics' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                <span>Analytics & Stock</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('withdrawals');
                  if (withdrawals.length === 0) loadWithdrawals();
                }}
                className="px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
                style={viewMode === 'withdrawals' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span>Withdrawals ({withdrawals.length})</span>
                {withdrawals.filter((w) => w.status === 'pending').length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('requests');
                  if (productRequests.length === 0) loadProductRequests();
                }}
                className="px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
                style={viewMode === 'requests' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>Product Requests ({productRequests.length})</span>
                {productRequests.filter((r) => r.status === 'open').length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('shipping')}
                className="px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
                style={viewMode === 'shipping' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="3" width="15" height="13" />
                  <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
                <span>Shipping</span>
              </button>
            </div>
          </div>
          <h1 className="text-xl sm:text-2xl font-black mt-1" style={{ color: 'var(--text-primary)' }}>
            {viewMode === 'products'
              ? 'Store products'
              : viewMode === 'orders'
                ? 'Store Orders'
                : viewMode === 'analytics'
                  ? 'Stock & Sales Analytics'
                  : viewMode === 'withdrawals'
                    ? 'Consumer Withdrawals (Elállási jog / Elállás)'
                    : viewMode === 'shipping'
                      ? 'Store Shipping & Free-Shipping Thresholds'
                      : 'Customer Product Requests'}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {viewMode === 'orders' ? (
              <>{orders.length} orders total · <span style={{ color: 'var(--text-primary)' }}>{orders.filter((o) => o.status === 'Pending').length} pending fulfillment</span></>
            ) : viewMode === 'withdrawals' ? (
              <>{withdrawals.length} withdrawal notices · <span style={{ color: 'var(--text-primary)' }}>{withdrawals.filter((w) => w.status === 'pending').length} pending</span></>
            ) : viewMode === 'requests' ? (
              <>{productRequests.length} customer requests · <span style={{ color: 'var(--text-primary)' }}>{productRequests.filter((r) => r.status === 'open').length} open</span></>
            ) : viewMode === 'shipping' ? (
              <>Configure delivery fees and free-shipping thresholds for Official Store checkout</>
            ) : (
              <>{products.length} products, {totalUnits} units in stock{(lowCount > 0 || outCount > 0) && (
                <>, <span style={{ color: 'var(--text-primary)' }}>{lowCount} low, {outCount} out of stock</span></>
              )}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!embedded && (
            <a href="/admin" className="px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)] inline-flex items-center gap-1.5" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <svg {...svgProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              Admin console
            </a>
          )}
          <a href="/store" className="px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            View shop
          </a>
          <button
            type="button"
            onClick={() => setTaxonomiesOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)] inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-surface-2)' }}
          >
            <svg {...svgProps}><path d="M4 6h16M4 12h16M4 18h7" /></svg>
            Taxonomies
          </button>
          <button type="button" onClick={() => setImporting(true)} className="px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-surface-2)' }}>
            Import CSV
          </button>
          <button type="button" onClick={() => setForm({ product: null, template: null })} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shadow-sm active:scale-95 cursor-pointer" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
            <svg {...svgProps} strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add product
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div role="alert" className="mb-4 p-3 rounded-xl border text-xs" style={{ background: 'rgba(234,179,8,0.1)', borderColor: 'rgba(234,179,8,0.3)', color: '#eab308' }}>
          {error || notice}
        </div>
      )}

      {viewMode === 'orders' ? (
        <StoreOrdersTab
          orders={orders}
          loading={loadingOrders}
          onRefresh={loadOrders}
        />
      ) : viewMode === 'analytics' ? (
        <StoreAnalyticsTab
          products={products}
          orders={orders}
          loadingOrders={loadingOrders}
          onRefreshOrders={loadOrders}
          onQuickUpdateStock={setExactStock}
          onEditProduct={(p) => setForm({ product: p, template: null })}
        />
      ) : viewMode === 'withdrawals' ? (
        <StoreWithdrawalsTab
          withdrawals={withdrawals}
          loading={loadingWithdrawals}
          onRefresh={loadWithdrawals}
          onUpdateStatus={updateWithdrawalStatus}
          updatingId={updatingWithdrawalId}
        />
      ) : viewMode === 'shipping' ? (
        <StoreShippingTab />
      ) : viewMode === 'requests' ? (
        <div className="p-5 rounded-2xl border space-y-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                Submitted Product Requests
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Products requested by visitors via the footer &quot;Request a Product&quot; modal.
              </p>
            </div>
            <button
              type="button"
              onClick={loadProductRequests}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              {loadingRequests ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {productRequests.length === 0 ? (
            <div className="py-12 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              No product requests submitted yet.
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {productRequests.map((req) => (
                <div key={req.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {req.product_name}
                      </span>
                      {req.game_or_brand && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md border"
                          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                        >
                          {req.game_or_brand}
                        </span>
                      )}
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider"
                        style={
                          req.status === 'fulfilled'
                            ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
                            : req.status === 'reviewed'
                              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-primary)' }
                              : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                        }
                      >
                        {req.status}
                      </span>
                    </div>
                    {req.notes && (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {req.notes}
                      </p>
                    )}
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Submitted {new Date(req.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {(['open', 'reviewed', 'fulfilled'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => updateProductRequestStatus(req.id, st)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold border capitalize cursor-pointer"
                        style={
                          req.status === st
                            ? { background: 'var(--accent-strong)', borderColor: 'var(--accent-border)', color: 'var(--text-on-accent, #000)' }
                            : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                        }
                      >
                        {st}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => deleteProductRequest(req.id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer"
                      style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="p-3 sm:p-4 rounded-2xl border mb-4 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex gap-2 flex-wrap items-center">
          <div role="tablist" aria-label="Status" className="inline-flex rounded-xl border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition"
                style={tab === t.id ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' } : { color: 'var(--text-secondary)' }}
              >
                {t.label} <span className="tabular-nums opacity-70">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, SKU, EAN, supplier, group..."
            aria-label="Search products"
            className="flex-1 min-w-[200px] px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={selectStyle}
          />
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className={selectClass} style={selectStyle}>
            <option value="all">All categories</option>
            {allCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand" className={selectClass} style={selectStyle}>
            <option value="all">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game" className={selectClass} style={selectStyle}>
            <option value="all">All games</option>
            {allGames.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer px-1" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="w-3.5 h-3.5 cursor-pointer" style={{ accentColor: 'var(--accent)' }} />
            Low stock ({LOW_STOCK} or fewer)
          </label>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="ml-auto text-xs font-bold cursor-pointer" style={{ color: 'var(--text-accent)' }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Product table */}
      {loading ? (
        <StoreSpinner label="Loading products..." />
      ) : visible.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{products.length === 0 ? 'No products yet' : 'No products match'}</h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            {products.length === 0 ? 'Add one by hand, or import your partner price list.' : 'Try clearing a filter.'}
          </p>
          {products.length === 0 && (
            <button type="button" onClick={() => setImporting(true)} className="px-4 py-2 rounded-xl text-xs font-bold cursor-pointer" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
              Import CSV
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border overflow-x-auto" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <table className="w-full text-xs min-w-[920px]">
            <caption className="sr-only">Store products</caption>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th scope="col" className="px-3 py-2.5 font-bold">Product</th>
                <th scope="col" className="px-3 py-2.5 font-bold">SKU</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Category</th>
                <th scope="col" className="px-3 py-2.5 font-bold text-right">Price</th>
                <th scope="col" className="px-3 py-2.5 font-bold text-right">Margin</th>
                <th scope="col" className="px-3 py-2.5 font-bold text-center">Stock</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Status</th>
                <th scope="col" className="px-3 py-2.5 font-bold text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paginatedVisible.map((p) => {
                const st = STATUS_STYLE[getEffectiveStatus(p)] ?? STATUS_STYLE.draft;
                const margin = p.cost_price_huf ? p.price_huf - p.cost_price_huf : null;
                const marginPercent = (margin !== null && p.price_huf > 0) ? Math.round((margin / p.price_huf) * 100) : null;
                const low = p.stock_quantity <= LOW_STOCK;
                return (
                  <tr key={p.id} className="border-t align-middle" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 shrink-0 rounded-lg border overflow-hidden flex items-center justify-center" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                          {p.images?.[0] ? <img src={p.images[0]} alt="" className="w-full h-full object-contain p-0.5" loading="lazy" /> : <span className="text-[9px]" style={{ color: 'var(--text-placeholder)' }}>No image</span>}
                        </div>
                        <div className="min-w-0">
                          <a href={`/store/product?slug=${encodeURIComponent(p.slug)}`} className="font-bold truncate block max-w-[280px] hover:underline" style={{ color: 'var(--text-primary)' }} title={p.name}>{p.name}</a>
                          <div className="flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            <span>{p.brand}</span>
                            {p.variant_label && <span className="px-1.5 rounded border text-[10px] font-bold" style={{ borderColor: 'var(--border)', background: 'var(--bg-raised)' }}>{p.variant_label}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{p.sku || '-'}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{STORE_CATEGORIES.find((c) => c.id === p.category)?.label || p.category}</td>
                    <td className="px-3 py-2.5 text-right font-bold whitespace-nowrap" style={{ color: 'var(--positive)' }}>{formatPrice(p.price_huf)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap" style={{ color: margin === null ? 'var(--text-placeholder)' : margin < 0 ? 'var(--negative)' : 'var(--text-secondary)' }}>
                      {margin === null ? '-' : (
                        <div>
                          <span className="font-bold">{formatPrice(margin)}</span>
                          {marginPercent !== null && (
                            <span className="text-[11px] block font-normal" style={{ color: margin >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                              {marginPercent}%
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => adjustStock(p, -1)} aria-label={`Decrease stock of ${p.name}`} className="w-6 h-6 rounded-md border font-bold cursor-pointer hover:bg-[var(--bg-raised)]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>-</button>
                        <span className="min-w-[28px] text-center font-bold tabular-nums" style={{ color: p.stock_quantity === 0 ? 'var(--negative)' : low ? '#f59e0b' : 'var(--text-primary)' }}>{p.stock_quantity}</span>
                        <button type="button" onClick={() => adjustStock(p, 1)} aria-label={`Increase stock of ${p.name}`} className="w-6 h-6 rounded-md border font-bold cursor-pointer hover:bg-[var(--bg-raised)]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>+</button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="px-2 py-0.5 rounded-md border text-[10px] font-bold whitespace-nowrap" style={{ background: st.bg, color: st.color, borderColor: st.border }}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton label={`Edit ${p.name}`} onClick={() => setForm({ product: p, template: null })}>
                          <svg {...svgProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                        </IconButton>
                        <IconButton label={`Add a variant of ${p.name}`} onClick={() => addVariantOf(p)}>
                          <svg {...svgProps}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        </IconButton>
                        <IconButton label={`Archive ${p.name}`} onClick={() => archive(p)} danger>
                          <svg {...svgProps}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 p-4 border-t flex-wrap" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Showing <strong style={{ color: 'var(--text-primary)' }}>{(page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, visible.length)}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{visible.length}</strong> products
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const pNum = idx + 1;
                  const active = pNum === page;
                  return (
                    <button
                      key={pNum}
                      type="button"
                      onClick={() => setPage(pNum)}
                      className="w-8 h-8 rounded-lg border text-xs font-bold cursor-pointer transition"
                      style={
                        active
                          ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)', borderColor: 'var(--accent-strong)' }
                          : { background: 'var(--bg-surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                      }
                    >
                      {pNum}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {form && (
        <StoreProductForm
          product={form.product}
          template={form.template}
          existingGroups={groups}
          existingBrands={brands}
          availableCategories={allCategories}
          availableGames={allGames}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
      {importing && <StoreImportModal onClose={() => setImporting(false)} onDone={load} />}
      {taxonomiesOpen && (
        <StoreTaxonomyModal
          products={products}
          onClose={() => setTaxonomiesOpen(false)}
          onSaved={() => {
            loadTaxonomies();
            load();
          }}
        />
      )}
    </div>
  );
}
