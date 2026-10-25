import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getCurrentProfile } from '../../lib/auth';
import { supabase, cardThumbProps } from '../../lib/supabase';
import { fetchConversations, fetchMessages, sendMessage, markThreadRead, resolveConversationIdFromHoldRequest, CHAT_IMAGE_EXPIRY_DAYS } from '../../lib/messages';
import { AuthModal } from '../auth/AuthModal';
import { HoldPanel } from './HoldPanel';
import { ReportModal } from '../common/ReportModal';
import type { UserProfile, ChatMessage, ConversationSummary } from '../../types';

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
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
    } catch (e) {
      console.warn('Failed to load conversations:', e);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const loadThread = useCallback(async (conversationId: string) => {
    try {
      const list = await fetchMessages(conversationId);
      setMessages(list);
      markThreadRead(conversationId).then(() => {
        setConversations((prev) => prev.map((c) => (c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c)));
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
        const conversationParam = params.get('conversation_id') || params.get('conversation');
        const holdRequestParam = params.get('hold_request_id');
        if (conversationParam) {
          setSelectedId(conversationParam);
        } else if (holdRequestParam) {
          const resolved = await resolveConversationIdFromHoldRequest(holdRequestParam);
          if (resolved) setSelectedId(resolved);
        }
        loadConversations();
      }
    });
  }, [loadConversations]);

  useEffect(() => {
    if (!profile) return;
    const timer = setInterval(loadConversations, INBOX_POLL_MS);
    return () => clearInterval(timer);
  }, [profile, loadConversations]);

  useEffect(() => {
    if (!selectedId) return;
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
              ? { ...c, last_message: message.body, last_message_at: message.created_at }
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

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + (c.unread_count > 0 ? 1 : 0), 0), [conversations]);
  const openHoldsTotal = useMemo(() => conversations.reduce((s, c) => s + (c.has_open_request ? 1 : 0), 0), [conversations]);

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

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: `${PAGE_PAD_Y} clamp(12px,2.5vw,24px)` }}>
      <div
        className="rounded-2xl border overflow-hidden grid grid-cols-1 md:grid-cols-[340px_1fr]"
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
                  <button
                    key={c.conversation_id}
                    type="button"
                    onClick={() => setSelectedId(c.conversation_id)}
                    className="w-full flex items-center gap-3 p-3.5 text-left border-b transition cursor-pointer"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background: isSelected ? 'var(--accent-muted)' : undefined,
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    <div
                      className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-zinc-950 flex items-center justify-center border relative"
                      style={{ borderColor: isSelected ? 'var(--accent-border)' : 'var(--border)' }}
                    >
                      {c.image_path ? (
                        <img {...cardThumbProps(c.image_path, 'avatar')} alt={c.card_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[9px] font-mono text-zinc-400">TCG</span>
                      )}
                      {c.has_open_request && (
                        <span
                          className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2"
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
                        {c.last_message_at && (
                          <span
                            className="text-[11px] font-semibold shrink-0"
                            style={{ color: hasUnread ? 'var(--text-accent)' : 'var(--text-tertiary)' }}
                            title={new Date(c.last_message_at).toLocaleString('en-GB', { hour12: false })}
                          >
                            {formatSidebarTime(c.last_message_at)}
                          </span>
                        )}
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
                  </button>
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

              {selected?.image_path && (
                <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-zinc-950 border hidden sm:block" style={{ borderColor: 'var(--border)' }}>
                  <img {...cardThumbProps(selected.image_path, 'avatar')} alt={selected.card_name} className="w-full h-full object-cover" />
                </div>
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
                    className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border"
                    style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                  >
                    Open hold
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => { loadThread(selectedId); loadConversations(); }}
                  title="Refresh messages"
                  className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
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
              onChanged={() => { loadThread(selectedId); loadConversations(); }}
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
                        <div className="flex flex-col items-center gap-1.5 py-1">
                          {m.metadata?.store_order && m.metadata.status === 'Delivered' ? (
                            <div
                              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border my-1"
                              style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
                            >
                              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span>Order #{m.metadata.order_number} completed</span>
                              <span
                                className="text-[11px] font-bold opacity-75"
                                title={fullTimestamp}
                              >
                                · {formatMessageTime(m.created_at)}
                              </span>
                            </div>
                          ) : (
                            <>
                              <div
                                className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-center border inline-flex flex-wrap items-center justify-center gap-2 max-w-[92%]"
                                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                              >
                                <span>{m.body}</span>
                                <span
                                  className="text-[11px] font-bold"
                                  style={{ color: 'var(--text-tertiary)' }}
                                  title={fullTimestamp}
                                >
                                  · {formatMessageTime(m.created_at)}
                                </span>
                              </div>
                              {m.metadata?.store_order && (
                                m.metadata.is_tracking_update ? (
                              <div
                                className="w-full max-w-sm rounded-2xl border p-3.5 text-xs shadow-xs my-1 space-y-2.5"
                                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                              >
                                <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border"
                                      style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border, var(--border))', color: 'var(--text-accent, var(--text-primary))' }}
                                    >
                                      Store Update
                                    </span>
                                    <span className="font-mono font-black" style={{ color: 'var(--text-primary)' }}>
                                      #{m.metadata.order_number}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400">
                                    Feladva / Shipped
                                  </span>
                                </div>

                                <div className="p-3 rounded-xl border flex flex-col gap-1" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border, var(--border))' }}>
                                  <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
                                    Csomagkövetési szám {m.metadata.courier_name ? `(${m.metadata.courier_name})` : ''}:
                                  </span>
                                  <span className="text-sm font-mono font-black select-all" style={{ color: 'var(--text-primary)' }}>
                                    {m.metadata.tracking_number}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div
                                className="w-full max-w-sm rounded-2xl border p-3.5 text-xs shadow-xs space-y-2.5 my-1"
                                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                              >
                                <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border"
                                      style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border, var(--border))', color: 'var(--text-accent, var(--text-primary))' }}
                                    >
                                      Official Store Order
                                    </span>
                                    <span className="font-mono font-black" style={{ color: 'var(--text-primary)' }}>
                                      #{m.metadata.order_number}
                                    </span>
                                  </div>
                                  {m.metadata.status && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                                      {m.metadata.status}
                                    </span>
                                  )}
                                </div>

                                {m.metadata.tracking_number && (
                                  <div className="p-2.5 rounded-xl border flex items-center justify-between gap-2" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border, var(--border))' }}>
                                    <div>
                                      <span className="text-[10px] font-black uppercase tracking-wider block" style={{ color: 'var(--text-accent)' }}>
                                        Csomagkövetés {m.metadata.courier_name ? `(${m.metadata.courier_name})` : ''}:
                                      </span>
                                      <span className="text-xs font-mono font-black select-all" style={{ color: 'var(--text-primary)' }}>
                                        {m.metadata.tracking_number}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {Array.isArray(m.metadata.items) && m.metadata.items.length > 0 && (
                                  <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                                    {m.metadata.items.map((it: any, itemIdx: number) => (
                                      <div key={itemIdx} className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          {it.image && (
                                            <img src={it.image} alt={it.name || ''} className="w-6 h-6 object-contain rounded border shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }} />
                                          )}
                                          <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                            {it.quantity || 1}× {it.name || 'Store Item'}
                                          </span>
                                        </div>
                                        {it.price_huf && (
                                          <span className="font-bold shrink-0" style={{ color: 'var(--text-secondary)' }}>
                                            {Number(it.price_huf * (it.quantity || 1)).toLocaleString('hu-HU')} Ft
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="pt-2 border-t flex items-center justify-between gap-2 font-bold" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <span style={{ color: 'var(--text-tertiary)' }}>Total</span>
                                  <span className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                                    {Number(m.metadata.total_price_huf || 0).toLocaleString('hu-HU')} Ft
                                  </span>
                                </div>
                              </div>
                            )
                          )}
                          {typeof m.metadata?.handover_details === 'string' && m.metadata.handover_details && (
                            <div
                              className="px-3.5 py-2.5 rounded-xl text-xs sm:text-[13px] font-medium leading-relaxed whitespace-pre-line border max-w-[85%]"
                              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                            >
                              {m.metadata.handover_details}
                            </div>
                          )}
                        </>
                      )}
                    </div>
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
                                    return (
                                      <div key={i} className="relative group rounded-xl overflow-hidden border inline-block max-w-full" style={{ borderColor: 'var(--border)' }}>
                                        <a href={img.url} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in">
                                          <img
                                            src={img.url}
                                            alt="Shared attachment"
                                            loading="lazy"
                                            onError={() => setBrokenImages((prev) => ({ ...prev, [img.url]: true }))}
                                            className="max-h-64 sm:max-h-80 w-auto max-w-full rounded-xl object-contain bg-black/10"
                                          />
                                        </a>
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
    </div>
  );
}
