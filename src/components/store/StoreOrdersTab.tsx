import { useState, useMemo, useEffect } from 'react';
import type { Order } from '../../types';
import { useCurrency } from '../../lib/currency';
import { storeApi } from './storeClient';
import { STORE_SHIPPING_METHODS } from '../../lib/storeCart';

interface Props {
  orders: Order[];
  loading: boolean;
  onRefresh: () => void;
}

type OrderFilter = 'all' | 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  Pending: { label: 'Pending (Függőben)', bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: 'rgba(234, 179, 8, 0.35)' },
  Processing: { label: 'Processing (Feldolgozás alatt)', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.35)' },
  Shipped: { label: 'Shipped (Feladva)', bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: 'rgba(168, 85, 247, 0.35)' },
  Delivered: { label: 'Delivered (Kézbesítve)', bg: 'var(--positive-muted)', color: 'var(--positive)', border: 'var(--positive-border)' },
  Cancelled: { label: 'Cancelled (Törölve)', bg: 'var(--negative-muted)', color: 'var(--negative)', border: 'var(--negative-border)' },
};

/** Default store shipping methods as fallback until /api/store/shipping responds */
const DEFAULT_STORE_SHIPPING_LABELS = STORE_SHIPPING_METHODS
  .filter((m) => m.enabled !== false)
  .map((m) => m.label.trim());

/** Match an order's checkout shipping method/mode string to one of the admin-configured store shipping methods */
function findMatchingShippingMethod(raw: string | undefined | null, methods: string[]): string | null {
  if (!raw || !methods.length) return null;
  const clean = raw.trim().toLowerCase();
  const exact = methods.find((m) => m.toLowerCase() === clean);
  if (exact) return exact;
  if (clean.includes('foxpost')) {
    const m = methods.find((x) => x.toLowerCase().includes('foxpost'));
    if (m) return m;
  }
  if (clean.includes('packeta') || clean.includes('z-box')) {
    const m = methods.find((x) => x.toLowerCase().includes('packeta'));
    if (m) return m;
  }
  if (clean.includes('gls')) {
    const m = methods.find((x) => x.toLowerCase().includes('gls'));
    if (m) return m;
  }
  if (clean.includes('személyes') || clean.includes('personal') || clean.includes('in-person') || clean.includes('átvétel')) {
    const m = methods.find((x) => x.toLowerCase().includes('personal') || x.toLowerCase().includes('személyes'));
    if (m) return m;
  }
  return null;
}

