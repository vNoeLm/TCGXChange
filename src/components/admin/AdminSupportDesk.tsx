import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase, cardThumbProps, getCardImageUrl } from '../../lib/supabase';
import {
  consolidateConversationMessages,
  localizeNoticeBody,
  CHAT_IMAGE_EXPIRY_DAYS,
} from '../../lib/messages';
import { subscribeUserRealtime } from '../../lib/realtimeClient';
import { useLanguage } from '../../lib/i18n';
import { getProfileUrl } from '../../lib/profileUrl';
import { ImageViewer } from '../CardImageViewer';
import type { ChatMessage, Order } from '../../types';

interface SupportConversationSummary {
  conversation_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_avatar: string | null;
  customer_is_team: boolean;
  has_orders: boolean;
  order_count: number;
  latest_order_number: string | null;
  label: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

interface AdminSupportDeskProps {
  currentAdminId?: string | null;
  initialConversationId?: string | null;
  onUnreadCountChange?: (count: number) => void;
  onOpenStoreOrders?: (orderNumber?: string) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayHeader(iso: string, lang: string = 'hu'): string {
  const d = new Date(iso);
  if (lang === 'en') {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  return d.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
}

function formatMessageTime(iso: string, lang: string = 'hu'): string {
  const d = new Date(iso);
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return `${timeStr} · ${lang === 'hu' ? 'épp most' : 'just now'}`;
  if (mins < 60) return `${timeStr} · ${lang === 'hu' ? `${mins} perce` : `${mins}m ago`}`;
  return timeStr;
}

function formatSidebarTime(iso: string | null | undefined, lang: string = 'hu'): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return lang === 'hu' ? 'Tegnap' : 'Yesterday';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) {
    return d.toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-GB', { weekday: 'short' });
  }
  return d.toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-GB', { day: 'numeric', month: 'short' });
}

function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function storeStatusBadge(status?: string) {
  switch (status) {
    case 'Delivered':
      return { bg: 'rgba(16, 185, 129, 0.14)', border: 'rgba(16, 185, 129, 0.35)', text: '#34d399' };
    case 'Shipped':
      return { bg: 'rgba(168, 85, 247, 0.14)', border: 'rgba(168, 85, 247, 0.35)', text: '#c084fc' };
    case 'Cancelled':
      return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(239, 68, 68, 0.35)', text: '#f87171' };
    default:
      return { bg: 'rgba(59, 130, 246, 0.14)', border: 'rgba(59, 130, 246, 0.35)', text: '#60a5fa' };
  }
}

export function AdminSupportDesk({
  currentAdminId,
  initialConversationId,
  onUnreadCountChange,
  onOpenStoreOrders,
}: AdminSupportDeskProps) {
  const { t, lang } = useLanguage();
  const [conversations, setConversations] = useState<SupportConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadOrders, setThreadOrders] = useState<Order[]>([]);
  const [threadHolds, setThreadHolds] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);

  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'orders'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [imageViewerState, setImageViewerState] = useState<{
    isOpen: boolean;
    src: string;
    name: string;
    gallery?: string[];
    index?: number;
  }>({ isOpen: false, src: '', name: '' });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  };

  const fetchSupportData = useCallback(async (convId?: string | null, silent: boolean = false) => {
    if (!silent) {
      if (convId) setLoadingThread(true);
      else setLoadingList(true);
    }
    try {
      const token = await getToken();
      if (!token) return;
      const qs = convId ? `?conversation_id=${encodeURIComponent(convId)}` : '';
      const res = await fetch(`/api/admin/support-chats${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        if (!silent) setErrorMsg(json?.error || `Error ${res.status}`);
        return;
      }

      const list: SupportConversationSummary[] = json.conversations || [];
      setConversations(list);
      if (onUnreadCountChange) {
        onUnreadCountChange(Number(json.totalUnread || 0));
      }

      if (convId) {
        setMessages(json.messages || []);
        setThreadOrders(json.threadOrders || []);
        setThreadHolds(json.threadHolds || []);
      } else if (!selectedIdRef.current && list.length > 0) {
        setSelectedId(list[0].conversation_id);
      }
    } catch (e: any) {
      if (!silent) setErrorMsg(e?.message || 'Failed to load support chats.');
    } finally {
      setLoadingList(false);
      setLoadingThread(false);
    }
  }, [onUnreadCountChange]);

  useEffect(() => {
    fetchSupportData(initialConversationId || null);
  }, [initialConversationId, fetchSupportData]);

  useEffect(() => {
    if (selectedId) {
      fetchSupportData(selectedId);
    } else {
      setMessages([]);
      setThreadOrders([]);
      setThreadHolds([]);
    }
  }, [selectedId, fetchSupportData]);

  useEffect(() => {
    if (!currentAdminId) return;
    const unsub = subscribeUserRealtime(currentAdminId, (evt) => {
      if (evt.type === 'chat_message' || evt.type === 'system_notice') {
        const activeId = selectedIdRef.current;
        if (activeId && evt.conversation_id === activeId) {
          void fetchSupportData(activeId, true);
        } else {
          void fetchSupportData(null, true);
        }
      }
    });
    return () => {
      unsub();
    };
  }, [currentAdminId, fetchSupportData]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchSupportData(selectedIdRef.current, true);
      }
    }, 20000);
    return () => window.clearInterval(id);
  }, [fetchSupportData]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, selectedId]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (filterMode === 'unread' && c.unread_count === 0) return false;
      if (filterMode === 'orders' && !c.has_orders) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.customer_name.toLowerCase().includes(q) ||
        (c.customer_email || '').toLowerCase().includes(q) ||
        (c.latest_order_number || '').toLowerCase().includes(q) ||
        (c.last_message || '').toLowerCase().includes(q)
      );
    });
  }, [conversations, filterMode, searchQuery]);

  const selected = useMemo(
    () => conversations.find((c) => c.conversation_id === selectedId) || null,
    [conversations, selectedId]
  );

  const visibleMessages = useMemo(
    () => consolidateConversationMessages(messages, { threadHolds, threadOrders }),
    [messages, threadHolds, threadOrders]
  );

  const ordersByNumber = useMemo(() => {
    const m = new Map<string, Order>();
    threadOrders.forEach((o) => {
      if (o?.order_number) m.set(o.order_number, o);
    });
    return m;
  }, [threadOrders]);

  const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    const next: Array<{ file: File; previewUrl: string }> = [];
    for (const f of picked) {
      if (!f.type.startsWith('image/')) continue;
      if (pendingFiles.length + next.length >= 4) break;
      next.push({ file: f, previewUrl: URL.createObjectURL(f) });
    }
    if (next.length > 0) setPendingFiles((prev) => [...prev, ...next]);
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedId || sending || uploadingImage) return;
    const text = draft.trim();
    if (!text && pendingFiles.length === 0) return;

    setErrorMsg(null);
    setSending(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Session expired — please sign in again.');

      const uploadedImages: Array<{ url: string; path?: string; expires_at?: string }> = [];
      if (pendingFiles.length > 0) {
        setUploadingImage(true);
        const expiresAt = new Date(Date.now() + CHAT_IMAGE_EXPIRY_DAYS * 86400000).toISOString();
        for (const item of pendingFiles) {
          const formData = new FormData();
          formData.append('conversation_id', selectedId);
          formData.append('file', item.file);
          const upRes = await fetch('/api/messages/upload-image', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          const upJson = await upRes.json().catch(() => null);
          if (!upRes.ok || !upJson?.url) {
            throw new Error(upJson?.error || 'Failed to upload image attachment.');
          }
          uploadedImages.push({ url: upJson.url, path: upJson.path, expires_at: expiresAt });
        }
        setUploadingImage(false);
      }

      const res = await fetch('/api/admin/support-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conversation_id: selectedId,
          body: text,
          metadata: uploadedImages.length > 0 ? { images: uploadedImages } : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Error ${res.status}`);
      }

      pendingFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      setPendingFiles([]);
      setDraft('');
      setMessages((prev) => [...prev, json.message]);
      void fetchSupportData(selectedId, true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to send reply.');
    } finally {
      setUploadingImage(false);
      setSending(false);
    }
  };

  const renderOrderCard = (m: ChatMessage, fullTimestamp: string) => {
    const meta = m.metadata || {};
    if (meta.store_order) {
      const orderNum = meta.order_number || '';
      const linkedOrder = orderNum ? ordersByNumber.get(orderNum) : undefined;
      const liveStatus = linkedOrder?.status || meta.status || 'Pending';
      const badge = storeStatusBadge(liveStatus);
      const storeItems = Array.isArray(meta.items) && meta.items.length > 0
        ? meta.items
        : Array.isArray(linkedOrder?.items)
        ? linkedOrder!.items
        : [];
      const totalHuf = linkedOrder?.total_price_huf ?? linkedOrder?.total_huf ?? meta.total_price_huf ?? 0;

      return (
        <div className="flex justify-center my-2">
          <div
            className="w-full max-w-md rounded-2xl border p-4 shadow-md"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-2 pb-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                  {t('Official Store Order', 'Hivatalos Webshop Rendelés')}
                </div>
                <div className="text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                  #{orderNum}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="px-2 py-0.5 rounded-md text-[10px] font-extrabold border"
                  style={{ background: badge.bg, borderColor: badge.border, color: badge.text }}
                >
                  {liveStatus}
                </span>
              </div>
            </div>

            {storeItems.length > 0 && (
              <div className="py-2.5 space-y-1.5">
                {storeItems.slice(0, 4).map((it: any, i: number) => {
                  const img = it.image || it.image_path;
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {img && (
                          <img
                            {...cardThumbProps(getCardImageUrl(img))}
                            alt={it.name || it.card_name || ''}
                            className="w-6 h-8 rounded object-cover shrink-0 border"
                            style={{ borderColor: 'var(--border)' }}
                          />
                        )}
                        <span className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {it.quantity || 1}x {it.name || it.card_name || 'Item'}
                        </span>
                      </div>
                      <span className="font-bold shrink-0 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {Number((it.price_huf || 0) * (it.quantity || 1)).toLocaleString('hu-HU')} Ft
                      </span>
                    </div>
                  );
                })}
                {storeItems.length > 4 && (
                  <div className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                    +{storeItems.length - 4} {t('more items', 'további tétel')}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2.5 border-t flex items-center justify-between gap-2 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <span className="font-black" style={{ color: 'var(--text-primary)' }}>
                  {Number(totalHuf).toLocaleString('hu-HU')} Ft
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }} title={fullTimestamp}>
                  {formatMessageTime(m.created_at, lang)}
                </span>
              </div>
              {onOpenStoreOrders && (
                <button
                  type="button"
                  onClick={() => onOpenStoreOrders(orderNum)}
                  className="text-[11px] font-bold hover:underline cursor-pointer"
                  style={{ color: 'var(--text-accent)' }}
                >
                  {t('Manage Order', 'Rendelés kezelése')} →
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-center my-2">
        <div
          className="max-w-md px-3.5 py-2 rounded-xl border text-xs text-center"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          {localizeNoticeBody(m.body || '', lang)}
        </div>
      </div>
    );
  };

  return (
    <div
      className="rounded-2xl border overflow-hidden grid grid-cols-1 md:grid-cols-[330px_1fr] min-h-[580px] h-[calc(100vh-260px)] max-h-[820px]"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      {/* LEFT PANE: Shared Customer Support Queue */}
      <aside
        className={`flex flex-col border-b md:border-b-0 md:border-r min-h-0 ${selectedId ? 'hidden md:flex' : 'flex'}`}
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="p-3.5 border-b space-y-2.5 shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                {t('Customer Support Queue', 'Ügyfélszolgálati megkeresések')}
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {t('Shared across all site admins', 'Minden admin közösen látja')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchSupportData(selectedId)}
              className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition hover:opacity-80"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title={t('Refresh', 'Frissítés')}
            >
              <svg className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Search customer, order #, or message…', 'Keresés vásárló, rendelés vagy szöveg alapján…')}
            className="w-full h-9 px-3 rounded-xl border text-xs outline-none"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />

          <div className="flex gap-1.5">
            {([
              { id: 'all', label: t('All', 'Mind'), count: conversations.length },
              { id: 'unread', label: t('Unread', 'Olvasatlan'), count: conversations.filter((c) => c.unread_count > 0).length },
              { id: 'orders', label: t('Orders', 'Rendelések'), count: conversations.filter((c) => c.has_orders).length },
            ] as const).map((tab) => {
              const active = filterMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterMode(tab.id)}
                  className="flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer"
                  style={
                    active
                      ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                      : { background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                  }
                >
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y min-h-0" style={{ borderColor: 'var(--border-subtle)' }}>
          {loadingList && conversations.length === 0 ? (
            <div className="p-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('Loading support threads…', 'Megkeresések betöltése…')}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('No matching customer threads.', 'Nincs találat a megkeresések között.')}
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = c.conversation_id === selectedId;
              return (
                <button
                  key={c.conversation_id}
                  type="button"
                  onClick={() => setSelectedId(c.conversation_id)}
                  className="w-full p-3.5 text-left transition cursor-pointer flex items-start gap-3 hover:opacity-95"
                  style={{
                    background: isSelected ? 'var(--accent-muted)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--accent-strong)' : '3px solid transparent',
                  }}
                >
                  {c.customer_avatar ? (
                    <img
                      src={c.customer_avatar}
                      alt={c.customer_name}
                      className="w-10 h-10 rounded-xl object-cover border shrink-0"
                      style={{ borderColor: 'var(--border)' }}
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-xl border flex items-center justify-center font-black text-xs shrink-0"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}
                    >
                      {getInitials(c.customer_name)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold truncate" style={{ color: 'var(--text-primary)' }}>
                        {c.customer_name}
                      </span>
                      <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                        {formatSidebarTime(c.last_message_at, lang)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-accent)' }}>
                        {c.label}
                      </span>
                      {c.unread_count > 0 && (
                        <span
                          className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-black shrink-0"
                          style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                        >
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {c.last_message || t('No messages yet', 'Nincs még üzenet')}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* RIGHT PANE: Thread + Customer Order Context */}
      <section className={`flex flex-col min-h-0 ${!selectedId ? 'hidden md:flex' : 'flex'}`}>
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div
              className="w-12 h-12 rounded-2xl border flex items-center justify-center mb-3"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
              {t('Select a customer inquiry', 'Válassz egy vásárlói beszélgetést')}
            </div>
            <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--text-tertiary)' }}>
              {t('All store admins share access to this support inbox and can reply on behalf of TCGXChange.', 'Minden admin ugyanehhez az ügyfélszolgálati fiókhoz fér hozzá, és a TCGXChange nevében válaszolhat.')}
            </p>
          </div>
        ) : (
          <>
            {/* Thread Header */}
            <div
              className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap shrink-0"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="md:hidden w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  ←
                </button>
                {selected.customer_avatar ? (
                  <img
                    src={selected.customer_avatar}
                    alt={selected.customer_name}
                    className="w-9 h-9 rounded-xl object-cover border shrink-0"
                    style={{ borderColor: 'var(--border)' }}
                  />
                ) : (
                  <div
                    className="w-9 h-9 rounded-xl border flex items-center justify-center font-black text-xs shrink-0"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}
                  >
                    {getInitials(selected.customer_name)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={getProfileUrl({ id: selected.customer_id, display_name: selected.customer_name })}
                      className="text-sm font-black hover:underline truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {selected.customer_name}
                    </a>
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      {selected.customer_is_team ? t('Team Buyer', 'Csapattag (Vásárló)') : t('Customer', 'Vásárló')}
                    </span>
                  </div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {selected.customer_email || selected.label}
                    {threadOrders.length > 0 ? ` · ${threadOrders.length} ${t('store orders', 'bolti rendelés')}` : ''}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {onOpenStoreOrders && (
                  <button
                    type="button"
                    onClick={() => onOpenStoreOrders(threadOrders[0]?.order_number)}
                    className="h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer transition hover:opacity-90"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    {t('Store Orders', 'Bolti rendelések')}
                  </button>
                )}
              </div>
            </div>

            {/* Quick Customer Orders Strip */}
            {threadOrders.length > 0 && (
              <div
                className="px-4 py-2 border-b flex items-center gap-2 overflow-x-auto shrink-0"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Orders:', 'Rendelések:')}
                </span>
                {threadOrders.slice(0, 5).map((o) => {
                  const badge = storeStatusBadge(o.status);
                  return (
                    <button
                      key={o.order_number}
                      type="button"
                      onClick={() => onOpenStoreOrders?.(o.order_number)}
                      className="px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer hover:opacity-85"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <span className="font-mono">#{o.order_number}</span>
                      <span style={{ color: badge.text }}>{o.status}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Message Feed */}
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {loadingThread && visibleMessages.length === 0 ? (
                <div className="text-center text-xs py-10" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Loading thread…', 'Üzenetek betöltése…')}
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="text-center text-xs py-12" style={{ color: 'var(--text-tertiary)' }}>
                  {t('No messages yet in this thread.', 'Még nincsenek üzenetek ebben a beszélgetésben.')}
                </div>
              ) : (
                visibleMessages.map((m, idx) => {
                  const prev = idx > 0 ? visibleMessages[idx - 1] : null;
                  const showDaySeparator = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
                  const fullTimestamp = new Date(m.created_at).toLocaleString('en-GB', { hour12: false });

                  if (m.message_type === 'system') {
                    return (
                      <React.Fragment key={m.id}>
                        {showDaySeparator && (
                          <div className="flex items-center gap-3 py-2" role="separator">
                            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                            <span
                              className="px-3 py-1 rounded-full text-[11px] font-bold border shrink-0"
                              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                            >
                              {formatDayHeader(m.created_at, lang)}
                            </span>
                            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                          </div>
                        )}
                        {renderOrderCard(m, fullTimestamp)}
                      </React.Fragment>
                    );
                  }

                  const isSupportReply = Boolean(m.metadata?.via_admin_support) || m.sender_id !== selected.customer_id;
                  const adminLabel = m.metadata?.admin_name || t('TCGXChange Support', 'TCGXChange Ügyfélszolgálat');
                  const images: Array<{ url: string; expires_at?: string }> = Array.isArray(m.metadata?.images) ? m.metadata.images : [];
                  const isBodyPlaceholder = m.body === 'Shared photo' || m.body === '[Photo]' || m.body === 'Megosztott fotó';

                  return (
                    <React.Fragment key={m.id}>
                      {showDaySeparator && (
                        <div className="flex items-center gap-3 py-2" role="separator">
                          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                          <span
                            className="px-3 py-1 rounded-full text-[11px] font-bold border shrink-0"
                            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                          >
                            {formatDayHeader(m.created_at, lang)}
                          </span>
                          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                        </div>
                      )}
                      <div className={`flex ${isSupportReply ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] sm:max-w-[75%] px-3.5 py-2.5 rounded-2xl border text-[13.5px] sm:text-sm font-medium leading-relaxed shadow-xs ${
                            isSupportReply ? 'rounded-br-sm' : 'rounded-bl-sm'
                          }`}
                          style={
                            isSupportReply
                              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-primary)' }
                              : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }
                          }
                        >
                          {images.length > 0 && (
                            <div className="flex flex-col gap-2 mb-2">
                              {images.map((img, i) => {
                                const isBroken = Boolean(brokenImages[img.url]);
                                if (isBroken) {
                                  return (
                                    <div key={i} className="text-xs opacity-70 p-2 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                                      {t('Photo unavailable', 'A fotó nem érhető el')}
                                    </div>
                                  );
                                }
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() =>
                                      setImageViewerState({
                                        isOpen: true,
                                        src: img.url,
                                        name: 'Attachment',
                                        gallery: images.map((im) => im.url),
                                        index: i,
                                      })
                                    }
                                    className="block cursor-zoom-in text-left"
                                  >
                                    <img
                                      src={img.url}
                                      alt="Attachment"
                                      onError={() => setBrokenImages((prev) => ({ ...prev, [img.url]: true }))}
                                      className="max-h-64 w-auto max-w-full rounded-xl object-contain bg-black/10"
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {(!isBodyPlaceholder || images.length === 0) && (
                            <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          )}
                          <div
                            className="text-[11px] font-semibold mt-1.5 flex items-center justify-end gap-1.5"
                            style={{ color: 'var(--text-tertiary)' }}
                            title={fullTimestamp}
                          >
                            <span className="font-bold" style={{ color: 'var(--text-accent)' }}>
                              {isSupportReply ? `${t('Support', 'Ügyfélszolgálat')} (${adminLabel})` : selected.customer_name} ·
                            </span>
                            <span>{formatMessageTime(m.created_at, lang)}</span>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
            </div>

            {errorMsg && (
              <div className="px-4 py-2 text-xs font-bold text-red-400 border-t bg-red-500/5" style={{ borderColor: 'var(--border)' }}>
                {errorMsg}
              </div>
            )}

            {/* Composer */}
            <form
              onSubmit={handleSend}
              className="p-3 border-t space-y-2 shrink-0"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}
            >
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((item, idx) => (
                    <div key={idx} className="relative group">
                      <img src={item.previewUrl} alt="" className="w-14 h-14 object-cover rounded-lg border" style={{ borderColor: 'var(--border)' }} />
                      <button
                        type="button"
                        onClick={() => removePendingFile(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center cursor-pointer"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleSelectFiles}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition hover:opacity-80"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title={t('Attach photo', 'Kép csatolása')}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={t('Reply as TCGXChange Support…', 'Válasz küldése a TCGXChange ügyfélszolgálat nevében…')}
                  className="flex-1 min-h-[40px] max-h-28 px-3 py-2 rounded-xl border text-sm outline-none resize-none"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <button
                  type="submit"
                  disabled={sending || uploadingImage || (!draft.trim() && pendingFiles.length === 0)}
                  className="h-10 px-4 rounded-xl text-xs font-black cursor-pointer transition disabled:opacity-40"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {sending || uploadingImage ? t('Sending…', 'Küldés…') : t('Send', 'Küldés')}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      <ImageViewer
        open={imageViewerState.isOpen}
        src={imageViewerState.src}
        alt={imageViewerState.name}
        images={imageViewerState.gallery}
        currentIndex={imageViewerState.index ?? 0}
        onIndexChange={(idx) =>
          setImageViewerState((prev) => ({
            ...prev,
            index: idx,
            src: (prev.gallery || [])[idx] || prev.src,
          }))
        }
        onClose={() => setImageViewerState({ isOpen: false, src: '', name: '' })}
      />
    </div>
  );
}
