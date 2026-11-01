import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getCurrentProfile } from '../../lib/auth';
import { supabase, cardThumbProps, getCardImageUrl } from '../../lib/supabase';
import {
  fetchConversations,
  fetchMessages,
  sendMessage,
  markThreadRead,
  resolveConversationIdFromHoldRequest,
  hideConversation,
  unhideConversation,
  resolveTransactionDestination,
  CHAT_IMAGE_EXPIRY_DAYS,
} from '../../lib/messages';
import { AuthModal } from '../auth/AuthModal';
import { HoldPanel } from './HoldPanel';
import { ReportModal } from '../common/ReportModal';
import { ImageViewer } from '../CardImageViewer';
import type { UserProfile, ChatMessage, ConversationSummary, Order } from '../../types';

/** Compact vertical padding around the page so the chat container gets maximum height. */
const PAGE_PAD_Y = 'clamp(10px, 1.5vw, 18px)';

const THREAD_POLL_MS = 20000; // active thread: fairly responsive without needing websockets
const INBOX_POLL_MS = 60000; // conversation list, while just browsing it

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Readable day header for grouping messages by date (full format, e.g. "október 22., csütörtök"). */
function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  const isEn = typeof window !== 'undefined' && localStorage.getItem('tcg_locale') === 'en';
  if (isEn) {
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }
  return d.toLocaleDateString('hu-HU', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

/** Exact clock time ("14:32") plus relative hint if within the last hour. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return `${timeStr} · just now`;
  if (mins < 60) return `${timeStr} · ${mins}m ago`;
  return timeStr;
}

/** Sidebar timestamp: clock time if today, "Yesterday", weekday if <7d, or short date. */
function formatSidebarTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) {
    return d.toLocaleDateString('en-GB', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatHandoverBadgeLabel(methodId?: string | null): string | null {
  if (!methodId) return null;
  switch (methodId) {
    case 'foxpost':
      return 'Foxpost Locker';
    case 'packeta':
      return 'Packeta Point';
    case 'personal':
    case 'pickup':
      return 'Personal Pickup';
    case 'post':
    case 'posta':
      return 'Post / Mail';
    case 'international':
      return 'International Shipping';
    default:
      if (methodId.startsWith('custom:')) return methodId.slice(7) || 'Custom Handover';
      return methodId;
  }
}

function getInitials(name?: string | null): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return 'U';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

type SystemTone = 'amber' | 'emerald' | 'purple' | 'blue' | 'red' | 'neutral';

function toneStyles(tone: SystemTone): { bg: string; border: string; color: string } {
  switch (tone) {
    case 'emerald':
      return {
        bg: 'var(--positive-muted)',
        border: 'var(--positive-border)',
        color: 'var(--positive)',
      };
    case 'red':
      return {
        bg: 'var(--negative-muted)',
        border: 'var(--negative-border)',
        color: 'var(--negative)',
      };
    case 'purple':
      return {
        bg: 'rgba(168, 85, 247, 0.14)',
        border: 'rgba(168, 85, 247, 0.35)',
        color: '#a855f7',
      };
    case 'blue':
      return {
        bg: 'rgba(59, 130, 246, 0.14)',
        border: 'rgba(59, 130, 246, 0.35)',
        color: '#3b82f6',
      };
    case 'amber':
      return {
        bg: 'var(--accent-muted)',
        border: 'var(--accent-border, rgba(234, 179, 8, 0.35))',
        color: 'var(--text-accent)',
      };
    default:
      return {
        bg: 'var(--bg-input)',
        border: 'var(--border)',
        color: 'var(--text-secondary)',
      };
  }
}

function getActionBadgeInfo(
  action: string | undefined,
  completed: boolean,
  kind: 'hold' | 'trade' | 'bulk' | 'auction' | 'store'
): { label: string; tone: SystemTone } {
  if (completed || action === 'auto_completed' || action === 'confirm_sale') {
    return { label: kind === 'trade' ? 'Trade Completed' : 'Completed', tone: 'emerald' };
  }
  switch (action) {
    case 'requested':
      return { label: kind === 'bulk' ? 'Bulk Hold Requested' : 'Hold Requested', tone: 'amber' };
    case 'trade_proposed':
      return { label: 'Trade Proposed', tone: 'amber' };
    case 'auction_won':
      return { label: 'Auction Won', tone: 'purple' };
    case 'hold':
      return { label: kind === 'trade' ? 'Trade On Hold' : 'Reserved / On Hold', tone: 'blue' };
    case 'mark_handed_over':
      return { label: 'Handed Over / Sent', tone: 'purple' };
    case 'update_tracking':
      return { label: 'Tracking Updated', tone: 'purple' };
    case 'confirm_received':
      return { label: 'Received', tone: 'emerald' };
    case 'release':
      return { label: 'Hold Released', tone: 'neutral' };
    case 'reject':
      return { label: 'Declined', tone: 'red' };
    case 'deny':
    case 'auction_cancelled':
      return { label: 'Cancelled', tone: 'red' };
    case 'expired':
      return { label: 'Expired', tone: 'neutral' };
    default:
      return { label: 'Order Update', tone: 'neutral' };
  }
}

function storeStatusTone(status?: string | null): SystemTone {
  switch (status) {
    case 'Delivered':
      return 'emerald';
    case 'Shipped':
      return 'purple';
    case 'Processing':
      return 'blue';
    case 'Cancelled':
      return 'red';
    default:
      return 'amber';
  }
}

export function MessagesApp() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // A conversation is a persistent thread per (buyer, seller) pair, so it has no
  // "closed" state of its own — every purchase between the two is just another
  // event in the same ongoing thread. The list is one flat inbox by recency.
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<'all' | 'unread' | 'holds'>('all');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadHolds, setThreadHolds] = useState<any[]>([]);
  const [threadOrders, setThreadOrders] = useState<Order[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [removedBanner, setRemovedBanner] = useState<{ conversationId: string; name: string } | null>(null);
  const removedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fullscreen image viewer state for card thumbnails and shared attachments
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string>('');
  const [viewerAlt, setViewerAlt] = useState<string>('Image preview');
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number>(0);

  const openImageViewer = useCallback(
    (src: string, alt = 'Image preview', images?: string[], initialIndex = 0) => {
      if (!src) return;
      setViewerSrc(src);
      setViewerAlt(alt);
      const list = images && images.length > 0 ? images : [src];
      setViewerImages(list);
      setViewerIndex(initialIndex >= 0 && initialIndex < list.length ? initialIndex : 0);
      setViewerOpen(true);
    },
    []
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const validFiles = files.filter((f) => allowedTypes.includes(f.type) && f.size <= 10 * 1024 * 1024);
    if (validFiles.length < files.length) {
      alert('Only PNG, JPG, or WebP images up to 10MB are supported.');
    }
    setAttachedFiles((prev) => [...prev, ...validFiles].slice(0, 5));
    e.target.value = '';
  };

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadAttachments = async (files: File[]): Promise<Array<{ url: string; expires_at: string }>> => {
    if (!files.length) return [];
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) throw new Error('Not authenticated.');

    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));

    const res = await fetch('/api/marketplace/upload-image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok || !data.success || !Array.isArray(data.urls)) {
      throw new Error(data.error || 'Failed to upload image(s).');
    }

    const expiresAt = new Date(Date.now() + CHAT_IMAGE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return data.urls.map((url: string) => ({
      url,
      expires_at: expiresAt,
    }));
  };

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** The conversation the thread was last scrolled for, so opening one jumps and new messages glide. */
  const scrolledForRef = useRef<string | null>(null);

  const loadConversations = useCallback(async (includeConversationId?: string | null) => {
    try {
      const list = await fetchConversations(
        includeConversationId ? { includeConversationId } : undefined
      );
      setConversations(list);
    } catch (e) {
      console.warn('Failed to load conversations:', e);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const loadThread = useCallback(async (conversationId: string) => {
    try {
      const sessionPromise = supabase.auth.getSession();
      const [list, holdsRes, sessionRes] = await Promise.all([
        fetchMessages(conversationId),
        supabase
          .from('hold_requests')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false }),
        sessionPromise,
      ]);

      setMessages(list);
      if (Array.isArray(holdsRes.data)) {
        setThreadHolds(holdsRes.data);
      }

      const token = sessionRes.data.session?.access_token;
      if (token) {
        fetch('/api/orders', { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((json) => {
            if (Array.isArray(json?.orders)) {
              setThreadOrders(json.orders);
            }
          })
          .catch(() => {});
      }

      markThreadRead(conversationId).then(() => {
        setConversations((prev) =>
          prev.map((c) => (c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c))
        );
      });
    } catch (e) {
      console.warn('Failed to load thread:', e);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    getCurrentProfile().then(async (p) => {
      setProfile(p);
      setLoading(false);
      if (p) {
        // Deep links from order/hold flows still carry ?hold_request_id= — resolve it
        // to whichever conversation that purchase now lives in.
        const params = new URLSearchParams(window.location.search);
        const conversationParam =
          params.get('conversation_id') || params.get('conversation') || params.get('thread');
        const holdRequestParam = params.get('hold_request_id');
        let initialConvId: string | null = null;
        if (conversationParam) {
          initialConvId = conversationParam;
        } else if (holdRequestParam) {
          initialConvId = await resolveConversationIdFromHoldRequest(holdRequestParam);
        }
        if (initialConvId) {
          await unhideConversation(initialConvId);
          setSelectedId(initialConvId);
        }
        loadConversations(initialConvId);
      }
    });
  }, [loadConversations]);

  useEffect(() => {
    if (!profile) return;
    const timer = setInterval(() => loadConversations(), INBOX_POLL_MS);
    return () => clearInterval(timer);
  }, [profile, loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      setThreadHolds([]);
      return;
    }
    setLoadingThread(true);
    loadThread(selectedId);
    const timer = setInterval(() => loadThread(selectedId), THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedId, loadThread]);

  // Scrolls the message list itself to the newest message.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const opened = scrolledForRef.current !== selectedId;
    scrolledForRef.current = selectedId;
    el.scrollTo({ top: el.scrollHeight, behavior: opened ? 'auto' : 'smooth' });
  }, [messages, selectedId]);

  useEffect(() => {
    return () => {
      if (removedTimerRef.current) clearTimeout(removedTimerRef.current);
    };
  }, []);

  const handleHideConversation = async (c: ConversationSummary, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (c.has_open_request) {
      const ok = window.confirm(
        `You still have an open hold request with ${c.counterpart_name}. Hide this conversation from Messages anyway? It will reappear automatically when there is new activity or a new transaction.`
      );
      if (!ok) return;
    }

    const convId = c.conversation_id;
    const counterpartName = c.counterpart_name || 'User';

    setConversations((prev) => prev.filter((item) => item.conversation_id !== convId));
    if (selectedId === convId) {
      setSelectedId(null);
    }

    setRemovedBanner({ conversationId: convId, name: counterpartName });
    if (removedTimerRef.current) clearTimeout(removedTimerRef.current);
    removedTimerRef.current = setTimeout(() => {
      setRemovedBanner(null);
    }, 6500);

    try {
      await hideConversation(convId, c.latest_activity_at || c.last_message_at);
    } catch (err) {
      console.warn('Failed to hide conversation:', err);
      loadConversations();
    }
  };

  const handleUndoHide = async () => {
    if (!removedBanner) return;
    const targetId = removedBanner.conversationId;
    setRemovedBanner(null);
    if (removedTimerRef.current) clearTimeout(removedTimerRef.current);
    await unhideConversation(targetId);
    await loadConversations(targetId);
  };

  const submitDraft = async () => {
    if (!selectedId || (!draft.trim() && attachedFiles.length === 0) || sending) return;
    setSending(true);
    const body = draft;
    const filesToSend = [...attachedFiles];
    setDraft('');
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      let uploadedImages: Array<{ url: string; expires_at: string }> = [];
      if (filesToSend.length > 0) {
        setUploadingImages(true);
        uploadedImages = await uploadAttachments(filesToSend);
        setUploadingImages(false);
      }

      const metadata = uploadedImages.length > 0 ? { images: uploadedImages } : undefined;
      const { message, error } = await sendMessage(selectedId, body, metadata);
      if (message) {
        setMessages((prev) => [...prev, message]);
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === selectedId
              ? {
                  ...c,
                  last_message: message.body,
                  last_message_at: message.created_at,
                  latest_activity_at: message.created_at,
                }
              : c
          )
        );
      } else {
        setDraft(body);
        setAttachedFiles(filesToSend);
        alert(error?.message || 'Failed to send message.');
      }
    } catch (err: any) {
      setDraft(body);
      setAttachedFiles(filesToSend);
      alert(err?.message || 'Failed to send message.');
    } finally {
      setSending(false);
      setUploadingImages(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitDraft();
  };

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (inboxFilter === 'unread' && c.unread_count <= 0) return false;
      if (inboxFilter === 'holds' && !c.has_open_request) return false;
      if (!q) return true;
      return (
        c.counterpart_name?.toLowerCase().includes(q) ||
        c.card_name?.toLowerCase().includes(q) ||
        c.last_message?.toLowerCase().includes(q)
      );
    });
  }, [conversations, searchQuery, inboxFilter]);

  const unreadTotal = useMemo(
    () => conversations.reduce((s, c) => s + (c.unread_count > 0 ? 1 : 0), 0),
    [conversations]
  );
  const openHoldsTotal = useMemo(
    () => conversations.reduce((s, c) => s + (c.has_open_request ? 1 : 0), 0),
    [conversations]
  );

  const holdsById = useMemo(() => {
    const map = new Map<string, any>();
    threadHolds.forEach((h) => {
      if (h?.id) map.set(String(h.id), h);
    });
    return map;
  }, [threadHolds]);

  const ordersByNumber = useMemo(() => {
    const map = new Map<string, Order>();
    threadOrders.forEach((o) => {
      if (o?.order_number) map.set(o.order_number, o);
    });
    return map;
  }, [threadOrders]);

  const ordersByHoldId = useMemo(() => {
    const map = new Map<string, Order>();
    threadOrders.forEach((o) => {
      const hid = o.hold_request_id || o.id;
      if (hid) map.set(String(hid), o);
    });
    return map;
  }, [threadOrders]);

  const renderUserAvatar = (
    avatarUrl: string | null | undefined,
    counterpartId: string | undefined,
    name: string | undefined,
    sizeClass: string,
    textClass: string
  ) => {
    const key = `avatar:${counterpartId || name || 'u'}`;
    const hasValidAvatar = Boolean(avatarUrl && !brokenImages[key]);
    if (hasValidAvatar) {
      return (
        <img
          src={avatarUrl!}
          alt={name || 'User avatar'}
          onError={() => setBrokenImages((prev) => ({ ...prev, [key]: true }))}
          className={`${sizeClass} rounded-full object-cover border shrink-0`}
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}
        />
      );
    }
    return (
      <div
        className={`${sizeClass} rounded-full border shrink-0 flex items-center justify-center font-black select-none ${textClass}`}
        style={{
          background: 'var(--accent-muted)',
          borderColor: 'var(--accent-border, var(--border))',
          color: 'var(--text-accent)',
        }}
        aria-hidden="true"
      >
        {getInitials(name)}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-bold text-base animate-pulse" style={{ color: 'var(--text-accent)' }}>
          Loading messages…
        </span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto', padding: 'clamp(16px,3vw,32px)' }}>
        <div
          className="my-12 p-8 text-center rounded-2xl shadow-xl border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            Messages
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
            Sign in to message buyers and sellers about your marketplace holds.
          </p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-6 py-3 font-black rounded-xl text-sm transition shadow-md cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            Sign In
          </button>
          {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
        </div>
      </div>
    );
  }

  const selected = conversations.find((c) => c.conversation_id === selectedId) || null;

  const renderSystemTransactionCard = (m: ChatMessage, fullTimestamp: string) => {
    const meta = m.metadata || {};

    // ─── 1. Official Store Order Card ───
    if (meta.store_order) {
      const orderNum = meta.order_number || '';
      const linkedOrder = orderNum ? ordersByNumber.get(orderNum) : undefined;
      const isStoreOwner = Boolean((profile.is_owner || profile.is_admin) && linkedOrder && linkedOrder.user_id !== profile.id);
      const dest = resolveTransactionDestination({
        isSeller: false,
        isStoreOrder: true,
        isStoreOwner,
        orderNumber: orderNum || null,
      });

      const liveStatus = linkedOrder?.status || meta.status || (meta.is_tracking_update ? 'Shipped' : 'Pending');
      const badgeColors = toneStyles(storeStatusTone(liveStatus));
      const storeItems = Array.isArray(meta.items) && meta.items.length > 0
        ? meta.items
        : Array.isArray(linkedOrder?.items)
        ? linkedOrder!.items
        : [];
      const trackingNum = meta.tracking_number || linkedOrder?.tracking_number || null;
      const courierName = meta.courier_name || linkedOrder?.courier_name || null;
      const totalHuf = Number(meta.total_price_huf ?? linkedOrder?.total_price_huf ?? linkedOrder?.total_huf ?? 0);
      const ctaLabel =
        dest.labelKey === 'store_admin' ? 'Open Store Admin' : 'Open in Order History';

      if (meta.is_tracking_update) {
        return (
          <div className="flex justify-center py-1">
            <a
              href={dest.href}
              className="group w-full max-w-md rounded-2xl border p-3.5 text-xs shadow-xs transition hover:border-[var(--accent)] hover:shadow-md block"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
                    style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="3" width="15" height="13" />
                      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                      <circle cx="5.5" cy="18.5" r="2.5" />
                      <circle cx="18.5" cy="18.5" r="2.5" />
                    </svg>
                  </span>
                  <span className="font-black text-xs" style={{ color: 'var(--text-primary)' }}>
                    Store Shipment
                  </span>
                  {orderNum && (
                    <span className="font-mono font-bold text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      #{orderNum}
                    </span>
                  )}
                </div>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                  style={{ background: badgeColors.bg, borderColor: badgeColors.border, color: badgeColors.color }}
                >
                  Shipped
                </span>
              </div>

              {trackingNum && (
                <div
                  className="mt-2.5 p-2.5 rounded-xl border flex items-center justify-between gap-2"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                >
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-wider block" style={{ color: 'var(--text-accent)' }}>
                      Tracking {courierName ? `(${courierName})` : ''}
                    </span>
                    <span className="text-xs font-mono font-black break-all" style={{ color: 'var(--text-primary)' }}>
                      {trackingNum}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-2.5 pt-2 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }} title={fullTimestamp}>
                  {formatMessageTime(m.created_at)}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-black group-hover:underline" style={{ color: 'var(--text-accent)' }}>
                  <span>{ctaLabel}</span>
                  <svg className="w-3 h-3 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </div>
            </a>
          </div>
        );
      }

      return (
        <div className="flex justify-center py-1">
          <a
            href={dest.href}
            className="group w-full max-w-md rounded-2xl border p-3.5 text-xs shadow-xs transition hover:border-[var(--accent)] hover:shadow-md block"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between gap-2 border-b pb-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 0 1-8 0" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <span className="font-black text-xs block truncate" style={{ color: 'var(--text-primary)' }}>
                    Official Store Order
                  </span>
                  {orderNum && (
                    <span className="font-mono font-bold text-[10px] block" style={{ color: 'var(--text-tertiary)' }}>
                      #{orderNum}
                    </span>
                  )}
                </div>
              </div>
              <span
                className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border shrink-0"
                style={{ background: badgeColors.bg, borderColor: badgeColors.border, color: badgeColors.color }}
              >
                {liveStatus}
              </span>
            </div>

            {storeItems.length > 0 && (
              <div className="py-2.5 space-y-2 max-h-44 overflow-y-auto">
                {storeItems.slice(0, 4).map((it: any, itemIdx: number) => {
                  const imgSrc = it.image || it.image_path;
                  const itemName = it.name || it.card_name || 'Store Item';
                  const qty = Number(it.quantity) || 1;
                  const lineTotal = (Number(it.price_huf) || 0) * qty;
                  return (
                    <div key={itemIdx} className="flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {imgSrc ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openImageViewer(getCardImageUrl(imgSrc), itemName);
                            }}
                            title="View full image"
                            className="cursor-zoom-in shrink-0 rounded-lg overflow-hidden transition hover:opacity-90 block"
                          >
                            <img
                              {...cardThumbProps(imgSrc, 'avatar')}
                              alt={itemName}
                              className="w-8 h-10 object-cover border"
                              style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                            />
                          </button>
                        ) : (
                          <div
                            className="w-8 h-10 rounded-lg border shrink-0 flex items-center justify-center text-[9px] font-mono"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-tertiary)' }}
                          >
                            TCG
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {qty}× {itemName}
                          </div>
                        </div>
                      </div>
                      {lineTotal > 0 && (
                        <span className="font-mono font-bold shrink-0" style={{ color: 'var(--text-secondary)' }}>
                          {lineTotal.toLocaleString('hu-HU')} Ft
                        </span>
                      )}
                    </div>
                  );
                })}
                {storeItems.length > 4 && (
                  <div className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                    +{storeItems.length - 4} more item(s)
                  </div>
                )}
              </div>
            )}

            {trackingNum && (
              <div
                className="mb-2.5 p-2 rounded-xl border flex items-center justify-between gap-2"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
              >
                <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
                  Tracking{courierName ? ` (${courierName})` : ''}
                </span>
                <span className="text-[11px] font-mono font-black truncate" style={{ color: 'var(--text-primary)' }}>
                  {trackingNum}
                </span>
              </div>
            )}

            <div className="pt-2.5 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                {totalHuf > 0 && (
                  <span className="text-sm font-black font-mono" style={{ color: 'var(--text-primary)' }}>
                    {totalHuf.toLocaleString('hu-HU')} Ft
                  </span>
                )}
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }} title={fullTimestamp}>
                  · {formatMessageTime(m.created_at)}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-black group-hover:underline shrink-0" style={{ color: 'var(--text-accent)' }}>
                <span>{ctaLabel}</span>
                <svg className="w-3 h-3 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </div>
          </a>
        </div>
      );
    }

    // ─── 2. Marketplace Hold / Cart / Trade / Bulk / Auction System Card ───
    const holdId: string | null = m.hold_request_id || meta.hold_request_id || null;
    let linkedHold = (holdId ? holdsById.get(holdId) : null);

    if (!linkedHold && threadHolds.length > 0) {
      // 1. Order number match in meta or body
      const bodyOrderMatch = (m.body || '').match(/#?(P2P-[A-Z0-9]+)/i);
      const targetOrderNum = (meta.order_number || (bodyOrderMatch ? bodyOrderMatch[1].toUpperCase() : null));
      if (targetOrderNum) {
        linkedHold = threadHolds.find((h) =>
          h.order_number === targetOrderNum ||
          `P2P-${String(h.id).slice(0, 8).toUpperCase()}` === targetOrderNum
        ) || null;
      }

      // 2. Exact message match
      if (!linkedHold) {
        linkedHold = threadHolds.find((h) => h.message && h.message === m.body) || null;
      }

      // 3. Card title in quotes: e.g. ("Punch First")
      if (!linkedHold) {
        const quotedMatch = (m.body || '').match(/\("([^"]+)"\)/);
        if (quotedMatch) {
          const quotedTitle = quotedMatch[1].trim().toLowerCase();
          linkedHold = threadHolds.find((h) => {
            const hClean = String(h.card_name || '').replace(/^\[(Auction|Trade|Bulk)\]\s*/i, '').trim().toLowerCase();
            if (hClean === quotedTitle || hClean.includes(quotedTitle) || quotedTitle.includes(hClean)) return true;
            if (Array.isArray(h.items)) {
              return h.items.some((it: any) => String(it.card_name || '').trim().toLowerCase() === quotedTitle);
            }
            return false;
          }) || null;
        }
      }

      // 4. Clean card_name substring match in body
      if (!linkedHold) {
        linkedHold = threadHolds.find((h) => {
          const hClean = String(h.card_name || '').replace(/^\[(Auction|Trade|Bulk)\]\s*/i, '').trim();
          return hClean.length >= 3 && (m.body || '').toLowerCase().includes(hClean.toLowerCase());
        }) || null;
      }

      // 5. If only 1 hold exists in the thread
      if (!linkedHold && threadHolds.length === 1) {
        linkedHold = threadHolds[0];
      }

      // 6. Proximity fallback: find hold created/updated closest to m.created_at
      if (!linkedHold) {
        const mTime = new Date(m.created_at).getTime();
        let closestHold: any = null;
        let closestDiff = Infinity;
        for (const h of threadHolds) {
          const hTime = new Date(h.updated_at || h.created_at).getTime();
          const diff = Math.abs(mTime - hTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestHold = h;
          }
        }
        if (closestDiff < 2 * 60 * 60 * 1000) {
          linkedHold = closestHold;
        }
      }
    }

    const linkedOrder =
      (meta.order_number ? ordersByNumber.get(meta.order_number) : undefined) ||
      (holdId ? ordersByHoldId.get(holdId) : undefined) ||
      (linkedHold?.id ? ordersByHoldId.get(String(linkedHold.id)) : undefined) ||
      (linkedHold?.order_number ? ordersByNumber.get(linkedHold.order_number) : undefined);
    const orderNumber: string | null =
      meta.order_number ||
      linkedHold?.order_number ||
      (linkedHold?.id ? `P2P-${String(linkedHold.id).slice(0, 8).toUpperCase()}` : null) ||
      linkedOrder?.order_number ||
      null;

    let isTxSeller = false;
    if (meta.seller_id) {
      isTxSeller = meta.seller_id === profile.id;
    } else if (meta.buyer_id) {
      isTxSeller = meta.buyer_id !== profile.id;
    } else if (linkedHold?.seller_id) {
      isTxSeller = linkedHold.seller_id === profile.id;
    } else if (linkedHold?.buyer_id) {
      isTxSeller = linkedHold.buyer_id !== profile.id;
    } else if (linkedOrder?.seller_id) {
      isTxSeller = linkedOrder.seller_id === profile.id;
    } else if (linkedOrder?.user_id) {
      isTxSeller = linkedOrder.user_id !== profile.id;
    } else {
      const isSellerAction = /auction cancelled|by seller|accepted the hold|declined|rejected|marked as handed over|marked trade cards handed over|seller confirmed|hold released/i.test(m.body);
      const isBuyerAction = /(?:^|\s)\[?auction won\]?|auction won:|requested a hold|requested bulk|proposed a trade|confirmed receiving|buyer reported/i.test(m.body);
      if (isSellerAction && !isBuyerAction) {
        isTxSeller = (m.sender_id === profile.id);
      } else if (isBuyerAction && !isSellerAction) {
        isTxSeller = (m.sender_id !== profile.id);
      } else {
        isTxSeller = Boolean(selected?.is_seller);
      }
    }

    const dest = resolveTransactionDestination({
      isSeller: isTxSeller,
      isStoreOrder: false,
      holdRequestId: holdId || linkedHold?.id || null,
      orderNumber,
    });
    const ctaLabel = dest.labelKey === 'seller_hub' ? 'Open in Seller Hub' : 'Open in Order History';

    let inferredAction: string | undefined = meta.action;
    if (!inferredAction) {
      if (/auction cancelled/i.test(m.body)) inferredAction = 'auction_cancelled';
      else if (/hold released/i.test(m.body)) inferredAction = 'release';
      else if (/accepted the hold|hold accepted/i.test(m.body)) inferredAction = 'hold';
      else if (/declined|rejected/i.test(m.body)) inferredAction = 'reject';
      else if (/handed over|sent/i.test(m.body)) inferredAction = 'mark_handed_over';
      else if (/tracking/i.test(m.body)) inferredAction = 'update_tracking';
      else if (/received|confirmed receiving/i.test(m.body)) inferredAction = 'confirm_received';
      else if (/(?:^|\s)\[?auction won\]?|auction won:/i.test(m.body)) inferredAction = 'auction_won';
      else if (/proposed a trade|trade proposed/i.test(m.body)) inferredAction = 'trade_proposed';
      else if (/requested a hold|requested bulk|hold requested/i.test(m.body)) inferredAction = 'requested';
    }

    const rawCardName = String(meta.card_name || linkedHold?.card_name || '');
    const kind: 'trade' | 'bulk' | 'auction' | 'hold' =
      meta.kind === 'trade' || inferredAction === 'trade_proposed' || linkedHold?.card_number === 'TRADE' || rawCardName.startsWith('[Trade]') || /trade/i.test(m.body)
        ? 'trade'
        : meta.kind === 'bulk' || linkedHold?.card_number === 'BULK' || rawCardName.startsWith('[Bulk]') || /bulk/i.test(m.body)
        ? 'bulk'
        : meta.kind === 'auction' || inferredAction === 'auction_won' || inferredAction === 'auction_cancelled' || linkedHold?.card_number === 'AUCTION' || rawCardName.startsWith('[Auction]') || /auction/i.test(m.body)
        ? 'auction'
        : 'hold';

    const action: string | undefined = inferredAction;
    const isCompletedEvent = Boolean(
      meta.completed ||
        action === 'auto_completed' ||
        action === 'confirm_sale' ||
        (action === 'confirm_received' && /completed/i.test(m.body))
    );

    const isPrimaryCardEvent =
      action === 'requested' ||
      action === 'trade_proposed' ||
      action === 'auction_won' ||
      isCompletedEvent;

    const badge = getActionBadgeInfo(action, isCompletedEvent, kind);
    const badgeStyle = toneStyles(badge.tone);

    const rawItems: any[] =
      Array.isArray(meta.items) && meta.items.length > 0
        ? meta.items
        : Array.isArray(linkedHold?.items) && linkedHold.items.length > 0
        ? linkedHold.items
        : Array.isArray(linkedOrder?.items) && linkedOrder.items.length > 0
        ? linkedOrder.items
        : linkedHold || meta.card_name
        ? [
            {
              card_name: meta.card_name || linkedHold?.card_name || 'Card',
              card_number: linkedHold?.card_number,
              image_path: meta.image_path || linkedHold?.image_path || null,
              price_huf: meta.price_huf ?? linkedHold?.price_huf ?? 0,
              quantity: linkedHold?.quantity || 1,
              condition: linkedHold?.condition,
              is_foil: linkedHold?.is_foil,
            },
          ]
        : [];

    const primaryImage: string | null =
      meta.image_path ||
      rawItems[0]?.image_path ||
      rawItems[0]?.offered_image ||
      linkedHold?.image_path ||
      null;

    const shippingHuf = Number(meta.shipping_huf ?? linkedHold?.shipping_huf ?? linkedOrder?.shipping_huf ?? 0);
    const computedItemsSubtotal = rawItems.reduce(
      (sum, it) => sum + (Number(it.price_huf) || 0) * (Number(it.quantity) || 1),
      0
    );
    const bodyPriceMatch = (m.body || '').match(/(\d+[\d\s]*)\s*Ft/i);
    const bodyPriceHuf = bodyPriceMatch ? Number(bodyPriceMatch[1].replace(/\s+/g, '')) : null;

    const totalHuf: number | null =
      meta.price_huf !== undefined && meta.price_huf !== null
        ? Number(meta.price_huf)
        : linkedHold?.price_huf !== undefined && linkedHold?.price_huf !== null
        ? Number(linkedHold.price_huf)
        : linkedOrder?.total_price_huf !== undefined
        ? Number(linkedOrder.total_price_huf)
        : rawItems.length > 0
        ? computedItemsSubtotal + shippingHuf
        : bodyPriceHuf !== null
        ? bodyPriceHuf
        : null;

    const trackingNum: string | null =
      meta.tracking_number ||
      (action === 'mark_handed_over' || action === 'update_tracking'
        ? linkedHold?.tracking_number || null
        : null);
    const handoverLabelText = formatHandoverBadgeLabel(
      meta.handover || linkedHold?.preferred_handover || linkedOrder?.shipping_method
    );
    const handoverDetailsText: string | null =
      typeof meta.handover_details === 'string' && meta.handover_details
        ? meta.handover_details
        : action === 'requested' && linkedHold?.handover_details
        ? linkedHold.handover_details
        : null;

    const kindHeaderLabel =
      kind === 'trade'
        ? 'Card Trade'
        : kind === 'bulk'
        ? 'Bulk Lot'
        : kind === 'auction'
        ? 'Auction'
        : rawItems.length > 1
        ? `Cart Hold (${rawItems.length} cards)`
        : 'Marketplace Hold';

    const renderKindIcon = () => {
      if (kind === 'trade') {
        return (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        );
      }
      if (kind === 'auction') {
        return (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8" />
            <path d="m16 16 6-6" />
            <path d="m8 8 6-6" />
            <path d="m9 7 8 8" />
            <path d="m21 11-8-8" />
          </svg>
        );
      }
      if (kind === 'bulk') {
        return (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        );
      }
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    };

    // ─── Rich Visual Card for Requests, Proposals, Auction Wins, and Completed Sales ───
    if (isPrimaryCardEvent) {
      const firstTradeItem = rawItems[0] || {};
      let offeredName = meta.offered_name || firstTradeItem.offered_name || null;
      let wantedName = meta.wanted_name || firstTradeItem.wanted_name || null;
      if (kind === 'trade' && (!offeredName || !wantedName)) {
        const cleanTrade = rawCardName.replace(/^\[Trade\]\s*/i, '');
        if (cleanTrade.includes('⇄')) {
          const [l, r] = cleanTrade.split('⇄').map((s) => s.trim());
          offeredName = offeredName || l;
          wantedName = wantedName || r;
        }
      }
      const offeredImage = meta.offered_image || firstTradeItem.offered_image || primaryImage;
      const wantedImage = meta.wanted_image || firstTradeItem.wanted_image || null;

      return (
        <div className="flex justify-center py-1">
          <a
            href={dest.href}
            className="group w-full max-w-md rounded-2xl border p-3.5 text-xs shadow-xs transition hover:border-[var(--accent)] hover:shadow-md block"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
                  style={{ background: badgeStyle.bg, borderColor: badgeStyle.border, color: badgeStyle.color }}
                >
                  {renderKindIcon()}
                </span>
                <div className="min-w-0">
                  <span className="font-black text-xs block truncate" style={{ color: 'var(--text-primary)' }}>
                    {kindHeaderLabel}
                  </span>
                  {orderNumber && (
                    <span className="font-mono font-bold text-[10px] block" style={{ color: 'var(--text-tertiary)' }}>
                      #{orderNumber}
                    </span>
                  )}
                </div>
              </div>
              <span
                className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border shrink-0"
                style={{ background: badgeStyle.bg, borderColor: badgeStyle.border, color: badgeStyle.color }}
              >
                {badge.label}
              </span>
            </div>

            {/* Body: Trade Swap View OR Card Item List */}
            {kind === 'trade' && (offeredName || wantedName) ? (
              <div className="py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div
                  className="p-2 rounded-xl border flex items-center gap-2 min-w-0"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                >
                  {offeredImage ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openImageViewer(getCardImageUrl(offeredImage), offeredName || 'Offered');
                      }}
                      title="View full image"
                      className="cursor-zoom-in shrink-0 rounded-md overflow-hidden transition hover:opacity-90 block"
                    >
                      <img
                        {...cardThumbProps(offeredImage, 'avatar')}
                        alt={offeredName || 'Offered'}
                        className="w-8 h-11 object-cover border"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    </button>
                  ) : (
                    <div
                      className="w-8 h-11 rounded-md border shrink-0 flex items-center justify-center text-[9px] font-mono"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-tertiary)' }}
                    >
                      TCG
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-wider block" style={{ color: 'var(--text-tertiary)' }}>
                      Offering
                    </span>
                    <span className="font-bold text-[11px] block truncate" style={{ color: 'var(--text-primary)' }}>
                      {offeredName || 'Card'}
                    </span>
                  </div>
                </div>

                <div
                  className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </div>

                <div
                  className="p-2 rounded-xl border flex items-center gap-2 min-w-0"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                >
                  {wantedImage ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openImageViewer(getCardImageUrl(wantedImage), wantedName || 'Wanted');
                      }}
                      title="View full image"
                      className="cursor-zoom-in shrink-0 rounded-md overflow-hidden transition hover:opacity-90 block"
                    >
                      <img
                        {...cardThumbProps(wantedImage, 'avatar')}
                        alt={wantedName || 'Wanted'}
                        className="w-8 h-11 object-cover border"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    </button>
                  ) : (
                    <div
                      className="w-8 h-11 rounded-md border shrink-0 flex items-center justify-center text-[9px] font-mono"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-tertiary)' }}
                    >
                      TCG
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-wider block" style={{ color: 'var(--text-tertiary)' }}>
                      For
                    </span>
                    <span className="font-bold text-[11px] block truncate" style={{ color: 'var(--text-primary)' }}>
                      {wantedName || 'Card'}
                    </span>
                  </div>
                </div>
              </div>
            ) : rawItems.length > 0 ? (
              <div className="py-2.5 space-y-2 max-h-44 overflow-y-auto">
                {rawItems.slice(0, 4).map((it: any, iIdx: number) => {
                  const thumb = it.image_path || (iIdx === 0 ? primaryImage : null);
                  const cleanTitle = String(it.card_name || 'Card').replace(/^\[(Bulk|Auction|Trade)\]\s*/i, '');
                  const qty = Number(it.quantity) || 1;
                  const lineTotal = (Number(it.price_huf) || 0) * qty;
                  return (
                    <div key={iIdx} className="flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {thumb ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openImageViewer(getCardImageUrl(thumb), cleanTitle);
                            }}
                            title="View full image"
                            className="cursor-zoom-in shrink-0 rounded-lg overflow-hidden transition hover:opacity-90 block"
                          >
                            <img
                              {...cardThumbProps(thumb, 'avatar')}
                              alt={cleanTitle}
                              className="w-9 h-12 object-cover border"
                              style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                            />
                          </button>
                        ) : (
                          <div
                            className="w-9 h-12 rounded-lg border shrink-0 flex items-center justify-center text-[9px] font-mono"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-tertiary)' }}
                          >
                            TCG
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {qty > 1 ? `${qty}× ` : ''}
                            {cleanTitle}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {it.condition && (
                              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                                {it.condition}
                              </span>
                            )}
                            {Boolean(it.is_foil) && (
                              <span
                                className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase border"
                                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                              >
                                Foil
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {lineTotal > 0 && (
                        <span className="font-mono font-bold shrink-0" style={{ color: 'var(--text-secondary)' }}>
                          {lineTotal.toLocaleString('hu-HU')} Ft
                        </span>
                      )}
                    </div>
                  );
                })}
                {rawItems.length > 4 && (
                  <div className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                    +{rawItems.length - 4} more card(s)
                  </div>
                )}
              </div>
            ) : (
              <div className="py-2.5 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {m.body}
              </div>
            )}

            {/* Delivery / Handover / Tracking Strip */}
            {(handoverLabelText || handoverDetailsText || trackingNum) && (
              <div
                className="mb-2.5 p-2.5 rounded-xl border space-y-1"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
              >
                {handoverLabelText && (
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>
                      {handoverLabelText}
                    </span>
                    {shippingHuf > 0 && (
                      <span className="font-mono font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                        +{shippingHuf.toLocaleString('hu-HU')} Ft shipping
                      </span>
                    )}
                  </div>
                )}
                {handoverDetailsText && (
                  <div className="text-[11px] leading-snug whitespace-pre-line break-words" style={{ color: 'var(--text-tertiary)' }}>
                    {handoverDetailsText}
                  </div>
                )}
                {trackingNum && (
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
                      Tracking
                    </span>
                    <span className="font-mono font-black text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      {trackingNum}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="pt-2.5 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2 min-w-0">
                {totalHuf !== null && (
                  <span className="text-sm font-black font-mono shrink-0" style={{ color: 'var(--text-primary)' }}>
                    {kind === 'trade' && totalHuf === 0
                      ? 'Even Trade'
                      : `${totalHuf.toLocaleString('hu-HU')} Ft`}
                  </span>
                )}
                <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-tertiary)' }} title={fullTimestamp}>
                  {totalHuf !== null ? '· ' : ''}
                  {formatMessageTime(m.created_at)}
                </span>
              </div>
              <span
                className="inline-flex items-center gap-1 text-[11px] font-black group-hover:underline shrink-0"
                style={{ color: 'var(--text-accent)' }}
              >
                <span>{ctaLabel}</span>
                <svg className="w-3 h-3 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </div>
          </a>
        </div>
      );
    }

    // ─── Compact Visual Status Card for Intermediate Lifecycle Events ───
    const compactTitle =
      rawItems.length > 1
        ? `${rawItems.length} cards`
        : String(rawItems[0]?.card_name || rawCardName || '').replace(/^\[(Bulk|Auction|Trade)\]\s*/i, '') ||
          (linkedHold?.card_name ? String(linkedHold.card_name).replace(/^\[(Bulk|Auction|Trade)\]\s*/i, '') : '') ||
          kindHeaderLabel;

    return (
      <div className="flex justify-center py-1">
        <a
          href={dest.href}
          className="group w-full max-w-md rounded-2xl border p-3 text-xs shadow-xs transition hover:border-[var(--accent)] hover:shadow-md flex items-center gap-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          {primaryImage ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openImageViewer(getCardImageUrl(primaryImage), compactTitle);
              }}
              title="View full image"
              className="cursor-zoom-in shrink-0 rounded-lg overflow-hidden transition hover:opacity-90 block"
            >
              <img
                {...cardThumbProps(primaryImage, 'avatar')}
                alt={compactTitle}
                className="w-10 h-14 object-cover border"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
              />
            </button>
          ) : (
            <div
              className="w-10 h-12 rounded-xl border shrink-0 flex items-center justify-center"
              style={{ background: badgeStyle.bg, borderColor: badgeStyle.border, color: badgeStyle.color }}
            >
              {renderKindIcon()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                style={{ background: badgeStyle.bg, borderColor: badgeStyle.border, color: badgeStyle.color }}
              >
                {badge.label}
              </span>
              {orderNumber && (
                <span className="font-mono font-bold text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  #{orderNumber}
                </span>
              )}
              <span className="text-[10px] font-semibold ml-auto" style={{ color: 'var(--text-tertiary)' }} title={fullTimestamp}>
                {formatMessageTime(m.created_at)}
              </span>
            </div>

            <div className="font-bold text-xs truncate mt-1" style={{ color: 'var(--text-primary)' }}>
              {compactTitle}
            </div>
            <div className="text-[11px] leading-snug mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
              {m.body}
            </div>

            {trackingNum && (
              <div
                className="mt-1.5 px-2 py-1 rounded-lg border inline-flex items-center gap-1.5 max-w-full"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
              >
                <span className="text-[9px] font-black uppercase tracking-wider shrink-0" style={{ color: 'var(--text-accent)' }}>
                  Tracking:
                </span>
                <span className="font-mono font-black text-[11px] truncate" style={{ color: 'var(--text-primary)' }}>
                  {trackingNum}
                </span>
              </div>
            )}

            <div className="mt-1.5 flex items-center justify-between gap-2">
              {totalHuf !== null && totalHuf > 0 ? (
                <span className="text-[11px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>
                  {totalHuf.toLocaleString('hu-HU')} Ft
                </span>
              ) : (
                <span />
              )}
              <span className="inline-flex items-center gap-0.5 text-[11px] font-black group-hover:underline" style={{ color: 'var(--text-accent)' }}>
                <span>{ctaLabel}</span>
                <svg className="w-3 h-3 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </div>
          </div>
        </a>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: `${PAGE_PAD_Y} clamp(12px,2.5vw,24px)` }}>
      <div
        className="rounded-2xl border overflow-hidden grid grid-cols-1 md:grid-cols-[340px_1fr] relative"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          height: `calc(100dvh - var(--page-chrome-h) - 2 * ${PAGE_PAD_Y})`,
          minHeight: 540,
        }}
      >
        {/* Conversation list sidebar */}
        <div
          className={`${selectedId ? 'hidden md:flex' : 'flex'} border-r flex-col min-h-0`}
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {/* Sidebar search & filters */}
          <div className="p-3 border-b flex flex-col gap-2 shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
            <div className="relative">
              <svg
                className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-tertiary)' }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search user, card, or message…"
                className="w-full h-9 pl-8 pr-3 rounded-xl text-xs font-semibold border outline-none focus:border-[var(--accent)] transition"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {([
                { id: 'all' as const, label: 'All', count: conversations.length },
                { id: 'unread' as const, label: 'Unread', count: unreadTotal },
                { id: 'holds' as const, label: 'Open Holds', count: openHoldsTotal },
              ]).map((f) => {
                const active = inboxFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setInboxFilter(f.id)}
                    className="flex-1 h-7 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer flex items-center justify-center gap-1"
                    style={
                      active
                        ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                        : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                    }
                  >
                    <span>{f.label}</span>
                    {f.count > 0 && (
                      <span className="text-[10px] font-black opacity-80">({f.count})</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {loadingConversations ? (
              <div className="p-6 text-center text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                Loading conversations…
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                {conversations.length === 0
                  ? 'No conversations yet. Requesting or receiving a hold on a marketplace card starts a thread here.'
                  : 'No conversations match your filter.'}
              </div>
            ) : (
              filteredConversations.map((c) => {
                const isSelected = selectedId === c.conversation_id;
                const hasUnread = c.unread_count > 0;
                return (
                  <div
                    key={c.conversation_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(c.conversation_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(c.conversation_id);
                      }
                    }}
                    className="group w-full flex items-center gap-3 p-3.5 text-left border-b transition cursor-pointer hover:bg-[var(--bg-raised)]/60 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background: isSelected ? 'var(--accent-muted)' : undefined,
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    <div className="relative shrink-0">
                      {renderUserAvatar(
                        c.counterpart_avatar,
                        c.counterpart_id,
                        c.counterpart_name,
                        'w-11 h-11',
                        'text-xs'
                      )}
                      {c.has_open_request && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                          style={{ background: 'var(--accent)', borderColor: 'var(--bg-surface)' }}
                          title="Open hold request"
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-black truncate" style={{ color: 'var(--text-primary)' }}>
                          {c.counterpart_name}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {c.last_message_at && (
                            <span
                              className="text-[11px] font-semibold"
                              style={{ color: hasUnread ? 'var(--text-accent)' : 'var(--text-tertiary)' }}
                              title={new Date(c.last_message_at).toLocaleString('en-GB', { hour12: false })}
                            >
                              {formatSidebarTime(c.last_message_at)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleHideConversation(c, e)}
                            title="Remove from messages until next transaction"
                            aria-label={`Remove ${c.counterpart_name} from messages`}
                            className="w-6 h-6 rounded-md flex items-center justify-center transition cursor-pointer opacity-60 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/15 hover:text-red-400"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="text-xs font-semibold truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {c.card_name}
                      </div>
                      <div
                        className={`text-xs truncate mt-0.5 ${hasUnread ? 'font-bold' : 'font-normal'}`}
                        style={{ color: hasUnread ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                      >
                        {c.last_message || 'No messages yet'}
                      </div>
                    </div>
                    {hasUnread && (
                      <span
                        className="shrink-0 min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-black flex items-center justify-center"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Thread view */}
        {!selectedId && (
          <div className="hidden md:flex flex-col items-center justify-center gap-2 p-8 text-center">
            <div
              className="w-12 h-12 rounded-2xl border flex items-center justify-center mb-1"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
              Select a conversation
            </div>
            <div className="text-xs max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
              Choose a thread on the left to coordinate payment, meetup details, or parcel tracking.
            </div>
          </div>
        )}
        {selectedId && (
          <div className="flex flex-col min-h-0">
            {/* Thread Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
            >
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Back to conversation list"
                className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border shrink-0"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-input)' }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              {selected?.counterpart_id ? (
                <a href={`/user?id=${selected.counterpart_id}`} className="shrink-0" title="View user profile">
                  {renderUserAvatar(
                    selected.counterpart_avatar,
                    selected.counterpart_id,
                    selected.counterpart_name,
                    'w-9 h-9',
                    'text-xs'
                  )}
                </a>
              ) : (
                renderUserAvatar(
                  selected?.counterpart_avatar,
                  selected?.counterpart_id,
                  selected?.counterpart_name,
                  'w-9 h-9',
                  'text-xs'
                )
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {selected?.counterpart_id ? (
                    <a
                      href={`/user?id=${selected.counterpart_id}`}
                      className="text-sm font-black truncate hover:underline inline-flex items-center gap-1"
                      style={{ color: 'var(--text-primary)' }}
                      title="View user profile and ratings"
                    >
                      <span>{selected.counterpart_name || 'Conversation'}</span>
                      <svg className="w-3.5 h-3.5 opacity-60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ) : (
                    <span className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>
                      {selected?.counterpart_name || 'Conversation'}
                    </span>
                  )}
                </div>
                <div className="text-xs font-semibold truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {selected?.card_name}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {selected?.has_open_request && (
                  <span
                    className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border hidden sm:inline-flex"
                    style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                  >
                    Open hold
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    loadThread(selectedId);
                    loadConversations(selectedId);
                  }}
                  title="Refresh messages"
                  className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition hover:bg-[var(--bg-raised)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
                {selected && (
                  <button
                    type="button"
                    onClick={() => handleHideConversation(selected)}
                    title="Remove from messages until next transaction"
                    className="h-8 px-2.5 rounded-lg border flex items-center gap-1.5 cursor-pointer transition hover:bg-[var(--bg-raised)] text-xs font-semibold"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    <span className="hidden lg:inline">Hide</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  title="Report this conversation to moderators"
                  className="h-8 px-2.5 rounded-lg border flex items-center gap-1.5 cursor-pointer transition hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400 text-xs font-semibold"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                  </svg>
                  <span className="hidden sm:inline">Report</span>
                </button>
              </div>
            </div>

            <HoldPanel
              conversationId={selectedId}
              myId={profile.id}
              counterpartId={selected?.counterpart_id}
              counterpartName={selected?.counterpart_name}
              refreshKey={messages.length}
              onChanged={() => {
                loadThread(selectedId);
                loadConversations(selectedId);
              }}
            />

            {/* Message History */}
            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loadingThread ? (
                <div className="text-center text-xs font-semibold py-8" style={{ color: 'var(--text-tertiary)' }}>
                  Loading messages…
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-xs py-12" style={{ color: 'var(--text-tertiary)' }}>
                  No messages yet — say hello!
                </div>
              ) : (
                messages.map((m, idx) => {
                  const prev = idx > 0 ? messages[idx - 1] : null;
                  const showDaySeparator = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
                  const fullTimestamp = new Date(m.created_at).toLocaleString('en-GB', { hour12: false });

                  // Detect legacy user-typed pseudo-system messages from earlier trade/bulk/auction flows
                  const isLegacyTxPrefix =
                    m.message_type === 'user' &&
                    /^\[(Trade Proposal|Bulk Hold Request|Auction Won)\]/i.test(m.body || '');

                  if (isLegacyTxPrefix) {
                    const matchedHold = threadHolds.find((h) => h.message === m.body) || threadHolds[0] || null;
                    const syntheticSystemMsg: ChatMessage = {
                      ...m,
                      message_type: 'system',
                      hold_request_id: m.hold_request_id || matchedHold?.id || null,
                      metadata: {
                        ...(m.metadata || {}),
                        action: /^\[Trade Proposal\]/i.test(m.body)
                          ? 'trade_proposed'
                          : /^\[Auction Won\]/i.test(m.body)
                          ? 'auction_won'
                          : 'requested',
                        kind: /^\[Trade Proposal\]/i.test(m.body)
                          ? 'trade'
                          : /^\[Auction Won\]/i.test(m.body)
                          ? 'auction'
                          : 'bulk',
                      },
                    };
                    return (
                      <React.Fragment key={m.id}>
                        {showDaySeparator && (
                          <div className="flex items-center gap-3 py-2" role="separator">
                            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                            <span
                              className="px-3 py-1 rounded-full text-[11px] font-bold border shrink-0"
                              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                            >
                              {formatDayHeader(m.created_at)}
                            </span>
                            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                          </div>
                        )}
                        {renderSystemTransactionCard(syntheticSystemMsg, fullTimestamp)}
                      </React.Fragment>
                    );
                  }

                  return (
                    <React.Fragment key={m.id}>
                      {showDaySeparator && (
                        <div className="flex items-center gap-3 py-2" role="separator">
                          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                          <span
                            className="px-3 py-1 rounded-full text-[11px] font-bold border shrink-0"
                            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                          >
                            {formatDayHeader(m.created_at)}
                          </span>
                          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                        </div>
                      )}

                      {m.message_type === 'system' ? (
                        renderSystemTransactionCard(m, fullTimestamp)
                      ) : (() => {
                        const mine = m.sender_id === profile.id;
                        const images: Array<{ url: string; expires_at?: string }> = Array.isArray(m.metadata?.images) ? m.metadata.images : [];
                        const isBodyPlaceholder = m.body === 'Shared photo' || m.body === '[Photo]';
                        return (
                          <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={`max-w-[85%] sm:max-w-[75%] px-3.5 py-2.5 rounded-2xl border text-[13.5px] sm:text-sm font-medium leading-relaxed shadow-xs ${
                                mine ? 'rounded-br-sm' : 'rounded-bl-sm'
                              }`}
                              style={
                                mine
                                  ? {
                                      background: 'var(--accent-muted)',
                                      borderColor: 'var(--accent-border)',
                                      color: 'var(--text-primary)',
                                    }
                                  : {
                                      background: 'var(--bg-surface-2)',
                                      borderColor: 'var(--border)',
                                      color: 'var(--text-primary)',
                                    }
                              }
                            >
                              {images.length > 0 && (
                                <div className="flex flex-col gap-2 mb-2">
                                  {images.map((img, i) => {
                                    const isExpired = img.expires_at ? new Date(img.expires_at).getTime() <= Date.now() : false;
                                    const isBroken = Boolean(brokenImages[img.url]);
                                    if (isExpired || isBroken) {
                                      return (
                                        <div
                                          key={i}
                                          className="flex items-center gap-2.5 p-3 rounded-xl border select-none opacity-80"
                                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
                                        >
                                          <svg className="w-5 h-5 shrink-0 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                            <circle cx="12" cy="12" r="10" />
                                            <polyline points="12 6 12 12 16 14" />
                                          </svg>
                                          <div className="flex flex-col text-xs">
                                            <span className="font-bold opacity-80">{isBroken ? 'Photo unavailable' : 'Photo expired'}</span>
                                            <span className="text-[11px] opacity-60">
                                              {isBroken ? 'Photo was deleted or could not be loaded' : '14-day retention limit reached'}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    }
                                    const daysLeft = img.expires_at ? Math.max(1, Math.ceil((new Date(img.expires_at).getTime() - Date.now()) / 86400000)) : 14;
                                    const allValidUrls = images
                                      .filter((im) => {
                                        const exp = im.expires_at ? new Date(im.expires_at).getTime() <= Date.now() : false;
                                        return !exp && !brokenImages[im.url];
                                      })
                                      .map((im) => im.url);
                                    const currentValidIndex = Math.max(0, allValidUrls.indexOf(img.url));

                                    return (
                                      <div key={i} className="relative group rounded-xl overflow-hidden border inline-block max-w-full" style={{ borderColor: 'var(--border)' }}>
                                        <button
                                          type="button"
                                          onClick={() => openImageViewer(img.url, 'Shared attachment', allValidUrls, currentValidIndex)}
                                          title="View full image"
                                          className="block cursor-zoom-in text-left transition hover:opacity-95"
                                        >
                                          <img
                                            src={img.url}
                                            alt="Shared attachment"
                                            loading="lazy"
                                            onError={() => setBrokenImages((prev) => ({ ...prev, [img.url]: true }))}
                                            className="max-h-64 sm:max-h-80 w-auto max-w-full rounded-xl object-contain bg-black/10"
                                          />
                                        </button>
                                        {img.expires_at && (
                                          <div
                                            className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md border shadow-xs flex items-center gap-1 select-none pointer-events-none"
                                            style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }}
                                          >
                                            <svg className="w-2.5 h-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                              <circle cx="12" cy="12" r="10" />
                                              <polyline points="12 6 12 12 16 14" />
                                            </svg>
                                            <span>{daysLeft}d left</span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {(!isBodyPlaceholder || images.length === 0) && (
                                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                              )}

                              <div
                                className="text-[11px] font-semibold mt-1.5 flex items-center justify-end gap-1.5 select-none"
                                style={{ color: 'var(--text-tertiary)' }}
                                title={fullTimestamp}
                              >
                                {mine && <span className="font-bold" style={{ color: 'var(--text-accent)' }}>You ·</span>}
                                <span>{formatMessageTime(m.created_at)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </React.Fragment>
                  );
                })
              )}
            </div>

            {/* Composer */}
            <div className="flex flex-col border-t shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
              {attachedFiles.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 border-b overflow-x-auto" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                  {attachedFiles.map((file, idx) => {
                    const objUrl = URL.createObjectURL(file);
                    return (
                      <div key={idx} className="relative w-14 h-14 rounded-lg overflow-hidden border shrink-0 group" style={{ borderColor: 'var(--border)' }}>
                        <img src={objUrl} alt="Preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeAttachedFile(idx)}
                          className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/75 text-white flex items-center justify-center cursor-pointer transition hover:bg-black"
                          title="Remove photo"
                        >
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                  <span className="text-[11px] font-semibold opacity-70 ml-1 shrink-0">
                    Photos auto-expire in 14 days
                  </span>
                </div>
              )}
              <form
                onSubmit={handleSend}
                className="flex items-end gap-2 p-3"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach photo (expires in 14 days)"
                  disabled={sending || uploadingImages}
                  className="h-10 w-10 rounded-xl border flex items-center justify-center cursor-pointer transition shrink-0 hover:bg-[var(--accent-muted)]/40 hover:border-[var(--accent-border)] disabled:opacity-50"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void submitDraft();
                    }
                  }}
                  placeholder="Write a message…"
                  maxLength={1000}
                  className="flex-1 border rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[var(--accent)] transition resize-none leading-snug overflow-y-hidden"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)', maxHeight: 130 }}
                />
                <button
                  type="submit"
                  disabled={(!draft.trim() && attachedFiles.length === 0) || sending || uploadingImages}
                  className="h-10 px-4 rounded-xl font-black text-xs transition cursor-pointer disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  <span>{uploadingImages ? 'Uploading…' : sending ? 'Sending…' : 'Send'}</span>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Temporary Removal Undo Toast */}
        {removedBanner && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2.5 rounded-xl border shadow-xl flex items-center gap-3 text-xs font-semibold max-w-[92vw]"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--accent-border, var(--border))', color: 'var(--text-primary)' }}
          >
            <span className="truncate">
              Removed <strong>{removedBanner.name}</strong> until your next transaction
            </span>
            <button
              type="button"
              onClick={handleUndoHide}
              className="px-2.5 py-1 rounded-lg font-black text-[11px] border cursor-pointer transition hover:brightness-110 shrink-0"
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
            >
              Undo
            </button>
          </div>
        )}
      </div>

      {selectedId && (
        <ReportModal
          open={showReportModal}
          onClose={() => setShowReportModal(false)}
          type="message"
          targetId={selectedId}
          targetName={`Conversation with ${selected?.counterpart_name || 'Collector'} (${selected?.card_name || 'Listing'})`}
          targetLink={typeof window !== 'undefined' ? `${window.location.pathname}?thread=${selectedId}` : ''}
        />
      )}

      <ImageViewer
        open={viewerOpen}
        src={viewerSrc}
        alt={viewerAlt}
        images={viewerImages}
        currentIndex={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerOpen(false)}
      />
    </div>
  );
}
