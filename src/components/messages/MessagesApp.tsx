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
  consolidateConversationMessages,
  localizeNoticeBody,
  CHAT_IMAGE_EXPIRY_DAYS,
} from '../../lib/messages';
import { subscribeUserRealtime, setActiveConversationId } from '../../lib/realtimeClient';
import { AuthModal } from '../auth/AuthModal';
import { HoldPanel } from './HoldPanel';
import { ReportModal } from '../common/ReportModal';
import { ImageViewer } from '../CardImageViewer';
import { useLanguage } from '../../lib/i18n';
import { getProfileUrl } from '../../lib/profileUrl';
import type { UserProfile, ChatMessage, ConversationSummary, Order } from '../../types';

/** Compact vertical padding around the page so the chat container gets maximum height. */
const PAGE_PAD_Y = 'clamp(10px, 1.5vw, 18px)';

const SAFETY_SYNC_MS = 3 * 60 * 1000; // Gentle fallback sync alongside live WebSocket updates

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Readable day header for grouping messages by date (full format, e.g. "október 22., csütörtök"). */
function formatDayHeader(iso: string, lang: string = 'hu'): string {
  const d = new Date(iso);
  if (lang === 'en') {
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
function formatMessageTime(iso: string, lang: string = 'hu'): string {
  const d = new Date(iso);
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return `${timeStr} · ${lang === 'hu' ? 'épp most' : 'just now'}`;
  if (mins < 60) return `${timeStr} · ${lang === 'hu' ? `${mins} perce` : `${mins}m ago`}`;
  return timeStr;
}

/** Sidebar timestamp: clock time if today, "Yesterday", weekday if <7d, or short date. */
function formatSidebarTime(iso: string, lang: string = 'hu'): string {
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

function formatHandoverBadgeLabel(methodId?: string | null, lang: string = 'en'): string | null {
  if (!methodId) return null;
  const isHu = lang === 'hu';
  switch (methodId) {
    case 'foxpost':
      return isHu ? 'Foxpost automata' : 'Foxpost Locker';
    case 'packeta':
      return isHu ? 'Packeta átvevőhely' : 'Packeta Point';
    case 'personal':
    case 'pickup':
      return isHu ? 'Személyes átvétel' : 'Personal Pickup';
    case 'post':
    case 'posta':
      return isHu ? 'Magyar Posta' : 'Post / Mail';
    case 'international':
      return isHu ? 'Nemzetközi szállítás' : 'International Shipping';
    default:
      if (methodId.startsWith('custom:')) return methodId.slice(7) || (isHu ? 'Egyéni átadás' : 'Custom Handover');
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
  kind: 'hold' | 'trade' | 'bulk' | 'auction' | 'store',
  lang: string = 'en'
): { label: string; tone: SystemTone } {
  const isHu = lang === 'hu';
  if (completed || action === 'auto_completed' || action === 'confirm_sale') {
    return {
      label: kind === 'trade' ? (isHu ? 'Csere lezárult' : 'Trade Completed') : (isHu ? 'Lezárult' : 'Completed'),
      tone: 'emerald',
    };
  }
  switch (action) {
    case 'requested':
      return {
        label: kind === 'bulk' ? (isHu ? 'Bulk félretétel kérve' : 'Bulk Hold Requested') : (isHu ? 'Félretétel kérve' : 'Hold Requested'),
        tone: 'amber',
      };
    case 'trade_proposed':
      return { label: isHu ? 'Csere javasolva' : 'Trade Proposed', tone: 'amber' };
    case 'auction_won':
      return { label: isHu ? 'Megnyert aukció' : 'Auction Won', tone: 'purple' };
    case 'hold':
      return {
        label: kind === 'trade' ? (isHu ? 'Csere félretéve' : 'Trade On Hold') : (isHu ? 'Lefoglalva / Félretéve' : 'Reserved / On Hold'),
        tone: 'blue',
      };
    case 'mark_handed_over':
      return { label: isHu ? 'Átadva / Feladva' : 'Handed Over / Sent', tone: 'purple' };
    case 'update_tracking':
      return { label: isHu ? 'Csomagkövetés frissítve' : 'Tracking Updated', tone: 'purple' };
    case 'confirm_received':
      return { label: isHu ? 'Átvéve' : 'Received', tone: 'emerald' };
    case 'release':
      return { label: isHu ? 'Félretétel feloldva' : 'Hold Released', tone: 'neutral' };
    case 'reject':
      return { label: isHu ? 'Elutasítva' : 'Declined', tone: 'red' };
    case 'deny':
    case 'auction_cancelled':
      return { label: isHu ? 'Törölve' : 'Cancelled', tone: 'red' };
    case 'expired':
      return { label: isHu ? 'Lejárt' : 'Expired', tone: 'neutral' };
    default:
      return { label: isHu ? 'Rendelés frissítés' : 'Order Update', tone: 'neutral' };
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

function renderRoleBadge(isSeller: boolean, customLabel?: string, lang: string = 'en') {
  const isHu = lang === 'hu';
  const text = customLabel || (isSeller ? (isHu ? 'Te: Eladó' : 'You: Seller') : (isHu ? 'Te: Vevő' : 'You: Buyer'));
  return (
    <span
      className="text-[10px] font-black px-2 py-0.5 rounded-full border shrink-0 inline-flex items-center gap-1 uppercase tracking-wider select-none"
      style={
        isSeller
          ? {
              background: 'rgba(234, 88, 12, 0.15)',
              borderColor: 'rgba(234, 88, 12, 0.45)',
              color: '#fb923c',
            }
          : {
              background: 'rgba(59, 130, 246, 0.15)',
              borderColor: 'rgba(59, 130, 246, 0.45)',
              color: '#60a5fa',
            }
      }
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      <span>{text}</span>
    </span>
  );
}

export function MessagesApp() {
  const { t, lang } = useLanguage();
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
      alert(lang === 'hu' ? 'Csak PNG, JPG vagy WebP formátumú, legfeljebb 10 MB méretű képek támogatottak.' : 'Only PNG, JPG, or WebP images up to 10MB are supported.');
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
    if (!session?.access_token) throw new Error(lang === 'hu' ? 'Nincs bejelentkezve.' : 'Not authenticated.');

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
      throw new Error(data.error || (lang === 'hu' ? 'A kép(ek) feltöltése sikertelen.' : 'Failed to upload image(s).'));
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
  const isNearBottomRef = useRef(true);
  const prevLastMsgIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [holdRefreshTick, setHoldRefreshTick] = useState(0);

  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceToBottom <= 120;
    isNearBottomRef.current = near;
    setShowScrollBottomBtn(!near);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    bottomAnchorRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
    isNearBottomRef.current = true;
    setShowScrollBottomBtn(false);
  }, []);

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

      setMessages((prev) => {
        if (
          prev.length === list.length &&
          prev[prev.length - 1]?.id === list[list.length - 1]?.id &&
          prev[0]?.id === list[0]?.id
        ) {
          const hasChange = prev.some((m, idx) => {
            const next = list[idx];
            return !next || m.id !== next.id || m.read_at !== next.read_at || m.body !== next.body;
          });
          if (!hasChange) return prev;
        }
        return list;
      });
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
    setActiveConversationId(selectedId);
    return () => setActiveConversationId(null);
  }, [selectedId]);

  // Real-time WebSocket subscription for incoming chat messages, transaction notices, holds, and reviews
  useEffect(() => {
    if (!profile?.id) return;

    const unsubscribe = subscribeUserRealtime(profile.id, (evt) => {
      const currentSelected = selectedIdRef.current;

      if ((evt.type === 'chat_message' || evt.type === 'system_notice') && evt.message) {
        const incoming = evt.message;
        if (currentSelected && evt.conversation_id === currentSelected) {
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id)
              ? prev.map((m) => (m.id === incoming.id ? incoming : m))
              : [...prev, incoming]
          );

          if (evt.type === 'system_notice') {
            loadThread(currentSelected);
            setHoldRefreshTick((n) => n + 1);
          } else if (
            incoming.sender_id !== profile.id &&
            (typeof document === 'undefined' || document.visibilityState === 'visible')
          ) {
            markThreadRead(currentSelected).then(() => {
              setConversations((prev) =>
                prev.map((c) =>
                  c.conversation_id === currentSelected ? { ...c, unread_count: 0 } : c
                )
              );
            });
          }
        }
        loadConversations(currentSelected);
        return;
      }

      if (evt.type === 'hold_changed') {
        if (currentSelected && (!evt.conversation_id || evt.conversation_id === currentSelected)) {
          loadThread(currentSelected);
          setHoldRefreshTick((n) => n + 1);
        }
        loadConversations(currentSelected);
        return;
      }

      if (evt.type === 'review_created') {
        setHoldRefreshTick((n) => n + 1);
        return;
      }

      if (evt.type === 'thread_read' && evt.conversation_id) {
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === evt.conversation_id ? { ...c, unread_count: 0 } : c
          )
        );
      }
    });

    const handleVisibilityOrOnline = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        const currentSelected = selectedIdRef.current;
        loadConversations(currentSelected);
        if (currentSelected) loadThread(currentSelected);
      }
    };

    window.addEventListener('online', handleVisibilityOrOnline);
    document.addEventListener('visibilitychange', handleVisibilityOrOnline);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleVisibilityOrOnline);
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
    };
  }, [profile?.id, loadConversations, loadThread]);

  // Low-frequency safety sync while tab is visible (in case of prolonged offline sleep)
  useEffect(() => {
    if (!profile) return;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        const currentSelected = selectedIdRef.current;
        loadConversations(currentSelected);
        if (currentSelected) loadThread(currentSelected);
      }
    }, SAFETY_SYNC_MS);
    return () => clearInterval(timer);
  }, [profile, loadConversations, loadThread]);

  useEffect(() => {
    scrolledForRef.current = null;
    prevLastMsgIdRef.current = null;
    if (!selectedId) {
      setThreadHolds([]);
      return;
    }
    setLoadingThread(true);
    loadThread(selectedId);
  }, [selectedId, loadThread]);

  useEffect(() => {
    return () => {
      if (removedTimerRef.current) clearTimeout(removedTimerRef.current);
    };
  }, []);

  const handleHideConversation = async (c: ConversationSummary, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (c.has_open_request) {
      const ok = window.confirm(
        lang === 'hu'
          ? `Még van aktív félretételi kérelmed vele: ${c.counterpart_name}. Biztosan elrejted ezt a beszélgetést? Új aktivitás vagy tranzakció esetén automatikusan újra megjelenik.`
          : `You still have an open hold request with ${c.counterpart_name}. Hide this conversation from Messages anyway? It will reappear automatically when there is new activity or a new transaction.`
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
      const targetConv = conversations.find((c) => c.conversation_id === selectedId);
      const { message, error } = await sendMessage(selectedId, body, metadata, {
        counterpartId: targetConv?.counterpart_id || null,
        senderName: profile?.display_name || null,
        senderAvatar: profile?.avatar_url || null,
      });
      if (message) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
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
        alert(error?.message || (lang === 'hu' ? 'Nem sikerült elküldeni az üzenetet.' : 'Failed to send message.'));
      }
    } catch (err: any) {
      setDraft(body);
      setAttachedFiles(filesToSend);
      alert(err?.message || (lang === 'hu' ? 'Nem sikerült elküldeni az üzenetet.' : 'Failed to send message.'));
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

  // Consolidate system messages to strictly 1 container per order, dynamically updated to reflect the latest state
  const visibleMessages = useMemo(() => {
    return consolidateConversationMessages(messages, {
      threadHolds,
      threadOrders,
    });
  }, [messages, threadHolds, threadOrders]);

  // Scrolls the message list to the absolute bottom when opening a thread,
  // when the user sends a message, or when new messages arrive while already at the bottom.
  useEffect(() => {
    const el = threadRef.current;
    if (!el || loadingThread || !selectedId) return;

    const opened = scrolledForRef.current !== selectedId;
    const lastMsg = visibleMessages[visibleMessages.length - 1];
    const lastMsgId = lastMsg?.id || null;
    const isNewMessage = Boolean(lastMsgId && lastMsgId !== prevLastMsgIdRef.current);
    prevLastMsgIdRef.current = lastMsgId;

    if (opened) {
      scrolledForRef.current = selectedId;
      isNearBottomRef.current = true;
      setShowScrollBottomBtn(false);

      // Instant jump to bottom
      scrollToBottom(false);

      // Multi-pass re-scrolls to account for late-loading images, custom cards, and fonts
      const raf = requestAnimationFrame(() => {
        scrollToBottom(false);
      });
      const t1 = setTimeout(() => scrollToBottom(false), 50);
      const t2 = setTimeout(() => scrollToBottom(false), 150);
      const t3 = setTimeout(() => scrollToBottom(false), 350);

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    if (!isNewMessage) return;

    const isMyMessage = lastMsg?.sender_id === profile?.id;
    if (isMyMessage || isNearBottomRef.current) {
      scrollToBottom(true);
      const t = setTimeout(() => scrollToBottom(true), 80);
      return () => clearTimeout(t);
    }
  }, [visibleMessages, loadingThread, selectedId, profile?.id, scrollToBottom]);

  // Keep glued to bottom on content resizing if user was already at bottom
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    if (el.firstElementChild) {
      ro.observe(el.firstElementChild);
    }
    return () => ro.disconnect();
  }, [selectedId, loadingThread]);

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
            {t('Messages', 'Üzenetek')}
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
            {t('Sign in to message buyers and sellers about your marketplace holds.', 'Jelentkezz be a vevőkkel és eladókkal való üzenetváltáshoz és félretételi egyeztetésekhez.')}
          </p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-6 py-3 font-black rounded-xl text-sm transition shadow-md cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {t('Sign In', 'Bejelentkezés')}
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
        dest.labelKey === 'store_admin' ? t('Open Store Admin', 'Store Admin megnyitása') : t('Open in Order History', 'Megnyitás a Rendelési előzményekben');

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
                    {t('Store Shipment', 'Webshop csomagküldés')}
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
                  {t('Shipped', 'Feladva')}
                </span>
              </div>

              {trackingNum && (
                <div
                  className="mt-2.5 p-2.5 rounded-xl border flex items-center justify-between gap-2"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                >
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-wider block" style={{ color: 'var(--text-accent)' }}>
                      {t('Tracking', 'Nyomkövetés')} {courierName ? `(${courierName})` : ''}
                    </span>
                    <span className="text-xs font-mono font-black break-all" style={{ color: 'var(--text-primary)' }}>
                      {trackingNum}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-2.5 pt-2 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }} title={fullTimestamp}>
                  {formatMessageTime(m.created_at, lang)}
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
                    {t('Official Store Order', 'Hivatalos Webshop Rendelés')}
                  </span>
                  {orderNum && (
                    <span className="font-mono font-bold text-[10px] block" style={{ color: 'var(--text-tertiary)' }}>
                      #{orderNum}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {renderRoleBadge(isStoreOwner, isStoreOwner ? (lang === 'hu' ? 'Te: Boltvezető' : 'You: Store Owner') : (lang === 'hu' ? 'Te: Vevő' : 'You: Buyer'), lang)}
                <span
                  className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border shrink-0"
                  style={{ background: badgeColors.bg, borderColor: badgeColors.border, color: badgeColors.color }}
                >
                  {t(liveStatus, liveStatus === 'Delivered' ? 'Kézbesítve' : liveStatus === 'Shipped' ? 'Feladva' : liveStatus === 'Processing' ? 'Feldolgozás alatt' : liveStatus === 'Cancelled' ? 'Törölve' : 'Függőben')}
                </span>
              </div>
            </div>

            {storeItems.length > 0 && (
              <div className="py-2.5 space-y-2 max-h-44 overflow-y-auto">
                {storeItems.slice(0, 4).map((it: any, itemIdx: number) => {
                  const imgSrc = it.image || it.image_path;
                  const itemName = it.name || it.card_name || t('Store Item', 'Termék');
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
                    +{storeItems.length - 4} {lang === 'hu' ? 'további termék' : 'more item(s)'}
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
                  {t('Tracking', 'Nyomkövetés')}{courierName ? ` (${courierName})` : ''}
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
                  · {formatMessageTime(m.created_at, lang)}
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

      // 4. Clean card_name substring or trade pair match in body
      if (!linkedHold) {
        linkedHold = threadHolds.find((h) => {
          const raw = String(h.card_name || '');
          const hClean = raw.replace(/^\[(Auction|Trade|Bulk)\]\s*/i, '').trim();
          if (hClean.includes('⇄')) {
            const [s1, s2] = hClean.split('⇄').map((s) => s.trim().toLowerCase());
            const bLow = (m.body || '').toLowerCase();
            return s1 && s2 && bLow.includes(s1) && bLow.includes(s2);
          }
          return hClean.length >= 3 && (m.body || '').toLowerCase().includes(hClean.toLowerCase());
        }) || null;
      }

      // 5. If only 1 hold exists in the thread - verify transaction type compatibility
      if (!linkedHold && threadHolds.length === 1) {
        const only = threadHolds[0];
        const isTradeHold = only.card_number === 'TRADE' || String(only.card_name || '').startsWith('[Trade]');
        const isAuctionHold = only.card_number === 'AUCTION' || String(only.card_name || '').startsWith('[Auction]');
        const isTradeMsg = meta.kind === 'trade' || /trade/i.test(m.body || '');
        const isAuctionMsg = meta.kind === 'auction' || /auction/i.test(m.body || '');
        if (isTradeMsg === isTradeHold && isAuctionMsg === isAuctionHold) {
          linkedHold = only;
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
    const ctaLabel = dest.labelKey === 'seller_hub' ? t('Open in Seller Hub', 'Megnyitás az Eladói központban') : t('Open in Order History', 'Megnyitás a Rendelési előzményekben');

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

    const liveStatus = linkedHold?.status;
    let currentAction = inferredAction;
    if (liveStatus) {
      if (liveStatus === 'completed') currentAction = 'confirm_sale';
      else if (liveStatus === 'buyer_received') currentAction = 'confirm_received';
      else if (liveStatus === 'handed_over') currentAction = 'mark_handed_over';
      else if (liveStatus === 'accepted') currentAction = 'hold';
      else if (liveStatus === 'pending') {
        if (!currentAction || currentAction === 'hold') currentAction = 'requested';
      } else if (liveStatus === 'rejected') currentAction = 'reject';
      else if (liveStatus === 'cancelled') currentAction = 'auction_cancelled';
      else if (liveStatus === 'expired') currentAction = 'expired';
    }

    const action: string | undefined = currentAction;
    const isCompletedEvent = Boolean(
      meta.completed ||
        liveStatus === 'completed' ||
        action === 'auto_completed' ||
        action === 'confirm_sale' ||
        (action === 'confirm_received' && (/completed/i.test(m.body) || liveStatus === 'completed'))
    );

    const badge = getActionBadgeInfo(action, isCompletedEvent, kind, lang);
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
      linkedHold?.tracking_number ||
      linkedOrder?.tracking_number ||
      null;

    const isInitialBoilerplate = /^(Requested a hold on|Proposed a trade:|Bulk Hold Request|\[Auction Won\])/i.test(m.body || '');
    const statusNote = !isInitialBoilerplate && m.body ? localizeNoticeBody(m.body, lang) : null;
    const handoverLabelText = formatHandoverBadgeLabel(
      meta.handover || linkedHold?.preferred_handover || linkedOrder?.shipping_method,
      lang
    );
    const handoverDetailsText: string | null =
      typeof meta.handover_details === 'string' && meta.handover_details
        ? meta.handover_details
        : action === 'requested' && linkedHold?.handover_details
        ? linkedHold.handover_details
        : null;

    const isHu = lang === 'hu';
    const kindHeaderLabel =
      kind === 'trade'
        ? t('Card Trade', 'Kártya csere')
        : kind === 'bulk'
        ? 'Bulk Lot'
        : kind === 'auction'
        ? t('Auction', 'Aukció')
        : rawItems.length > 1
        ? (isHu ? `Kosár félretétel (${rawItems.length} kártya)` : `Cart Hold (${rawItems.length} cards)`)
        : t('Marketplace Hold', 'Piactéri félretétel');

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

    // ─── Single Unified Rich Card for Orders / Holds / Trades / Auctions ───
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
    if (kind === 'trade' && (!offeredName || !wantedName)) {
      const mTo = (m.body || '').match(/\[Trade Proposal\]\s*([^\n]+?)\s+to\s+([^\n]+)/i);
      if (mTo) {
        offeredName = offeredName || mTo[1].trim();
        wantedName = wantedName || mTo[2].replace(/"[^"]*"$/, '').trim();
      } else {
        const mFor = (m.body || '').match(/saw your trade listing for\s+([^,.\n]+?)\s+and I would like to trade\s+([^,.\n]+?)\s+for it/i);
        if (mFor) {
          offeredName = offeredName || mFor[2].trim();
          wantedName = wantedName || mFor[1].trim();
        } else {
          const mProp = (m.body || '').match(/Proposed a trade:\s*([^,.\n]+?)\s+for\s+([^,.\n]+)/i);
          if (mProp) {
            offeredName = offeredName || mProp[1].trim();
            wantedName = wantedName || mProp[2].trim();
          }
        }
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
            <div className="flex items-center gap-1.5 shrink-0">
              {renderRoleBadge(isTxSeller, undefined, lang)}
              <span
                className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border shrink-0"
                style={{ background: badgeStyle.bg, borderColor: badgeStyle.border, color: badgeStyle.color }}
              >
                {badge.label}
              </span>
            </div>
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
                    {t('Offering', 'Kínál')}
                  </span>
                  <span className="font-bold text-[11px] block truncate" style={{ color: 'var(--text-primary)' }} title={offeredName || ''}>
                    {offeredName || t('Card', 'Kártya')}
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
                    {t('Wanted', 'Keres')}
                  </span>
                  <span className="font-bold text-[11px] block truncate" style={{ color: 'var(--text-primary)' }} title={wantedName || ''}>
                    {wantedName || t('Card', 'Kártya')}
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
              {localizeNoticeBody(m.body, lang)}
            </div>
          )}

          {/* Dynamic Status Update Note */}
          {statusNote && (
            <div
              className="mb-2.5 p-2.5 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                style={{ background: badgeStyle.color }}
              />
              <span className="flex-1 break-words whitespace-pre-line font-medium">
                {statusNote}
              </span>
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
                      +{shippingHuf.toLocaleString('hu-HU')} Ft {lang === 'hu' ? 'szállítás' : 'shipping'}
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
                    {t('Tracking', 'Nyomkövetés')}
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
                    ? t('Even Trade', 'Egyenértékű csere')
                    : `${totalHuf.toLocaleString('hu-HU')} Ft`}
                </span>
              )}
              <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-tertiary)' }} title={fullTimestamp}>
                {totalHuf !== null ? '· ' : ''}
                {formatMessageTime(m.created_at, lang)}
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
                placeholder={t('Search user, card, or message…', 'Felhasználó, kártya vagy üzenet keresése…')}
                className="w-full h-9 pl-8 pr-3 rounded-xl text-xs font-semibold border outline-none focus:border-[var(--accent)] transition"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {([
                { id: 'all' as const, label: t('All', 'Mind'), count: conversations.length },
                { id: 'unread' as const, label: t('Unread', 'Olvasatlan'), count: unreadTotal },
                { id: 'holds' as const, label: t('Open Holds', 'Nyitott tételek'), count: openHoldsTotal },
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
                {t('Loading conversations…', 'Beszélgetések betöltése…')}
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                {conversations.length === 0
                  ? t('No conversations yet. Requesting or receiving a hold on a marketplace card starts a thread here.', 'Még nincsenek beszélgetések. Félretétel kérésekor vagy indításakor itt jön létre beszélgetés.')
                  : t('No conversations match your filter.', 'Nincs a szűrőnek megfelelő beszélgetés.')}
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
                          title={t('Open hold request', 'Nyitott félretételi kérelem')}
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
                              {formatSidebarTime(c.last_message_at, lang)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleHideConversation(c, e)}
                            title={t('Remove from messages until next transaction', 'Beszélgetés elrejtése a következő tranzakcióig')}
                            aria-label={lang === 'hu' ? `${c.counterpart_name} elrejtése az üzenetekből` : `Remove ${c.counterpart_name} from messages`}
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
                        {c.last_message || t('No messages yet', 'Még nincsenek üzenetek')}
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
              {t('Select a conversation', 'Válassz egy beszélgetést')}
            </div>
            <div className="text-xs max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('Choose a thread on the left to coordinate payment, meetup details, or parcel tracking.', 'Válassz egy beszélgetést a bal oldalon a fizetés, átadás vagy csomagkövetés egyeztetéséhez.')}
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
                aria-label={t('Back to conversation list', 'Vissza a beszélgetések listájához')}
                className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border shrink-0"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-input)' }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              {selected?.counterpart_id ? (
                <a href={getProfileUrl({ id: selected.counterpart_id, display_name: selected.counterpart_name })} className="shrink-0" title={t('View user profile', 'Felhasználói profil megtekintése')}>
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
                      href={getProfileUrl({ id: selected.counterpart_id, display_name: selected.counterpart_name })}
                      className="text-sm font-black truncate hover:underline inline-flex items-center gap-1"
                      style={{ color: 'var(--text-primary)' }}
                      title={t('View user profile and ratings', 'Felhasználói profil és értékelések megtekintése')}
                    >
                      <span>{selected.counterpart_name || t('Conversation', 'Beszélgetés')}</span>
                      <svg className="w-3.5 h-3.5 opacity-60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ) : (
                    <span className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>
                      {selected?.counterpart_name || t('Conversation', 'Beszélgetés')}
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
                    {t('Open hold', 'Nyitott tétel')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    loadThread(selectedId);
                    loadConversations(selectedId);
                  }}
                  title={t('Refresh messages', 'Üzenetek frissítése')}
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
                    title={t('Remove from messages until next transaction', 'Beszélgetés elrejtése a következő tranzakcióig')}
                    className="h-8 px-2.5 rounded-lg border flex items-center gap-1.5 cursor-pointer transition hover:bg-[var(--bg-raised)] text-xs font-semibold"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    <span className="hidden lg:inline">{t('Hide', 'Elrejtés')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  title={t('Report this conversation to moderators', 'Beszélgetés jelentése a moderátoroknak')}
                  className="h-8 px-2.5 rounded-lg border flex items-center gap-1.5 cursor-pointer transition hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400 text-xs font-semibold"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                  </svg>
                  <span className="hidden sm:inline">{t('Report', 'Jelentés')}</span>
                </button>
              </div>
            </div>

            <HoldPanel
              conversationId={selectedId}
              myId={profile.id}
              counterpartId={selected?.counterpart_id}
              counterpartName={selected?.counterpart_name}
              refreshKey={messages.length + holdRefreshTick}
              onChanged={() => {
                loadThread(selectedId);
                loadConversations(selectedId);
              }}
            />

            {/* Message History */}
            <div className="flex-1 min-h-0 relative flex flex-col">
              <div
                ref={threadRef}
                onScroll={handleThreadScroll}
                className="flex-1 overflow-y-auto px-4 py-4"
              >
                <div className="space-y-3">
              {loadingThread ? (
                <div className="text-center text-xs font-semibold py-8" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Loading messages…', 'Üzenetek betöltése…')}
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="text-center text-xs py-12" style={{ color: 'var(--text-tertiary)' }}>
                  {t('No messages yet — say hello!', 'Még nincsenek üzenetek — köszönj rá!')}
                </div>
              ) : (
                visibleMessages.map((m, idx) => {
                  const prev = idx > 0 ? visibleMessages[idx - 1] : null;
                  const showDaySeparator = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
                  const fullTimestamp = new Date(m.created_at).toLocaleString('en-GB', { hour12: false });

                  // Detect legacy user-typed pseudo-system messages from earlier trade/bulk/auction flows
                  const isLegacyTxPrefix =
                    m.message_type === 'user' &&
                    /^\[(Trade Proposal|Bulk Hold Request|Auction Won)\]/i.test(m.body || '');

                  if (isLegacyTxPrefix) {
                    const isTrade = /^\[Trade Proposal\]/i.test(m.body || '');
                    const isAuction = /^\[Auction Won\]/i.test(m.body || '');
                    const isBulk = /^\[Bulk Hold Request\]/i.test(m.body || '');

                    let matchedHold = threadHolds.find((h) => h.message && h.message === m.body) || null;

                    if (!matchedHold && isTrade) {
                      matchedHold = threadHolds.find((h) => {
                        const isTradeHold = h.card_number === 'TRADE' || String(h.card_name || '').startsWith('[Trade]');
                        if (!isTradeHold) return false;
                        const clean = String(h.card_name || '').replace(/^\[Trade\]\s*/i, '');
                        if (clean.includes('⇄')) {
                          const [s1, s2] = clean.split('⇄').map((s) => s.trim().toLowerCase());
                          const bLow = (m.body || '').toLowerCase();
                          return s1 && s2 && bLow.includes(s1) && bLow.includes(s2);
                        }
                        return false;
                      }) || null;
                    }

                    if (!matchedHold && isAuction) {
                      matchedHold = threadHolds.find((h) => {
                        const isAuctionHold = h.card_number === 'AUCTION' || String(h.card_name || '').startsWith('[Auction]');
                        if (!isAuctionHold) return false;
                        const clean = String(h.card_name || '').replace(/^\[Auction\]\s*/i, '').trim().toLowerCase();
                        return clean.length >= 3 && (m.body || '').toLowerCase().includes(clean);
                      }) || null;
                    }

                    if (!matchedHold && isBulk) {
                      matchedHold = threadHolds.find((h) => {
                        return h.card_number === 'BULK' || String(h.card_name || '').startsWith('[Bulk]');
                      }) || null;
                    }

                    let tradeOffered: string | null = null;
                    let tradeWanted: string | null = null;
                    if (isTrade) {
                      const mTo = (m.body || '').match(/\[Trade Proposal\]\s*([^\n]+?)\s+to\s+([^\n]+)/i);
                      if (mTo) {
                        tradeOffered = mTo[1].trim();
                        tradeWanted = mTo[2].replace(/"[^"]*"$/, '').trim();
                      } else {
                        const mFor = (m.body || '').match(/saw your trade listing for\s+([^,.\n]+?)\s+and I would like to trade\s+([^,.\n]+?)\s+for it/i);
                        if (mFor) {
                          tradeOffered = mFor[2].trim();
                          tradeWanted = mFor[1].trim();
                        }
                      }
                    }

                    const syntheticSystemMsg: ChatMessage = {
                      ...m,
                      message_type: 'system',
                      hold_request_id: m.hold_request_id || matchedHold?.id || null,
                      metadata: {
                        ...(m.metadata || {}),
                        action: isTrade
                          ? 'trade_proposed'
                          : isAuction
                          ? 'auction_won'
                          : 'requested',
                        kind: isTrade
                          ? 'trade'
                          : isAuction
                          ? 'auction'
                          : 'bulk',
                        ...(tradeOffered ? { offered_name: tradeOffered } : {}),
                        ...(tradeWanted ? { wanted_name: tradeWanted } : {}),
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
                              {formatDayHeader(m.created_at, lang)}
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
                            {formatDayHeader(m.created_at, lang)}
                          </span>
                          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                        </div>
                      )}

                      {m.message_type === 'system' ? (
                        renderSystemTransactionCard(m, fullTimestamp)
                      ) : (() => {
                        const mine = m.sender_id === profile.id;
                        const images: Array<{ url: string; expires_at?: string }> = Array.isArray(m.metadata?.images) ? m.metadata.images : [];
                        const isBodyPlaceholder = m.body === 'Shared photo' || m.body === '[Photo]' || m.body === 'Megosztott fotó';
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
                                            <span className="font-bold opacity-80">{isBroken ? t('Photo unavailable', 'A fotó nem érhető el') : t('Photo expired', 'A fotó lejárt')}</span>
                                            <span className="text-[11px] opacity-60">
                                              {isBroken ? t('Photo was deleted or could not be loaded', 'A fotó törölve lett vagy nem tölthető be') : t('14-day retention limit reached', 'A 14 napos tárolási időtartam lejárt')}
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
                                            <span>{daysLeft}{lang === 'hu' ? ' nap' : 'd left'}</span>
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
                                {mine && <span className="font-bold" style={{ color: 'var(--text-accent)' }}>{t('You', 'Te')} · </span>}
                                <span>{formatMessageTime(m.created_at, lang)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </React.Fragment>
                  );
                })
              )}
                  <div ref={bottomAnchorRef} className="h-0 w-full shrink-0" aria-hidden="true" />
                </div>
              </div>

              {showScrollBottomBtn && (
                <div className="absolute bottom-3 right-4 z-20">
                  <button
                    type="button"
                    onClick={() => scrollToBottom(true)}
                    className="px-3 py-1.5 rounded-full border shadow-lg flex items-center gap-1.5 text-xs font-bold transition hover:scale-105 active:scale-95 cursor-pointer select-none backdrop-blur-md"
                    style={{
                      background: 'var(--bg-surface-2)',
                      borderColor: 'var(--accent-border, var(--border))',
                      color: 'var(--text-accent)',
                    }}
                    title={t('Scroll to latest messages', 'Görgetés a legújabb üzenetekhez')}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    <span>{t('Latest', 'Legújabb')}</span>
                  </button>
                </div>
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
                          title={t('Remove photo', 'Fotó eltávolítása')}
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
                    {t('Photos auto-expire in 14 days', 'A képek 14 nap után automatikusan lejárnak')}
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
                  title={t('Attach photo (expires in 14 days)', 'Fotó csatolása (14 nap után lejár)')}
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
                  placeholder={t('Write a message…', 'Írj egy üzenetet…')}
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
                  <span>{uploadingImages ? t('Uploading…', 'Feltöltés…') : sending ? t('Sending…', 'Küldés…') : t('Send', 'Küldés')}</span>
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
              {lang === 'hu' ? (
                <><strong>{removedBanner.name}</strong> elrejtve a következő tranzakcióig</>
              ) : (
                <>Removed <strong>{removedBanner.name}</strong> until your next transaction</>
              )}
            </span>
            <button
              type="button"
              onClick={handleUndoHide}
              className="px-2.5 py-1 rounded-lg font-black text-[11px] border cursor-pointer transition hover:brightness-110 shrink-0"
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
            >
              {t('Undo', 'Visszavonás')}
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
          targetName={lang === 'hu' ? `Beszélgetés vele: ${selected?.counterpart_name || 'Gyűjtő'} (${selected?.card_name || 'Hirdetés'})` : `Conversation with ${selected?.counterpart_name || 'Collector'} (${selected?.card_name || 'Listing'})`}
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
