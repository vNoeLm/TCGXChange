import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentProfile, isProfileAdmin, onSignedInUserChange } from '../../lib/auth';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import {
  fetchConversations,
  fetchMessages,
  hideConversation,
  localizeNoticeBody,
  markThreadRead,
  sendMessage,
} from '../../lib/messages';
import {
  fetchConversationHolds,
  getAuthHeaders,
  submitP2PReview,
  updateHoldStatus,
  type P2PHoldRequest,
} from '../../lib/p2pClient';
import { isP2PEnabledFor } from '../../lib/p2pConstants';
import { getProfileUrl } from '../../lib/profileUrl';
import { setActiveConversationId, subscribeUserRealtime } from '../../lib/realtimeClient';
import { ACTIVE_THREAD_WINDOW_EVENT } from '../../lib/realtimeEvents';
import { categoriesFor, type ReviewDirection } from '../../lib/reviewCategories';
import { cardThumbProps } from '../../lib/supabase';
import type { ChatMessage, ConversationSummary, UserProfile } from '../../types';
import { AuthModal } from '../auth/AuthModal';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';

function formatShortTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(lang === 'hu' ? 'hu-HU' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function P2PMessagesApp() {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();

  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [holds, setHolds] = useState<P2PHoldRequest[]>([]);
  const [showPastHolds, setShowPastHolds] = useState(false);

  const [draft, setDraft] = useState('');
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusyHoldId, setActionBusyHoldId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Inline review drawer state keyed by hold_request_id
  const [reviewOpenHoldId, setReviewOpenHoldId] = useState<string | null>(null);
  const [reviewScores, setReviewScores] = useState<Record<string, number>>({});
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrentProfile().then((p) => {
      setUserProfile(p);
      setAuthLoading(false);
    });
    const unsub = onSignedInUserChange(() => {
      getCurrentProfile().then((p) => {
        setUserProfile(p);
        setAuthLoading(false);
      });
    });
    return () => unsub();
  }, []);

  const isAdmin = isProfileAdmin(userProfile);
  const isAllowed = isP2PEnabledFor(isAdmin);
  const userId = userProfile?.id || null;

  const deepLinkConvId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('conversation');
  }, []);

  const loadInbox = useCallback(async () => {
    if (!userId || !isAllowed) return;
    setLoadingConvs(true);
    try {
      const list = await fetchConversations({
        includeConversationId: selectedIdRef.current || deepLinkConvId,
        channelType: 'p2p',
      });
      setConversations(list);
      if (!selectedIdRef.current) {
        if (deepLinkConvId && list.some((c) => c.conversation_id === deepLinkConvId)) {
          setSelectedId(deepLinkConvId);
        } else if (list.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
          setSelectedId(list[0].conversation_id);
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('Could not load conversations.', 'Nem sikerült betölteni a beszélgetéseket.'));
    } finally {
      setLoadingConvs(false);
    }
  }, [userId, isAllowed, deepLinkConvId, t]);

  useEffect(() => {
    if (userId && isAllowed) {
      loadInbox();
    }
  }, [userId, isAllowed, loadInbox]);

  const loadActiveThread = useCallback(
    async (convId: string, silent = false) => {
      if (!convId || !userId) return;
      if (!silent) setLoadingMsgs(true);
      try {
        const [msgs, holdRows] = await Promise.all([
          fetchMessages(convId),
          fetchConversationHolds(convId).catch(() => [] as P2PHoldRequest[]),
        ]);
        setMessages(msgs);
        setHolds(holdRows);
        await markThreadRead(convId);
        setConversations((prev) => prev.map((c) => (c.conversation_id === convId ? { ...c, unread_count: 0 } : c)));
      } catch (err: any) {
        setErrorMsg(err?.message || t('Could not load thread.', 'Nem sikerült betölteni az üzeneteket.'));
      } finally {
        if (!silent) setLoadingMsgs(false);
      }
    },
    [userId, t]
  );

  useEffect(() => {
    if (!selectedId) {
      setActiveConversationId(null);
      return;
    }
    setActiveConversationId(selectedId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ACTIVE_THREAD_WINDOW_EVENT, { detail: { conversationId: selectedId } }));
    }
    loadActiveThread(selectedId);
    return () => {
      setActiveConversationId(null);
    };
  }, [selectedId, loadActiveThread]);

  // Realtime sync for new messages & hold updates
  useEffect(() => {
    if (!userId || !isAllowed) return;
    const unsub = subscribeUserRealtime(userId, (evt) => {
      if (evt.type === 'chat_message' || evt.type === 'system_notice' || evt.type === 'hold_changed') {
        loadInbox();
        if (evt.conversation_id && evt.conversation_id === selectedIdRef.current) {
          loadActiveThread(evt.conversation_id, true);
        }
      }
    });
    return () => unsub();
  }, [userId, isAllowed, loadInbox, loadActiveThread]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, selectedId]);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.conversation_id === selectedId) || null,
    [conversations, selectedId]
  );

  const activeHolds = useMemo(
    () => holds.filter((h) => h.status === 'pending' || h.status === 'accepted' || h.status === 'handed_over'),
    [holds]
  );
  const pastHolds = useMemo(
    () => holds.filter((h) => h.status !== 'pending' && h.status !== 'accepted' && h.status !== 'handed_over'),
    [holds]
  );

  const handlePhotoUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploadingPhoto(true);
    setErrorMsg(null);
    try {
      const form = new FormData();
      Array.from(fileList).slice(0, 4).forEach((f) => form.append('files', f));
      const headers = await getAuthHeaders();
      const res = await fetch('/api/messages/upload-image', {
        method: 'POST',
        headers,
        body: form,
      }).then((r) => r.json());
      if (!res?.success) throw new Error(res?.error || 'Image upload failed');
      setAttachedImages((prev) => [...prev, ...(res.urls || [])].slice(0, 4));
    } catch (err: any) {
      setErrorMsg(err?.message || t('Image upload failed.', 'Képfeltöltés sikertelen.'));
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedId || !selectedConv) return;
    if (!draft.trim() && attachedImages.length === 0) return;

    setSending(true);
    setErrorMsg(null);
    try {
      const res = await sendMessage(
        selectedId,
        draft,
        {
          channel_type: 'p2p',
          ...(attachedImages.length > 0 ? { images: attachedImages } : {}),
        },
        {
          counterpartId: selectedConv.counterpart_id,
          senderName: userProfile?.display_name || null,
          senderAvatar: userProfile?.avatar_url || null,
        }
      );
      if (res.error) throw res.error;
      setDraft('');
      setAttachedImages([]);
      await loadActiveThread(selectedId, true);
      await loadInbox();
    } catch (err: any) {
      setErrorMsg(err?.message || t('Message could not be sent.', 'Nem sikerült elküldeni az üzenetet.'));
    } finally {
      setSending(false);
    }
  };

  const handleHoldAction = async (
    holdId: string,
    action: 'accept' | 'decline' | 'release' | 'cancel' | 'hand_over' | 'confirm_received'
  ) => {
    setActionBusyHoldId(holdId);
    setErrorMsg(null);
    try {
      await updateHoldStatus(holdId, action);
      if (selectedId) {
        await loadActiveThread(selectedId, true);
      }
      await loadInbox();
    } catch (err: any) {
      setErrorMsg(err?.message || t('Failed to update hold status.', 'Nem sikerült frissíteni a foglalást.'));
    } finally {
      setActionBusyHoldId(null);
    }
  };

  const openReviewForHold = (hold: P2PHoldRequest) => {
    const dir: ReviewDirection = hold.buyer_id === userId ? 'buyer_to_seller' : 'seller_to_buyer';
    const initial: Record<string, number> = {};
    for (const c of categoriesFor(dir, lang)) {
      initial[c.key] = 5;
    }
    setReviewScores(initial);
    setReviewComment('');
    setReviewOpenHoldId(hold.id);
  };

  const handleSubmitReview = async (hold: P2PHoldRequest) => {
    setReviewSubmitting(true);
    setErrorMsg(null);
    try {
      await submitP2PReview(hold.id, reviewScores, reviewComment.trim() || undefined);
      setReviewOpenHoldId(null);
      if (selectedId) await loadActiveThread(selectedId, true);
    } catch (err: any) {
      setErrorMsg(err?.message || t('Failed to save review.', 'Nem sikerült elmenteni az értékelést.'));
    } finally {
      setReviewSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="h-[520px] rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div
          className="rounded-2xl border p-8 flex flex-col items-center gap-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-xl font-black" style={{ color: 'var(--text-primary)' }}>
            {t('P2P Messages', 'Piactér üzenetek')}
          </h1>
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'Sign in to chat with buyers and sellers and manage your marketplace holds.',
              'Jelentkezz be a piactéri üzenetekhez és a félretételek kezeléséhez.'
            )}
          </p>
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="mt-1 px-5 py-2.5 rounded-xl text-xs font-black cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            {t('Sign In', 'Belépés')}
          </button>
        </div>
        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onSuccess={() => {
              setShowAuthModal(false);
              getCurrentProfile().then(setUserProfile);
            }}
          />
        )}
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div
          className="rounded-2xl border p-8 flex flex-col items-center gap-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-xl font-black" style={{ color: 'var(--text-primary)' }}>
            {t('P2P Messages Coming Soon', 'A Piactér üzenetek hamarosan indulnak')}
          </h1>
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'For official TCG XChange Store orders and customer service, please visit Store Support.',
              'Hivatalos bolti rendelésekhez és segítséghez nyisd meg az Ügyfélszolgálatot.'
            )}
          </p>
          <a
            href="/support"
            className="mt-1 px-5 py-2.5 rounded-xl text-xs font-black"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            {t('Go to Store Support', 'Ugrás az Ügyfélszolgálatra')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-3">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {t('P2P Messages', 'Piactér üzenetek')}
          </h1>
          <p className="text-[11px] sm:text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {t('Private buyer–seller chats & active hold confirmations.', 'Eladók és vevők közötti privát chat és foglaláskezelés.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/marketplace"
            className="px-3 py-1.5 rounded-xl border text-xs font-bold hover:border-[var(--accent)]"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {t('Browse Marketplace', 'Piactér megnyitása')}
          </a>
          <a
            href="/support"
            className="px-3 py-1.5 rounded-xl border text-xs font-bold hover:border-[var(--accent)]"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Store Support', 'Ügyfélszolgálat')}
          </a>
        </div>
      </div>

      {errorMsg && (
        <div className="px-4 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-xs font-bold cursor-pointer">
            ×
          </button>
        </div>
      )}

      {/* Split Pane Container */}
      <div
        className="rounded-2xl border overflow-hidden grid grid-cols-1 md:grid-cols-12 h-[calc(100vh-200px)] min-h-[540px]"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {/* Left Thread List */}
        <aside
          className={`md:col-span-4 border-r flex flex-col min-h-0 ${selectedId ? 'hidden md:flex' : 'flex'}`}
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {t('Conversations', 'Beszélgetések')} ({conversations.length})
            </span>
            <button
              type="button"
              onClick={loadInbox}
              className="text-[11px] font-bold hover:underline cursor-pointer"
              style={{ color: 'var(--text-accent)' }}
            >
              {loadingConvs ? t('Refreshing...', 'Frissítés...') : t('Refresh', 'Frissítés')}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {t(
                  'No P2P conversations yet. Request a hold or click Chat on any marketplace post to start.',
                  'Még nincs piactéri üzeneted. Foglalj le egy lapot vagy írj egy eladónak a Piactéren!'
                )}
              </div>
            ) : (
              conversations.map((conv) => {
                const active = conv.conversation_id === selectedId;
                return (
                  <div
                    key={conv.conversation_id}
                    onClick={() => setSelectedId(conv.conversation_id)}
                    className={`p-3.5 flex items-center gap-3 cursor-pointer transition hover:bg-[var(--bg-raised)] ${
                      active ? 'bg-[var(--accent-muted)]' : ''
                    }`}
                  >
                    {conv.counterpart_avatar ? (
                      <img
                        src={conv.counterpart_avatar}
                        alt={conv.counterpart_name}
                        className="w-10 h-10 rounded-full object-cover border shrink-0"
                        style={{ borderColor: 'var(--border)', ...resolveAvatarImageStyle(conv.counterpart_avatar) }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full border flex items-center justify-center text-xs font-black shrink-0"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                      >
                        {conv.counterpart_name[0]?.toUpperCase() || 'U'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>
                          {conv.counterpart_name}
                        </span>
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                          {formatShortTime(conv.last_message_at, lang)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                          {localizeNoticeBody(conv.last_message || '', lang) || t('Open chat', 'Chat megnyitása')}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {conv.unread_count > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-black bg-amber-500 text-zinc-950">
                              {conv.unread_count}
                            </span>
                          )}
                          <button
                            type="button"
                            title={t('Hide thread', 'Beszélgetés elrejtése')}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await hideConversation(conv.conversation_id, conv.latest_activity_at || conv.last_message_at);
                              if (selectedId === conv.conversation_id) setSelectedId(null);
                              loadInbox();
                            }}
                            className="w-5 h-5 rounded flex items-center justify-center opacity-50 hover:opacity-100 cursor-pointer"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Active Conversation */}
        <section className={`md:col-span-8 flex flex-col min-h-0 ${selectedId ? 'flex' : 'hidden md:flex'}`}>
          {!selectedConv ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <svg className="w-10 h-10 mb-3" style={{ color: 'var(--text-tertiary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {t('Select a P2P conversation', 'Válassz ki egy beszélgetést')}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {t('Manage holds, exchange meetup/shipping details, and leave reviews.', 'Kezeld a foglalásokat, egyeztesd az átadást és értékeljetek egymást.')}
              </p>
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div
                className="px-4 py-3 border-b flex items-center justify-between gap-3 shrink-0"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="md:hidden px-2 py-1 rounded-lg border text-xs font-bold cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    ←
                  </button>
                  <a
                    href={getProfileUrl({ id: selectedConv.counterpart_id, display_name: selectedConv.counterpart_name })}
                    className="flex items-center gap-2.5 min-w-0 group"
                  >
                    {selectedConv.counterpart_avatar ? (
                      <img
                        src={selectedConv.counterpart_avatar}
                        alt={selectedConv.counterpart_name}
                        className="w-8 h-8 rounded-full object-cover border shrink-0"
                        style={{ borderColor: 'var(--border)', ...resolveAvatarImageStyle(selectedConv.counterpart_avatar) }}
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full border flex items-center justify-center text-xs font-black shrink-0"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                      >
                        {selectedConv.counterpart_name[0]?.toUpperCase() || 'U'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-black truncate group-hover:underline" style={{ color: 'var(--text-primary)' }}>
                        {selectedConv.counterpart_name}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {t('View Public Profile →', 'Nyilvános profil megtekintése →')}
                      </div>
                    </div>
                  </a>
                </div>

                {pastHolds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowPastHolds((v) => !v)}
                    className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    {showPastHolds
                      ? t('Hide Past Holds', 'Lezártak elrejtése')
                      : `${t('Past Holds', 'Lezártak')} (${pastHolds.length})`}
                  </button>
                )}
              </div>

              {/* Active / Past Interactive Hold Request Cards */}
              {(activeHolds.length > 0 || (showPastHolds && pastHolds.length > 0)) && (
                <div
                  className="px-4 py-2.5 border-b max-h-60 overflow-y-auto flex flex-col gap-2 shrink-0"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}
                >
                  {[...activeHolds, ...(showPastHolds ? pastHolds : [])].map((hold) => {
                    const isSeller = hold.seller_id === userId;
                    const isBuyer = hold.buyer_id === userId;
                    const busy = actionBusyHoldId === hold.id;
                    const dir: ReviewDirection = isBuyer ? 'buyer_to_seller' : 'seller_to_buyer';

                    const canSellerCompleteAfter72h = (() => {
                      if (!isSeller || hold.status !== 'handed_over') return false;
                      const refMs = Date.parse(hold.handed_over_at || hold.updated_at || hold.created_at);
                      return !Number.isNaN(refMs) && Date.now() - refMs >= 72 * 3600 * 1000;
                    })();

                    return (
                      <div
                        key={hold.id}
                        className="p-3 rounded-xl border flex flex-col gap-2"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {hold.image_path && (
                              <img
                                src={hold.image_path.startsWith('http') ? hold.image_path : cardThumbProps(hold.image_path, 'avatar').src}
                                alt={hold.card_name || 'Item'}
                                className="w-8 h-11 rounded object-cover border shrink-0"
                                style={{ borderColor: 'var(--border-subtle)' }}
                              />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-surface-2)]" style={{ color: 'var(--text-tertiary)' }}>
                                  #{hold.order_number || hold.id.slice(0, 8).toUpperCase()}
                                </span>
                                <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded border" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}>
                                  {isSeller ? t('Selling', 'Eladás') : t('Buying', 'Vétel')}
                                </span>
                                <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                                  {hold.status}
                                </span>
                              </div>
                              <div className="text-xs font-black truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>
                                {hold.card_name || 'Hold Request'} · {hold.quantity}x
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {hold.price_huf != null && (
                              <span className="text-xs font-black mr-1" style={{ color: 'var(--text-accent)' }}>
                                {formatPrice(hold.price_huf)}
                              </span>
                            )}

                            {hold.status === 'pending' && isSeller && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleHoldAction(hold.id, 'accept')}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer disabled:opacity-50"
                                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                                >
                                  {t('Accept Hold', 'Elfogadás')}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleHoldAction(hold.id, 'decline')}
                                  className="px-2.5 py-1 rounded-lg border text-[11px] font-bold text-rose-400 cursor-pointer disabled:opacity-50"
                                  style={{ borderColor: 'var(--border)' }}
                                >
                                  {t('Decline', 'Elutasítás')}
                                </button>
                              </>
                            )}

                            {hold.status === 'pending' && isBuyer && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleHoldAction(hold.id, 'cancel')}
                                className="px-2.5 py-1 rounded-lg border text-[11px] font-bold text-rose-400 cursor-pointer disabled:opacity-50"
                                style={{ borderColor: 'var(--border)' }}
                              >
                                {t('Cancel', 'Visszavonás')}
                              </button>
                            )}

                            {hold.status === 'accepted' && isSeller && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleHoldAction(hold.id, 'hand_over')}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer disabled:opacity-50"
                                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                                >
                                  {t('Mark Handed Over', 'Átadva / Feladva')}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleHoldAction(hold.id, 'release')}
                                  className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50"
                                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                                >
                                  {t('Release Stock', 'Félretétel feloldása')}
                                </button>
                              </>
                            )}

                            {(hold.status === 'accepted' || hold.status === 'handed_over') && isBuyer && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleHoldAction(hold.id, 'confirm_received')}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-emerald-500 text-zinc-950 cursor-pointer disabled:opacity-50"
                              >
                                {t('Confirm Received', 'Átvettem (Lezárás)')}
                              </button>
                            )}

                            {canSellerCompleteAfter72h && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleHoldAction(hold.id, 'confirm_received')}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-emerald-500 text-zinc-950 cursor-pointer disabled:opacity-50"
                              >
                                {t('Auto-Complete (72h+)', 'Lezárás (72h+)')}
                              </button>
                            )}

                            {hold.status === 'completed' && !hold.my_review_submitted && (
                              <button
                                type="button"
                                onClick={() => openReviewForHold(hold)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer"
                                style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)' }}
                              >
                                {t('Leave Review', 'Értékelés írása')}
                              </button>
                            )}

                            {hold.status === 'completed' && hold.my_review_submitted && (
                              <span className="text-[10px] font-bold text-emerald-400">
                                {t('Reviewed', 'Értékelve')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Inline Two-Way Review Form */}
                        {reviewOpenHoldId === hold.id && (
                          <div
                            className="p-3 rounded-xl border flex flex-col gap-2.5"
                            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                                {isBuyer ? t('Rate the Seller', 'Eladó értékelése') : t('Rate the Buyer', 'Vevő értékelése')}
                              </span>
                              <button
                                type="button"
                                onClick={() => setReviewOpenHoldId(null)}
                                className="text-[11px] font-bold cursor-pointer"
                                style={{ color: 'var(--text-tertiary)' }}
                              >
                                {t('Cancel', 'Mégse')}
                              </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {categoriesFor(dir, lang).map((cat) => (
                                <div key={cat.key} className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                                  <span className="text-[11px] font-bold truncate" style={{ color: 'var(--text-secondary)' }}>
                                    {cat.label}
                                  </span>
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    {[1, 2, 3, 4, 5].map((star) => {
                                      const filled = (reviewScores[cat.key] || 5) >= star;
                                      return (
                                        <button
                                          key={star}
                                          type="button"
                                          onClick={() => setReviewScores((s) => ({ ...s, [cat.key]: star }))}
                                          className="p-0.5 cursor-pointer"
                                        >
                                          <svg
                                            className={`w-3.5 h-3.5 ${filled ? 'text-amber-400 fill-current' : 'text-zinc-600'}`}
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth={2}
                                          >
                                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                          </svg>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={reviewComment}
                                onChange={(e) => setReviewComment(e.target.value)}
                                placeholder={t('Optional short review...', 'Rövid vélemény (opcionális)...')}
                                className="flex-1 px-3 py-1.5 rounded-lg border text-xs outline-none"
                                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                              />
                              <button
                                type="button"
                                disabled={reviewSubmitting}
                                onClick={() => handleSubmitReview(hold)}
                                className="px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50"
                                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                              >
                                {reviewSubmitting ? t('Saving...', 'Mentés...') : t('Submit', 'Küldés')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Chat Message Feed */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
                {loadingMsgs ? (
                  <div className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Loading messages...', 'Üzenetek betöltése...')}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                    {t('No messages in this thread yet.', 'Még nincs üzenet ebben a beszélgetésben.')}
                  </div>
                ) : (
                  messages.map((m) => {
                    if (m.message_type === 'system') {
                      return (
                        <div key={m.id} className="flex justify-center my-1">
                          <span
                            className="px-3 py-1 rounded-full border text-[11px] font-semibold text-center max-w-[90%]"
                            style={{
                              background: 'var(--bg-surface-2)',
                              borderColor: 'var(--border-subtle)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {localizeNoticeBody(m.body, lang)} · {formatShortTime(m.created_at, lang)}
                          </span>
                        </div>
                      );
                    }

                    const mine = m.sender_id === userId;
                    const imgs: string[] = Array.isArray(m.metadata?.images) ? m.metadata.images : [];
                    return (
                      <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                        <div
                          className="max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 border flex flex-col gap-1.5"
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
                          {imgs.length > 0 && (
                            <div className="grid grid-cols-2 gap-1.5">
                              {imgs.map((url, idx) => (
                                <button
                                  key={`${url}-${idx}`}
                                  type="button"
                                  onClick={() => setLightboxUrl(url)}
                                  className="rounded-lg overflow-hidden border cursor-zoom-in"
                                  style={{ borderColor: 'var(--border-subtle)' }}
                                >
                                  <img src={url} alt="Attachment" className="w-36 h-28 object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                          {m.body && <p className="text-xs sm:text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                        </div>
                        <span className="text-[10px] mt-0.5 px-1" style={{ color: 'var(--text-tertiary)' }}>
                          {formatShortTime(m.created_at, lang)}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={msgEndRef} />
              </div>

              {/* Composer */}
              <form
                onSubmit={handleSend}
                className="p-3 border-t flex flex-col gap-2 shrink-0"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
              >
                {attachedImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachedImages.map((url, idx) => (
                      <div key={`${url}-${idx}`} className="relative w-14 h-14 rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                        <img src={url} alt="Draft upload" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/80 text-white text-[10px] flex items-center justify-center cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={(e) => handlePhotoUpload(e.target.files)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                    title={t('Attach photos', 'Fotó csatolása')}
                    className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 hover:border-[var(--accent)] cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>

                  <textarea
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={t('Message about meetup, Foxpost, or card details...', 'Üzenet az átvételről vagy a lapokról...')}
                    className="flex-1 px-3 py-2 rounded-xl border text-xs sm:text-sm outline-none resize-none max-h-28 focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />

                  <button
                    type="submit"
                    disabled={sending || uploadingPhoto || (!draft.trim() && attachedImages.length === 0)}
                    className="px-4 h-9 rounded-xl text-xs font-black shrink-0 cursor-pointer disabled:opacity-40"
                    style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                  >
                    {sending ? t('Sending...', 'Küldés...') : t('Send', 'Küldés')}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[2500] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Chat photo" className="max-w-full max-h-[90vh] rounded-2xl object-contain" />
        </div>
      )}
    </div>
  );
}