export function StoreOrdersTab({ orders, loading, onRefresh }: Props) {
  const { formatPrice } = useCurrency();
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [search, setSearch] = useState('');
  // Default state is closed as requested by the user
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [chattingOrderId, setChattingOrderId] = useState<string | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, { tracking: string; courier: string }>>({});
  const [shippingMethods, setShippingMethods] = useState<string[]>(DEFAULT_STORE_SHIPPING_LABELS);
  const [copiedOrderNumber, setCopiedOrderNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Dynamically load store shipping methods strictly configured in Store Admin Shipping
  useEffect(() => {
    storeApi<{ methods?: { label: string; enabled?: boolean }[] }>('/api/store/shipping')
      .then((res) => {
        if (res.ok && Array.isArray(res.data?.methods) && res.data.methods.length > 0) {
          const labels = res.data.methods
            .filter((m) => m.enabled !== false)
            .map((m) => m.label.trim())
            .filter(Boolean);
          if (labels.length > 0) {
            setShippingMethods(labels);
          }
        }
      })
      .catch(() => {});
  }, []);

  const toggleExpand = (orderNumber: string) => {
    setExpandedOrders((prev) => ({ ...prev, [orderNumber]: !prev[orderNumber] }));
  };

  const expandAll = () => {
    const allOpen: Record<string, boolean> = {};
    orders.forEach((o) => {
      allOpen[o.order_number] = true;
    });
    setExpandedOrders(allOpen);
  };

  const collapseAll = () => {
    setExpandedOrders({});
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const numMatch = (o.order_number || '').toLowerCase().includes(q);
      const nameMatch = (o.shipping_name || '').toLowerCase().includes(q) || (o.customer_info?.name || '').toLowerCase().includes(q);
      const emailMatch = (o.customer_info?.email || '').toLowerCase().includes(q) || (typeof o.notes === 'string' && o.notes.toLowerCase().includes(q));
      const itemsMatch = (o.items || []).some((i) => (i.card_name || '').toLowerCase().includes(q) || (i.card_number || '').toLowerCase().includes(q));
      return numMatch || nameMatch || emailMatch || itemsMatch;
    });
  }, [orders, filter, search]);

  const stats = useMemo(() => {
    const total = orders.length;
    const pending = orders.filter((o) => o.status === 'Pending').length;
    const activeFulfillment = orders.filter((o) => o.status === 'Pending' || o.status === 'Processing').length;
    return { total, pending, activeFulfillment };
  }, [orders]);

  const handleUpdateStatus = async (order: Order, newStatus: string) => {
    setUpdatingOrderId(order.order_number);
    setErrorMsg(null);
    setSuccessNotice(null);
    try {
      const res = await storeApi('/api/orders', {
        method: 'PATCH',
        body: JSON.stringify({
          orderNumber: order.order_number,
          order_number: order.order_number,
          status: newStatus,
        }),
      });
      if (res.ok) {
        setSuccessNotice(`Order #${order.order_number} status updated to ${newStatus}.`);
        onRefresh();
      } else {
        setErrorMsg(res.data?.error || 'Failed to update order status.');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error updating order status.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleSaveTracking = async (order: Order) => {
    const matched = findMatchingShippingMethod(
      (order as any).courier_name || order.customer_info?.shipping_mode || order.shipping_method,
      shippingMethods
    );
    const defaultCourier = (order as any).courier_name || matched || shippingMethods[0] || 'FoxPost Parcel Locker';
    const current = trackingInputs[order.order_number] || {
      tracking: order.tracking_number || '',
      courier: defaultCourier,
    };
    setUpdatingOrderId(order.order_number);
    setErrorMsg(null);
    setSuccessNotice(null);
    try {
      const res = await storeApi('/api/orders', {
        method: 'PATCH',
        body: JSON.stringify({
          orderNumber: order.order_number,
          order_number: order.order_number,
          trackingNumber: current.tracking.trim() || null,
          tracking_number: current.tracking.trim() || null,
          courierName: current.courier.trim() || null,
          courier_name: current.courier.trim() || null,
          status: current.tracking.trim() && (order.status === 'Pending' || order.status === 'Processing') ? 'Shipped' : order.status,
        }),
      });
      if (res.ok) {
        setSuccessNotice(`Tracking information saved for Order #${order.order_number}.`);
        onRefresh();
      } else {
        setErrorMsg(res.data?.error || 'Failed to update tracking info.');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error updating tracking info.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleStartChat = async (order: Order) => {
    setChattingOrderId(order.order_number);
    setErrorMsg(null);
    try {
      const res = await storeApi<{ success?: boolean; conversation_id?: string; error?: string }>('/api/store/order-chat', {
        method: 'POST',
        body: JSON.stringify({ order_number: order.order_number }),
      });

      if (res.ok && res.data.conversation_id) {
        window.location.href = `/messages?conversation_id=${res.data.conversation_id}&order_number=${encodeURIComponent(order.order_number)}`;
      } else {
        setErrorMsg(res.data.error || 'Could not initiate chat with buyer.');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error opening chat thread.');
    } finally {
      setChattingOrderId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Total Orders</p>
          <p className="text-xl sm:text-2xl font-black mt-1" style={{ color: 'var(--text-primary)' }}>{stats.total}</p>
        </div>
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Needs Action</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xl sm:text-2xl font-black" style={{ color: stats.pending > 0 ? '#eab308' : 'var(--text-primary)' }}>
              {stats.pending}
            </p>
            {stats.pending > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500">
                Pending
              </span>
            )}
          </div>
        </div>
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>In Fulfillment</p>
          <p className="text-xl sm:text-2xl font-black mt-1" style={{ color: 'var(--text-primary)' }}>{stats.activeFulfillment}</p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}>
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-bold underline cursor-pointer">Dismiss</button>
        </div>
      )}

      {successNotice && (
        <div className="p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}>
          <span>{successNotice}</span>
          <button type="button" onClick={() => setSuccessNotice(null)} className="font-bold underline cursor-pointer">Dismiss</button>
        </div>
      )}

      {/* Filter, Search & View Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
          {(['all', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'] as OrderFilter[]).map((st) => {
            const count = st === 'all' ? orders.length : orders.filter((o) => o.status === st).length;
            const active = filter === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setFilter(st)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition flex items-center gap-1.5 border"
                style={
                  active
                    ? { background: 'var(--accent-strong)', borderColor: 'transparent', color: 'var(--text-on-accent, #000)' }
                    : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                }
              >
                <span>{st === 'all' ? 'All Orders' : st}</span>
                <span className="text-[10px] opacity-80">({count})</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 sm:w-60 min-w-[180px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order #, customer, item..."
              className="w-full px-3 py-1.5 pl-8 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={expandAll}
              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Expand all orders"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Collapse all orders"
            >
              Collapse All
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="p-2 rounded-xl border cursor-pointer transition hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Refresh Orders"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="p-12 text-center text-xs font-semibold rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
          Loading store orders...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <svg className="w-10 h-10 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>No orders found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {search ? 'Try adjusting your search query.' : 'When customers place orders in the store, they will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            // Default state is closed (false) as requested
            const isExpanded = expandedOrders[order.order_number] ?? false;
            const items = order.items || [];
            const itemCount = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
            const totalHuf = order.total_price_huf ?? order.total_huf ?? 0;
            const stStyle = STATUS_CONFIG[order.status] || STATUS_CONFIG.Pending;
            const tracking = trackingInputs[order.order_number]?.tracking ?? (order.tracking_number || '');
            const matchedCourier = findMatchingShippingMethod(
              (order as any).courier_name || order.customer_info?.shipping_mode || order.shipping_method,
              shippingMethods
            );
            const defaultCourier = (order as any).courier_name || matchedCourier || shippingMethods[0] || 'FoxPost Parcel Locker';
            const courier = trackingInputs[order.order_number]?.courier ?? defaultCourier;
            const courierOptions = Array.from(new Set([
              ...shippingMethods,
              ...((order as any).courier_name ? [(order as any).courier_name] : []),
              'Egyéb',
            ]));
            const isChatting = chattingOrderId === order.order_number;
            const isUpdating = updatingOrderId === order.order_number;

            // Structured Customer & Address Data Extraction
            const customerName = order.customer_info?.name || order.shipping_name || 'Customer';
            const customerEmail = order.customer_info?.email || (typeof order.notes === 'string' ? order.notes.match(/Email:\s*([^\s|]+)/i)?.[1] : null);
            const customerPhone = order.customer_info?.phone || (typeof order.notes === 'string' ? order.notes.match(/Phone:\s*([^\s|]+)/i)?.[1] : null);
            const customerNotes = order.customer_info?.user_notes || (typeof order.notes === 'string' ? (order.notes.match(/Notes:\s*(.*)/i)?.[1] || (!order.notes.includes('|') ? order.notes : null)) : null);

            // Shipping detailed address
            const shipPostalCode = order.customer_info?.shipping_postal_code;
            const shipCity = order.customer_info?.shipping_city;
            const shipStreet = order.customer_info?.shipping_street;
            const shipMode = order.customer_info?.shipping_mode || (order as any).courier_name || 'Standard Delivery';
            const shipLockerCode = order.customer_info?.shipping_locker_code;

            // Billing detailed address
            const billName = order.customer_info?.billing_name || customerName;
            const billTaxNumber = order.customer_info?.billing_tax_number;
            const billPostalCode = order.customer_info?.billing_postal_code || order.customer_info?.postal_code;
            const billCity = order.customer_info?.billing_city || order.customer_info?.city;
            const billStreet = order.customer_info?.billing_street || order.customer_info?.address;
            const billCountry = order.customer_info?.billing_country || 'Magyarország';

            return (
              <div
                key={order.order_number || order.id}
                className="rounded-2xl border overflow-hidden transition shadow-xs hover:border-[var(--border-hover)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                {/* Header Row (Summary visible in closed state) */}
                <div
                  className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none transition hover:bg-[var(--bg-raised)]"
                  style={{ background: isExpanded ? 'var(--bg-surface-2)' : 'var(--bg-surface)' }}
                  onClick={() => toggleExpand(order.order_number)}
                >
                  <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
                    <button
                      type="button"
                      className="p-1.5 rounded-lg border text-xs shrink-0 cursor-pointer"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      title={isExpanded ? 'Collapse order' : 'Expand order'}
                    >
                      <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {/* Order # with Copy button and highlightable text */}
                    <div
                      className="flex items-center gap-1.5 select-text shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className="text-xs sm:text-sm font-mono font-black select-text cursor-text"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        #{order.order_number}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(order.order_number);
                          setCopiedOrderNumber(order.order_number);
                          setSuccessNotice(`Order #${order.order_number} copied to clipboard.`);
                          setTimeout(() => setCopiedOrderNumber(null), 2000);
                        }}
                        className="p-1 rounded-md border text-[11px] transition cursor-pointer hover:bg-[var(--bg-raised)] active:scale-95 shrink-0"
                        style={{
                          background: 'var(--bg-input)',
                          borderColor: copiedOrderNumber === order.order_number ? 'var(--positive-border)' : 'var(--border)',
                          color: copiedOrderNumber === order.order_number ? 'var(--positive)' : 'var(--text-tertiary)',
                        }}
                        title="Copy order number"
                        aria-label="Copy order number"
                      >
                        {copiedOrderNumber === order.order_number ? (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Customer Full Name Prominently Visible */}
                    <span className="text-xs sm:text-sm font-bold truncate max-w-[200px]" style={{ color: 'var(--text-primary)' }}>
                      {customerName}
                    </span>

                    {/* Date */}
                    <span className="text-[11px] font-medium hidden md:inline shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(order.created_at).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>

                    {/* Item count */}
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border hidden sm:inline shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                      {itemCount} {itemCount === 1 ? 'termék' : 'termék'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* Status Badge */}
                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-bold border shrink-0"
                      style={{ background: stStyle.bg, color: stStyle.color, borderColor: stStyle.border }}
                    >
                      {stStyle.label || order.status}
                    </span>

                    {/* Total Price */}
                    <span className="text-xs sm:text-sm font-black px-2.5 py-1 rounded-xl border shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                      {formatPrice(totalHuf)}
                    </span>

                    {/* Message Buyer in Chat */}
                    <button
                      type="button"
                      disabled={isChatting}
                      onClick={() => handleStartChat(order)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition disabled:opacity-50 hover:border-[var(--accent)] shrink-0"
                      style={{
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent-border, var(--border))',
                        color: 'var(--text-accent, var(--text-primary))',
                      }}
                      title="Open two-way chat with the buyer about this order"
                    >
                      <svg className={`w-3.5 h-3.5 ${isChatting ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span>{isChatting ? 'Opening...' : 'Message Buyer'}</span>
                    </button>
                  </div>
                </div>

                {/* Expanded Details View */}
                {isExpanded && (
                  <div className="p-4 sm:p-6 border-t space-y-6" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                    {/* Multi-Section Customer, Delivery & Billing Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* 1. Customer Details */}
                      <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                              Vásárló adatai
                            </p>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                              Vevő
                            </span>
                          </div>

                          {/* Order Number Box with One-Click Copy */}
                          <div className="p-2 rounded-lg border flex items-center justify-between gap-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Rendelés azonosító
                              </p>
                              <p className="text-xs font-mono font-black select-text cursor-text truncate" style={{ color: 'var(--text-primary)' }}>
                                #{order.order_number}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(order.order_number);
                                setCopiedOrderNumber(order.order_number);
                                setSuccessNotice(`Order #${order.order_number} copied to clipboard.`);
                                setTimeout(() => setCopiedOrderNumber(null), 2000);
                              }}
                              className="px-2 py-1 rounded-md border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)] active:scale-95 inline-flex items-center gap-1 shrink-0"
                              style={{
                                background: 'var(--bg-input)',
                                borderColor: copiedOrderNumber === order.order_number ? 'var(--positive-border)' : 'var(--border)',
                                color: copiedOrderNumber === order.order_number ? 'var(--positive)' : 'var(--text-primary)',
                              }}
                              title="Rendelésszám másolása (Copy order number)"
                            >
                              {copiedOrderNumber === order.order_number ? (
                                <>
                                  <svg className="w-3.5 h-3.5 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  <span>Másolva</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                  <span>Másolás</span>
                                </>
                              )}
                            </button>
                          </div>

                          <div>
                            <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Teljes név</p>
                            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{customerName}</p>
                          </div>

                          {customerEmail && (
                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>E-mail cím</p>
                              <a href={`mailto:${customerEmail}`} className="text-xs font-medium hover:underline break-all" style={{ color: 'var(--text-accent)' }}>
                                {customerEmail}
                              </a>
                            </div>
                          )}

                          {customerPhone && (
                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Telefonszám</p>
                              <a href={`tel:${customerPhone}`} className="text-xs font-mono font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                                {customerPhone}
                              </a>
                            </div>
                          )}

                          <div>
                            <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Fiók azonosító</p>
                            <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{order.user_id}</p>
                          </div>
                        </div>

                        {customerNotes && (
                          <div className="mt-3 pt-2.5 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Megjegyzés</p>
                            <p className="italic leading-relaxed p-2 rounded-lg border text-[11px]" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                              "{customerNotes}"
                            </p>
                          </div>
                        )}
                      </div>

                      {/* 2. Shipping Detailed Address */}
                      <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                              Szállítási cím
                            </p>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-accent)' }}>
                              {shipMode}
                            </span>
                          </div>

                          <div>
                            <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Címzett</p>
                            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{order.shipping_name || customerName}</p>
                          </div>

                          {(shipPostalCode || shipCity) ? (
                            <div className="space-y-1">
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Irányítószám & Település</p>
                                <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                  {shipPostalCode} {shipCity}
                                </p>
                              </div>
                              {shipStreet && (
                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Utca, házszám / Helyszín</p>
                                  <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                    {shipStreet}
                                  </p>
                                </div>
                              )}
                              {shipLockerCode && (
                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Automata azonosító</p>
                                  <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border inline-block" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}>
                                    {shipLockerCode}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Cím adatok</p>
                              <p className="text-xs font-medium leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>
                                {order.shipping_address || 'Nincs megadva'}
                              </p>
                            </div>
                          )}
                        </div>

                        {order.tracking_number && (
                          <div className="mt-3 pt-2.5 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Csomagkövetés</p>
                            <p className="font-mono text-xs font-bold" style={{ color: 'var(--text-accent)' }}>
                              {order.courier_name ? `${order.courier_name}: ` : ''}{order.tracking_number}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* 3. Billing Detailed Address */}
                      <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                              Számlázási cím
                            </p>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                              Számla
                            </span>
                          </div>

                          <div>
                            <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Számlázási név</p>
                            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{billName}</p>
                          </div>

                          {billTaxNumber && (
                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Adószám (Céges)</p>
                              <p className="text-xs font-mono font-bold" style={{ color: 'var(--text-accent)' }}>{billTaxNumber}</p>
                            </div>
                          )}

                          {(billPostalCode || billCity) ? (
                            <div className="space-y-1">
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Irányítószám & Település</p>
                                <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                  {billPostalCode} {billCity}
                                </p>
                              </div>
                              {billStreet && (
                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Utca, házszám</p>
                                  <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                    {billStreet}
                                  </p>
                                </div>
                              )}
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Ország</p>
                                <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                  {billCountry}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Cím adatok</p>
                              <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {order.shipping_address ? 'Megegyezik a szállítási címmel' : 'Magánszemély számlázási cím'}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Payment & Invoice summary */}
                        <div className="mt-3 pt-2.5 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                          <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Fizetés</p>
                          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            Mód: <span className="font-bold">{order.payment_method === 'stripe' ? 'Bankkártya (Stripe)' : (order.payment_method === 'bank_transfer' ? 'Banki átutalás' : (order.payment_method || 'Banki átutalás'))}</span>
                          </p>
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                            Állapot: <span className="font-bold">
                              {(order.payment_status === 'paid' || String(order.payment_status) === 'completed') ? 'Fizetve' : 'Fizetésre vár'}
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Ordered Items Table */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                          Rendelt termékek ({itemCount})
                        </p>
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                          Hivatalos Store készletből
                        </span>
                      </div>

                      <div className="border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                          {items.map((item, idx) => (
                            <div key={idx} className="p-3.5 flex items-center justify-between gap-4 text-xs" style={{ background: 'var(--bg-surface)' }}>
                              <div className="flex items-center gap-3.5 min-w-0">
                                {item.image_path ? (
                                  <img
                                    src={item.image_path}
                                    alt={item.card_name}
                                    className="w-12 h-12 object-contain rounded-xl border shrink-0 p-0.5"
                                    style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                                  />
                                ) : (
                                  <div
                                    className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
                                    style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                                  >
                                    <svg className="w-5 h-5 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                    </svg>
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.card_name}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                                    {item.card_number && <span>SKU: {item.card_number}</span>}
                                    {item.set_name && <span>· {item.set_name}</span>}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                                  {formatPrice((item.price_huf || 0) * (item.quantity || 1))}
                                </p>
                                <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                                  {item.quantity || 1} × {formatPrice(item.price_huf || 0)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Price Breakdown Footer */}
                        <div className="p-3.5 border-t flex flex-col items-end gap-1 text-xs" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                          <div className="flex justify-between w-48 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            <span>Részösszeg:</span>
                            <span className="font-semibold text-right" style={{ color: 'var(--text-secondary)' }}>
                              {formatPrice(items.reduce((sum, i) => sum + (i.price_huf || 0) * (i.quantity || 1), 0))}
                            </span>
                          </div>
                          <div className="flex justify-between w-48 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            <span>Szállítás:</span>
                            <span className="font-semibold text-right" style={{ color: 'var(--text-secondary)' }}>
                              {order.shipping_huf !== undefined ? (order.shipping_huf === 0 ? 'Ingyenes' : formatPrice(order.shipping_huf)) : 'Belefoglalva'}
                            </span>
                          </div>
                          <div className="flex justify-between w-48 text-sm font-black pt-1 border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
                            <span>Végösszeg:</span>
                            <span className="text-[var(--positive)]">{formatPrice(totalHuf)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Order Fulfillment & Status Controls */}
                    <div className="pt-4 border-t flex flex-wrap items-center justify-between gap-4 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                      {/* Tracking number and Courier fields */}
                      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[300px]">
                        <select
                          value={courier}
                          onChange={(e) =>
                            setTrackingInputs((prev) => ({
                              ...prev,
                              [order.order_number]: {
                                courier: e.target.value,
                                tracking: prev[order.order_number]?.tracking ?? (order.tracking_number || ''),
                              },
                            }))
                          }
                          className="px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          {courierOptions.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>

                        <input
                          type="text"
                          value={tracking}
                          placeholder="Csomagkövetési szám (pl. FOX-HU-...)"
                          onChange={(e) =>
                            setTrackingInputs((prev) => ({
                              ...prev,
                              [order.order_number]: {
                                tracking: e.target.value,
                                courier: prev[order.order_number]?.courier ?? ((order as any).courier_name || 'Foxpost'),
                              },
                            }))
                          }
                          className="px-3 py-2 rounded-xl border text-xs font-mono flex-1 min-w-[180px] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        />

                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => handleSaveTracking(order)}
                          className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:bg-[var(--bg-raised)] disabled:opacity-50 inline-flex items-center gap-1.5"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>{isUpdating ? 'Mentés...' : 'Követés mentése'}</span>
                        </button>
                      </div>

                      {/* Status Update Dropdown */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>Státusz:</span>
                        <select
                          value={order.status}
                          disabled={isUpdating}
                          onChange={(e) => handleUpdateStatus(order, e.target.value)}
                          className="px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          <option value="Pending">Pending (Függőben)</option>
                          <option value="Processing">Processing (Feldolgozás alatt)</option>
                          <option value="Shipped">Shipped (Feladva / Úton)</option>
                          <option value="Delivered">Delivered (Kézbesítve)</option>
                          <option value="Cancelled">Cancelled (Törölve)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
