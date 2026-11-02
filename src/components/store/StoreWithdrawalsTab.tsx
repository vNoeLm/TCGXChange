import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../lib/i18n';

export interface StoreWithdrawal {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  order_date: string;
  items_summary: string;
  bank_account: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'refunded';
  admin_notes: string | null;
  created_at: string;
  updated_at?: string;
}

interface StoreWithdrawalsTabProps {
  withdrawals: StoreWithdrawal[];
  loading: boolean;
  onRefresh: () => void;
  onUpdateStatus: (id: string, status: StoreWithdrawal['status'], adminNotes?: string) => Promise<void>;
  updatingId: string | null;
}

const STATUS_BADGES: Record<StoreWithdrawal['status'], { label: string; bg: string; color: string; border: string }> = {
  pending: { label: 'Pending', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.4)' },
  approved: { label: 'Approved', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.4)' },
  refunded: { label: 'Refunded', bg: 'var(--positive-muted)', color: 'var(--positive)', border: 'var(--positive-border)' },
  rejected: { label: 'Rejected', bg: 'var(--negative-muted)', color: 'var(--negative)', border: 'var(--negative-border)' },
};

export function StoreWithdrawalsTab({
  withdrawals,
  loading,
  onRefresh,
  onUpdateStatus,
  updatingId,
}: StoreWithdrawalsTabProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StoreWithdrawal['status']>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedNotesId, setExpandedNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const stats = useMemo(() => {
    return {
      total: withdrawals.length,
      pending: withdrawals.filter((w) => w.status === 'pending').length,
      approved: withdrawals.filter((w) => w.status === 'approved').length,
      refunded: withdrawals.filter((w) => w.status === 'refunded').length,
    };
  }, [withdrawals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withdrawals.filter((w) => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false;
      if (!q) return true;
      return (
        w.order_number.toLowerCase().includes(q) ||
        w.customer_name.toLowerCase().includes(q) ||
        w.customer_email.toLowerCase().includes(q) ||
        w.bank_account.toLowerCase().includes(q) ||
        w.items_summary.toLowerCase().includes(q)
      );
    });
  }, [withdrawals, search, statusFilter]);

  const handleCopyIban = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStartEditNotes = (w: StoreWithdrawal) => {
    setExpandedNotesId(w.id);
    setNotesDraft(w.admin_notes || '');
  };

  const handleSaveNotes = async (w: StoreWithdrawal) => {
    await onUpdateStatus(w.id, w.status, notesDraft);
    setExpandedNotesId(null);
  };

  return (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Total Requests', 'Összes kérelem')}</div>
          <div className="text-2xl font-black mt-1" style={{ color: 'var(--text-primary)' }}>{stats.total}</div>
        </div>
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold" style={{ color: '#f59e0b' }}>{t('Pending Review', 'Ellenőrzésre vár')}</div>
          <div className="text-2xl font-black mt-1" style={{ color: '#f59e0b' }}>{stats.pending}</div>
        </div>
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold" style={{ color: '#3b82f6' }}>{t('Approved / Returning', 'Jóváhagyva / Visszaküldés')}</div>
          <div className="text-2xl font-black mt-1" style={{ color: '#3b82f6' }}>{stats.approved}</div>
        </div>
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold" style={{ color: 'var(--positive)' }}>{t('Refunded', 'Visszatérítve')}</div>
          <div className="text-2xl font-black mt-1" style={{ color: 'var(--positive)' }}>{stats.refunded}</div>
        </div>
      </div>

      {/* Toolbar: Search, Filters, Refresh */}
      <div className="p-3 sm:p-4 rounded-2xl border space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <svg
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-tertiary)' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Search order #, customer, email, IBAN…', 'Keresés rendelésszám, vevő, email, IBAN…')}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title={t('Refresh withdrawal requests', 'Elállási kérelmek frissítése')}
              className="px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)] transition inline-flex items-center gap-1.5"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span>{t('Refresh', 'Frissítés')}</span>
            </button>
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {(['all', 'pending', 'approved', 'refunded', 'rejected'] as const).map((s) => {
            const active = statusFilter === s;
            const count = s === 'all' ? withdrawals.length : withdrawals.filter((w) => w.status === s).length;
            const label = s === 'all' ? t('All', 'Mind') : s === 'pending' ? t('Pending', 'Függőben') : s === 'approved' ? t('Approved', 'Jóváhagyva') : s === 'refunded' ? t('Refunded', 'Visszatérítve') : t('Rejected', 'Elutasítva');
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer shrink-0 flex items-center gap-1.5"
                style={
                  active
                    ? { background: 'var(--accent-strong)', borderColor: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                    : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                }
              >
                <span>{label}</span>
                <span className="text-[10px] opacity-80">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Withdrawals List */}
      {loading && withdrawals.length === 0 ? (
        <div className="p-12 text-center text-xs font-semibold animate-pulse" style={{ color: 'var(--text-muted)' }}>
          {t('Loading withdrawal requests…', 'Elállási kérelmek betöltése…')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-2xl border text-center space-y-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="w-10 h-10 rounded-full mx-auto flex items-center justify-center border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('No withdrawal requests found', 'Nem található elállási kérelem')}
          </div>
          <div className="text-xs max-w-sm mx-auto" style={{ color: 'var(--text-tertiary)' }}>
            {withdrawals.length === 0
              ? t('When buyers submit a statutory 14-day withdrawal form on the site, their notices will appear here.', 'Amikor a vásárlók beküldik a törvényes 14 napos elállási nyilatkozatot, azok itt jelennek meg.')
              : t('No withdrawal requests match your current search or filter.', 'Nincs a keresésnek vagy szűrőnek megfelelő elállási kérelem.')}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((w) => {
            const badge = STATUS_BADGES[w.status] || STATUS_BADGES.pending;
            const isUpdating = updatingId === w.id;
            const isEditingNotes = expandedNotesId === w.id;
            const isCopied = copiedId === w.id;

            return (
              <div
                key={w.id}
                className="rounded-2xl border p-4 sm:p-5 transition shadow-xs space-y-3"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                {/* Header row: Order #, Date, Status badge */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>
                      #{w.order_number}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap"
                      style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}
                    >
                      {w.status === 'pending' ? t('Pending', 'Függőben') : w.status === 'approved' ? t('Approved', 'Jóváhagyva') : w.status === 'refunded' ? t('Refunded', 'Visszatérítve') : t('Rejected', 'Elutasítva')}
                    </span>
                  </div>

                  <div className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Submitted:', 'Beküldve:')} {new Date(w.created_at).toLocaleString('hu-HU', { hour12: false })}
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Left Column: Customer & Dates */}
                  <div className="space-y-2">
                    <div>
                      <span className="font-bold block" style={{ color: 'var(--text-primary)' }}>
                        {w.customer_name}
                      </span>
                      <div className="flex items-center gap-3 mt-0.5 text-xs">
                        <a
                          href={`mailto:${w.customer_email}`}
                          className="hover:underline flex items-center gap-1 font-semibold"
                          style={{ color: 'var(--text-accent)' }}
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                            <polyline points="22,6 12,13 2,6" />
                          </svg>
                          <span>{w.customer_email}</span>
                        </a>
                        {w.customer_phone && (
                          <a
                            href={`tel:${w.customer_phone}`}
                            className="hover:underline flex items-center gap-1"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                            <span>{w.customer_phone}</span>
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                      <span className="text-[10px] font-bold uppercase tracking-wider block mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {t('Delivery / Order Date', 'Kézbesítés / Rendelés dátuma')}
                      </span>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {w.order_date}
                      </span>
                    </div>

                    {/* Refund IBAN with copy button */}
                    <div className="p-2.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                          {t('Refund Bank Account (IBAN)', 'Visszatérítési bankszámla (IBAN)')}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyIban(w.id, w.bank_account)}
                          className="px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer hover:bg-[var(--bg-raised)] transition inline-flex items-center gap-1"
                          style={{ borderColor: 'var(--border)', color: isCopied ? 'var(--positive)' : 'var(--text-secondary)' }}
                        >
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          <span>{isCopied ? t('Copied!', 'Másolva!') : t('Copy IBAN', 'IBAN másolása')}</span>
                        </button>
                      </div>
                      <code className="text-xs font-mono font-bold select-all block break-all" style={{ color: 'var(--text-primary)' }}>
                        {w.bank_account}
                      </code>
                    </div>
                  </div>

                  {/* Right Column: Items and Reasons */}
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl border space-y-1" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                      <span className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-tertiary)' }}>
                        {t('Returned Items Summary', 'Visszaküldött tételek összesítője')}
                      </span>
                      <div className="whitespace-pre-wrap leading-relaxed font-medium" style={{ color: 'var(--text-primary)' }}>
                        {w.items_summary}
                      </div>
                    </div>

                    {w.reason && (
                      <div className="p-3 rounded-xl border space-y-1" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                        <span className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-tertiary)' }}>
                          {t('Customer Reason (Optional)', 'Vásárlói indoklás (opcionális)')}
                        </span>
                        <div className="italic" style={{ color: 'var(--text-secondary)' }}>
                          "{w.reason}"
                        </div>
                      </div>
                    )}

                    {w.admin_notes && !isEditingNotes && (
                      <div className="p-3 rounded-xl border space-y-1" style={{ background: 'rgba(234,179,8,0.06)', borderColor: 'rgba(234,179,8,0.25)' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#eab308' }}>
                            {t('Internal Admin Notes', 'Belső admin jegyzetek')}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleStartEditNotes(w)}
                            className="text-[10px] font-bold hover:underline cursor-pointer"
                            style={{ color: '#eab308' }}
                          >
                            {t('Edit', 'Szerkesztés')}
                          </button>
                        </div>
                        <div className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                          {w.admin_notes}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline Notes Editor */}
                {isEditingNotes && (
                  <div className="p-3 rounded-xl border space-y-2" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                    <label className="text-[11px] font-bold block" style={{ color: 'var(--text-primary)' }}>
                      {t('Edit Internal Admin Notes', 'Belső admin jegyzetek szerkesztése')}
                    </label>
                    <textarea
                      rows={2}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder={t('e.g. Package received on Oct 24, parcel checked intact, refund wired.', 'pl. Csomag beérkezett, sértetlen, visszautalva.')}
                      className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] resize-none"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedNotesId(null)}
                        className="px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer hover:bg-[var(--bg-raised)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        {t('Cancel', 'Mégse')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveNotes(w)}
                        disabled={isUpdating}
                        className="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {t('Save Notes', 'Jegyzet mentése')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Buttons row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {!w.admin_notes && !isEditingNotes && (
                      <button
                        type="button"
                        onClick={() => handleStartEditNotes(w)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer hover:bg-[var(--bg-raised)] transition inline-flex items-center gap-1"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>{t('Add Notes', 'Jegyzet hozzáadása')}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {w.status !== 'approved' && w.status !== 'refunded' && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => onUpdateStatus(w.id, 'approved')}
                        className="px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer hover:brightness-110 transition shadow-xs"
                        style={{ background: 'rgba(59, 130, 246, 0.18)', color: '#3b82f6', borderColor: 'rgba(59, 130, 246, 0.45)' }}
                      >
                        {t('Approve Return', 'Visszaküldés jóváhagyása')}
                      </button>
                    )}

                    {w.status !== 'refunded' && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => onUpdateStatus(w.id, 'refunded')}
                        className="px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer hover:brightness-110 transition shadow-xs"
                        style={{ background: 'var(--positive-muted)', color: 'var(--positive)', borderColor: 'var(--positive-border)' }}
                      >
                        {t('Mark Refunded', 'Visszatérítve')}
                      </button>
                    )}

                    {w.status !== 'rejected' && w.status !== 'refunded' && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => onUpdateStatus(w.id, 'rejected')}
                        className="px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer hover:bg-red-500/15 transition text-red-400 border-red-500/30"
                      >
                        {t('Reject', 'Elutasítás')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
