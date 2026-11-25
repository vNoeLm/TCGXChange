import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentProfile, isProfileAdmin, onSignedInUserChange } from '../../lib/auth';
import { formatCondition } from '../../lib/collectionDefaults';
import { GAMES } from '../../lib/constants';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { isP2PEnabledFor } from '../../lib/p2pConstants';
import { useSiteFlags } from '../../lib/siteFlags';
import {
  createHoldRequest,
  fetchListings,
  fetchPosts,
  loadP2PCart,
  p2pCartEntryToGeneric,
  saveP2PCart,
  startP2PConversation,
  toggleLike,
  updateMarketplacePost,
  type P2PCardGroup,
  type P2PCartEntry,
  type P2PListing,
  type P2PPost,
  type P2PPostTaggedCard,
} from '../../lib/p2pClient';
import { getProfileUrl } from '../../lib/profileUrl';
import { cardThumbProps, getCardImageUrl } from '../../lib/supabase';
import type { UserProfile } from '../../types';
import { AuthModal } from '../auth/AuthModal';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { CardValuePanel } from '../CardValuePanel';
import { ImageViewer } from '../CardImageViewer';
import { GenericCartDrawer, type GenericCartSellerGroup } from '../cart/GenericCartDrawer';
import { UnifiedProductDetail, type BreadcrumbItem } from '../product/UnifiedProductDetail';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';
import { EditListingModal } from './EditListingModal';
import { EditPostModal } from './EditPostModal';
import { HoldConfirmModal, type HoldTarget } from './HoldConfirmModal';
import { PostDescriptionRenderer } from './PostDescriptionRenderer';
import { SellerInfoCard } from './SellerInfoCard';
import { LikeButton } from './LikeButton';
import { doesMentionMatchCard, parsePostDescriptionSegments } from '../../lib/postMentions';

/**
 * Unified P2P item detail page (?listing=, ?post=, or ?card=).
 * - `?listing=` reuses UnifiedProductDetail cleanly alongside StoreProductApp.
 * - `?card=` puts the Card image + CardValuePanel (Value + Price Graph) in the 2-col hero,
 *   and renders all community seller listings in a full-width list underneath.
 */
export function MarketplaceItemApp() {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();

  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [listing, setListing] = useState<P2PListing | null>(null);
  const [post, setPost] = useState<P2PPost | null>(null);
  const [cardGroup, setCardGroup] = useState<P2PCardGroup | null>(null);

  const [qty, setQty] = useState(1);
  const [cart, setCart] = useState<P2PCartEntry[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartBump, setCartBump] = useState(0);
  const [sendingSellerCartId, setSendingSellerCartId] = useState<string | null>(null);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);

  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [editingListing, setEditingListing] = useState<P2PListing | null>(null);
  const [editingPost, setEditingPost] = useState<P2PPost | null>(null);
  const [tagBusyId, setTagBusyId] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{ text: string; conversationId?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [cardLightboxOpen, setCardLightboxOpen] = useState(false);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [hideSoldTags, setHideSoldTags] = useState(false);
  const [tagSort, setTagSort] = useState<'default' | 'price_desc' | 'price_asc' | 'name_asc'>('default');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  useEffect(() => {
    setCart(loadP2PCart());
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
  const siteFlags = useSiteFlags();
  const isAllowed = isP2PEnabledFor(isAdmin, siteFlags.p2p_public);

  const loadItem = useCallback(async () => {
    if (!isAllowed || typeof window === 'undefined') return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(window.location.search);
    const listingId = params.get('listing');
    const postId = params.get('post');
    const cardId = params.get('card');
    const foilParam = params.get('foil');

    try {
      if (listingId) {
        const res = await fetchListings({ id: listingId });
        const found = res.listings?.[0] || null;
        if (!found) throw new Error(t('Listing not found.', 'A hirdetés nem található.'));
        setListing(found);
        setPost(null);
        setCardGroup(null);
      } else if (postId) {
        const res = await fetchPosts({ id: postId });
        const found = res.posts?.[0] || null;
        if (!found) throw new Error(t('Post not found.', 'A poszt nem található.'));
        setPost(found);
        setListing(null);
        setCardGroup(null);
      } else if (cardId) {
        const res = await fetchListings({
          view: 'by_card',
          card_id: cardId,
          foil: foilParam === 'true' ? 'true' : foilParam === 'false' ? 'false' : undefined,
        });
        const grp = res.cards?.[0] || null;
        if (!grp) throw new Error(t('No active offers for this card.', 'Nincs aktív ajánlat ehhez a kártyához.'));
        setCardGroup(grp);
        setListing(null);
        setPost(null);
      } else {
        throw new Error(t('No item specified.', 'Hiányzó azonosító.'));
      }
    } catch (err: any) {
      setError(err?.message || t('Failed to load item.', 'Nem sikerült betölteni.'));
    } finally {
      setLoading(false);
    }
  }, [isAllowed, t]);

  useEffect(() => {
    if (!authLoading && isAllowed) {
      loadItem();
    }
  }, [authLoading, isAllowed, loadItem]);

  const requireSignedIn = () => {
    if (!userProfile) {
      setShowAuthModal(true);
      return false;
    }
    return true;
  };

  const handleMessageSeller = async (sellerId: string, prefill?: string) => {
    if (!requireSignedIn()) return;
    setActionError(null);
    try {
      const res = await startP2PConversation(sellerId, prefill);
      window.location.href = `/messages?conversation=${encodeURIComponent(res.conversation_id)}`;
    } catch (err: any) {
      setActionError(err?.message || t('Could not start chat.', 'Nem sikerült elindítani a csevegést.'));
    }
  };

  const handleAddToCart = (targetListing: P2PListing, addQty = 1) => {
    if (!requireSignedIn()) return;
    setCart((prev) => {
      const existing = prev.find((e) => e.listingId === targetListing.id);
      const next: P2PCartEntry[] = existing
        ? prev.map((e) =>
            e.listingId === targetListing.id
              ? { ...e, quantity: Math.min(targetListing.quantity, e.quantity + addQty), listing: targetListing }
              : e
          )
        : [...prev, { listingId: targetListing.id, quantity: Math.min(targetListing.quantity, addQty), listing: targetListing }];
      saveP2PCart(next);
      return next;
    });
    setCartBump((b) => b + 1);
    setCartFeedback(t('Added to Cart', 'Kosárba téve'));
    setTimeout(() => setCartFeedback(null), 2500);
  };

  const handleUpdateCartQty = (id: string, nextQty: number) => {
    setCart((prev) => {
      const next =
        nextQty <= 0
          ? prev.filter((e) => e.listingId !== id)
          : prev.map((e) =>
              e.listingId === id ? { ...e, quantity: Math.min(e.listing.quantity, nextQty) } : e
            );
      saveP2PCart(next);
      return next;
    });
  };

  const handleRemoveCartItem = (id: string) => {
    setCart((prev) => {
      const next = prev.filter((e) => e.listingId !== id);
      saveP2PCart(next);
      return next;
    });
  };

  const sellerCartGroups: GenericCartSellerGroup[] = useMemo(() => {
    const map = new Map<string, GenericCartSellerGroup>();
    for (const entry of cart) {
      const sid = entry.listing.seller_id;
      let grp = map.get(sid);
      if (!grp) {
        grp = {
          sellerId: sid,
          sellerName: entry.listing.seller.display_name,
          subtotal: 0,
          items: [],
          meta: { seller: entry.listing.seller },
        };
        map.set(sid, grp);
      }
      grp.items.push(p2pCartEntryToGeneric(entry));
      grp.subtotal += entry.listing.price_huf * entry.quantity;
    }
    return Array.from(map.values());
  }, [cart]);

  const handleRequestSellerGroupHold = async (group: GenericCartSellerGroup) => {
    if (!requireSignedIn()) return;
    setSendingSellerCartId(group.sellerId);
    try {
      const res = await createHoldRequest({
        mode: 'listings_batch',
        items: group.items.map((it) => ({ listing_id: it.id, quantity: it.quantity })),
      });
      const remaining = cart.filter((e) => e.listing.seller_id !== group.sellerId);
      setCart(remaining);
      saveP2PCart(remaining);
      setCartOpen(false);
      setBannerNotice({
        text: t(`Hold request sent to ${group.sellerName}.`, `Félretételi kérelem elküldve: ${group.sellerName}.`),
        conversationId: res.conversation_id,
      });
      loadItem();
    } catch (err: any) {
      setError(err?.message || t('Hold request failed.', 'Sikertelen félretétel.'));
    } finally {
      setSendingSellerCartId(null);
    }
  };

  const cartTotalCount = cart.reduce((s, e) => s + e.quantity, 0);
  const cartSubtotal = cart.reduce((s, e) => s + e.listing.price_huf * e.quantity, 0);

  const renderCartButton = () => (
    <button
      type="button"
      onClick={() => setCartOpen(true)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition hover:border-[var(--border-hover)]"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
    >
      <svg className="w-3.5 h-3.5" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      <span>{t('Cart', 'Kosár')} ({cartTotalCount})</span>
    </button>
  );

  const renderInlineBanner = () => {
    if (!bannerNotice && !actionError) return null;
    return (
      <div className="flex flex-col gap-2 mb-4">
        {actionError && (
          <div className="px-4 py-2.5 rounded-xl border flex items-center justify-between gap-2 bg-rose-500/10 border-rose-500/40">
            <span className="text-xs font-bold text-rose-300">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label={t('Dismiss', 'Bezárás')}
              className="p-1 rounded-md text-rose-300 hover:bg-rose-500/20 cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        )}
        {bannerNotice && (
          <div className="px-4 py-2.5 rounded-xl border flex items-center justify-between gap-2" style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.4)' }}>
            <span className="text-xs font-bold text-emerald-300">{bannerNotice.text}</span>
            {bannerNotice.conversationId && (
              <a href={`/messages?conversation=${encodeURIComponent(bannerNotice.conversationId)}`} className="px-3 py-1 rounded-lg text-xs font-black bg-emerald-500 text-zinc-950">
                {t('Open Chat', 'Chat megnyitása')}
              </a>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCartAndModals = () => (
    <>
      <GenericCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onOpen={() => setCartOpen(true)}
        bumpKey={cartBump}
        title={t('Hold Cart', 'Kosár')}
        totalCount={cartTotalCount}
        subtotalHuf={cartSubtotal}
        groupBySeller
        sellerGroups={sellerCartGroups}
        onClear={() => {
          setCart([]);
          saveP2PCart([]);
        }}
        onUpdateQuantity={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        renderSellerControls={(group) => (
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              disabled={sendingSellerCartId === group.sellerId}
              onClick={() => handleRequestSellerGroupHold(group)}
              className="px-3.5 py-2 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
            >
              {sendingSellerCartId === group.sellerId
                ? t('Sending...', 'Küldés...')
                : t(`Hold All (${group.sellerName})`, `Félretétel (${group.sellerName})`)}
            </button>
          </div>
        )}
        emptyTitle={t('Cart is empty', 'A kosarad üres')}
      />

      {holdTarget && (
        <HoldConfirmModal
          target={holdTarget}
          onClose={() => setHoldTarget(null)}
          onSuccess={(convId) => {
            setHoldTarget(null);
            setSelectedTagIds([]);
            setBannerNotice({ text: t('Hold request sent.', 'Félretétel elküldve.'), conversationId: convId });
            loadItem();
          }}
        />
      )}

      {editingListing && (
        <EditListingModal
          listing={editingListing}
          onClose={() => setEditingListing(null)}
          onSaved={() => {
            setEditingListing(null);
            loadItem();
          }}
          onDeleted={() => {
            setEditingListing(null);
            if (listing) window.location.href = '/marketplace';
            else loadItem();
          }}
        />
      )}

      {editingPost && (
        <EditPostModal
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => {
            setEditingPost(null);
            loadItem();
          }}
          onDeleted={() => {
            setEditingPost(null);
            window.location.href = '/marketplace/posts';
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            getCurrentProfile().then(setUserProfile);
          }}
        />
      )}
    </>
  );

  if (authLoading || loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-8">
        <div className="h-96 rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
      </div>
    );
  }

  if (!isAllowed || error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <div className="rounded-2xl border p-8 flex flex-col items-center gap-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {error || t('Unavailable', 'Nem elérhető')}
          </p>
          <a
            href="/marketplace"
            className="px-4 py-2 rounded-xl text-xs font-black"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            {t('Marketplace', 'Piactér')}
          </a>
        </div>
      </div>
    );
  }

  // 1. Unified Post / Lot Detail via UnifiedProductDetail
  if (post) {
    const hasLotPrice = post.lot_price_huf != null && post.lot_price_huf > 0;
    const isOwnPost = Boolean(userProfile && userProfile.id === post.seller_id);
    const soldOutPost = post.status === 'sold_out' || post.status === 'closed';
    const heldPost = post.status === 'held';
    const renderedPostDesc = (post.body || '').trim() ? (
      <PostDescriptionRenderer
        body={post.body}
        taggedCards={post.tagged_cards}
        onCardClick={(cardId) => setPreviewCardId(cardId)}
      />
    ) : null;

    const adaptivePricing = post.bundle_pricing?.mode === 'adaptive' ? post.bundle_pricing : null;
    const isBundleOnly = Boolean(hasLotPrice && post.bundle_pricing?.bundle_only);
    const showAdaptiveOriginal =
      Boolean(
        hasLotPrice &&
          adaptivePricing &&
          adaptivePricing.discount_pct > 0 &&
          adaptivePricing.available_total_huf > (post.lot_price_huf ?? 0)
      );

    const soldTagCount = post.tagged_cards.filter((tc) => tc.status === 'sold' || tc.quantity <= 0).length;
    const displayedTaggedCards = (() => {
      const base = hideSoldTags
        ? post.tagged_cards.filter((tc) => tc.status !== 'sold' && tc.quantity > 0)
        : [...post.tagged_cards];
      if (tagSort === 'price_desc') {
        base.sort((a, b) => (b.price_huf ?? -1) - (a.price_huf ?? -1));
      } else if (tagSort === 'price_asc') {
        base.sort((a, b) => (a.price_huf ?? Number.MAX_SAFE_INTEGER) - (b.price_huf ?? Number.MAX_SAFE_INTEGER));
      } else if (tagSort === 'name_asc') {
        base.sort((a, b) => (a.card?.name || '').localeCompare(b.card?.name || ''));
      }
      return base;
    })();

    const canMultiSelectTags = !isOwnPost && !isBundleOnly && !soldOutPost;
    const selectedTagSet = new Set(selectedTagIds);
    const selectedTaggedCards = canMultiSelectTags
      ? post.tagged_cards.filter(
          (tc) =>
            selectedTagSet.has(tc.id) &&
            tc.status !== 'sold' &&
            tc.quantity > 0 &&
            tc.available_quantity > 0 &&
            !tc.is_highlight_only &&
            tc.price_huf != null &&
            tc.price_huf > 0
        )
      : [];
    const selectedTotalHuf = selectedTaggedCards.reduce((sum, tc) => sum + (tc.price_huf || 0), 0);

    const toggleTagSelect = (tcId: string) => {
      setSelectedTagIds((prev) => (prev.includes(tcId) ? prev.filter((id) => id !== tcId) : [...prev, tcId]));
    };

    const openBatchTaggedHold = () => {
      if (!requireSignedIn() || selectedTaggedCards.length === 0) return;
      if (selectedTaggedCards.length === 1) {
        openTaggedCardHold(selectedTaggedCards[0]);
        return;
      }
      setHoldTarget({
        mode: 'post_card',
        title: t(
          `${selectedTaggedCards.length} selected cards`,
          `${selectedTaggedCards.length} kijelölt lap`
        ),
        subtitle: selectedTaggedCards
          .slice(0, 3)
          .map((tc) => tc.card?.name)
          .filter(Boolean)
          .join(', ') + (selectedTaggedCards.length > 3 ? ` +${selectedTaggedCards.length - 3}` : ''),
        sellerName: post.seller.display_name,
        priceHuf: selectedTotalHuf,
        maxQuantity: 1,
        postId: post.id,
        items: selectedTaggedCards.map((tc) => ({ post_card_id: tc.id, quantity: 1 })),
        imageUrl: selectedTaggedCards[0].card?.image_path
          ? getCardImageUrl(selectedTaggedCards[0].card.image_path)
          : post.images?.[0] || null,
      });
    };

    const pricedTags = post.tagged_cards.filter(
      (tc) => !tc.is_highlight_only && tc.price_huf != null && tc.price_huf > 0 && tc.status !== 'sold' && tc.available_quantity > 0
    );
    const minCardPrice = pricedTags.length > 0 ? Math.min(...pricedTags.map((tc) => tc.price_huf!)) : null;

    const postBreadcrumbs: BreadcrumbItem[] = [
      { label: t('Marketplace', 'Piactér'), href: '/marketplace' },
      { label: t('Posts & Lots', 'Posztok & Csomagok'), href: '/marketplace/posts' },
      { label: post.title || (hasLotPrice ? t('Card Lot', 'Kártyacsomag') : t('Photo Post', 'Képes poszt')) },
    ];

    const setTaggedCardStatus = async (tc: P2PPostTaggedCard, nextStatus: 'available' | 'sold') => {
      if (!isOwnPost) return;
      if ((nextStatus === 'sold' && tc.status === 'sold') || (nextStatus === 'available' && tc.status !== 'sold')) {
        return;
      }
      setTagBusyId(tc.id);
      setActionError(null);
      try {
        await updateMarketplacePost({
          id: post.id,
          tag_status_update: { id: tc.id, status: nextStatus },
        });
        await loadItem();
      } catch (err: any) {
        setActionError(err?.message || t('Failed to update tagged card.', 'Nem sikerült módosítani a lap állapotát.'));
      } finally {
        setTagBusyId(null);
      }
    };

    const togglePostSold = async () => {
      if (!isOwnPost) return;
      const nextStatus = soldOutPost ? 'open' : 'sold_out';
      setActionError(null);
      try {
        await updateMarketplacePost({ id: post.id, status: nextStatus });
        await loadItem();
      } catch (err: any) {
        setActionError(err?.message || t('Failed to update post status.', 'Nem sikerült módosítani a poszt állapotát.'));
      }
    };

    const openTaggedCardHold = (tc: P2PPostTaggedCard) => {
      if (!requireSignedIn() || !tc.price_huf || tc.is_highlight_only) return;
      setHoldTarget({
        mode: 'post_card',
        title: tc.card.name,
        subtitle: `${tc.card.card_number}${tc.is_foil ? ' · Foil' : ''} · ${formatCondition(tc.condition, lang)}`,
        sellerName: post.seller.display_name,
        priceHuf: tc.price_huf,
        maxQuantity: tc.available_quantity,
        postId: post.id,
        postCardId: tc.id,
        imageUrl: tc.card.image_path ? getCardImageUrl(tc.card.image_path) : post.images?.[0] || null,
      });
    };

    return (
      <UnifiedProductDetail
        topBanner={renderInlineBanner()}
        breadcrumbs={postBreadcrumbs}
        topRightActions={renderCartButton()}
        images={post.images || []}
        alt={post.title || (hasLotPrice ? 'Card lot' : 'Photo post')}
        soldOut={soldOutPost}
        imageTopLeftBadges={
          <div className="flex items-center gap-1.5">
            <span
              className="text-[11px] font-black px-2.5 py-0.5 rounded-md border backdrop-blur-md shadow"
              style={{
                background: 'rgba(9, 9, 11, 0.78)',
                borderColor: 'rgba(255, 255, 255, 0.14)',
                color: hasLotPrice ? '#60a5fa' : '#34d399',
              }}
            >
              {hasLotPrice ? t('Lot / Post', 'Csomag') : t('Photo Post', 'Poszt')}
            </span>
            {isBundleOnly && !soldOutPost && (
              <span
                className="text-[11px] font-black px-2.5 py-0.5 rounded-md border backdrop-blur-md shadow"
                style={{
                  background: 'rgba(9, 9, 11, 0.78)',
                  borderColor: 'rgba(255, 255, 255, 0.14)',
                  color: '#fbbf24',
                }}
              >
                {t('Bundle only', 'Csak egyben')}
              </span>
            )}
          </div>
        }
        eyebrow={`${t('Posts & Lots', 'Posztok & Csomagok')} · ${post.tagged_cards.length} ${t('tagged cards', 'megjelölt lap')}`}
        title={post.title || (hasLotPrice ? t('Card Lot', 'Kártyacsomag') : t('Photo Post', 'Képes poszt'))}
        priceHuf={hasLotPrice ? post.lot_price_huf : minCardPrice}
        pricePrefix={hasLotPrice ? (minCardPrice != null ? t('Lot:', 'Csomagár:') : null) : minCardPrice != null ? t('From', 'Ettől:') : null}
        originalPriceHuf={showAdaptiveOriginal ? adaptivePricing!.available_total_huf : null}
        msrpLabel={showAdaptiveOriginal ? `−${adaptivePricing!.discount_pct}%` : null}
        priceFallbackText={!hasLotPrice && minCardPrice == null ? t('Price arranged in chat / per card', 'Ár üzenetben / laponként') : t('See description', 'Lásd a leírásban')}
        stockText={
          soldOutPost
            ? t('Sold out', 'Eladva')
            : heldPost
            ? t('Currently held', 'Félretéve')
            : t('Available', 'Elérhető')
        }
        stockTone={soldOutPost ? 'negative' : heldPost ? 'low' : 'positive'}
        priceRightSlot={
          <LikeButton
            liked={post.liked_by_me}
            count={post.likes_count}
            busy={likeBusyId === post.id}
            onToggle={async () => {
              if (!requireSignedIn()) return;
              setLikeBusyId(post.id);
              try {
                const r = await toggleLike({ post_id: post.id });
                setPost((p) => (p ? { ...p, liked_by_me: r.liked, likes_count: r.likes_count } : p));
              } finally {
                setLikeBusyId(null);
              }
            }}
          />
        }
        middleSlot={<SellerInfoCard seller={post.seller} />}
        description={renderedPostDesc}
        actions={
          isOwnPost ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditingPost(post)}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-black cursor-pointer hover:brightness-110"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
              >
                {t('Edit Post', 'Módosítás')}
              </button>
              <button
                type="button"
                onClick={togglePostSold}
                className="py-3 px-4 rounded-xl border text-sm font-bold cursor-pointer hover:border-[var(--accent)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {soldOutPost ? t('Reopen Post', 'Újra elérhető') : t('Mark Post Sold', 'Eladva')}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hasLotPrice && !soldOutPost && post.lot_price_huf != null && (
                <button
                  type="button"
                  onClick={() => {
                    if (!requireSignedIn()) return;
                    setHoldTarget({
                      mode: 'bulk_lot',
                      title: post.title || t('Card Lot', 'Kártyacsomag'),
                      subtitle: t('Entire lot', 'Teljes csomag'),
                      sellerName: post.seller.display_name,
                      priceHuf: post.lot_price_huf!,
                      maxQuantity: 1,
                      postId: post.id,
                      imageUrl: post.images[0] || null,
                    });
                  }}
                  className="flex-1 py-3 px-4 rounded-xl text-sm font-black cursor-pointer transition hover:brightness-110"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                >
                  {t('Hold Entire Lot', 'Csomag félretétele')}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  handleMessageSeller(
                    post.seller_id,
                    t(
                      `Hi! Question about your post: ${post.title || 'Post'}`,
                      `Szia! Kérdésem lenne a hirdetéseddel kapcsolatban: ${post.title || 'Poszt / Csomag'}`
                    )
                  )
                }
                className={`py-3 px-4 rounded-xl text-sm font-bold cursor-pointer ${
                  hasLotPrice && !soldOutPost && post.lot_price_huf != null ? 'border' : 'flex-1 font-black'
                }`}
                style={
                  hasLotPrice && !soldOutPost && post.lot_price_huf != null
                    ? { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }
                    : { background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }
                }
              >
                {t('Message Seller', 'Üzenet az eladónak')}
              </button>
            </div>
          )
        }
        specs={[
          { label: t('Category', 'Kategória'), value: t('Posts & Lots', 'Posztok & Csomagok') },
          { label: t('Photos', 'Fotók'), value: `${post.images.length} ${t('photos', 'db')}` },
          { label: t('Tagged Cards', 'Megjelölt lapok'), value: `${post.tagged_cards.length} ${t('cards', 'db')}` },
          ...(hasLotPrice
            ? [
                {
                  label: t('Sale type', 'Eladás módja'),
                  value: isBundleOnly ? t('Bundle only', 'Csak egyben eladó') : t('Splittable', 'Megbontható'),
                },
              ]
            : []),
          {
            label: t('Status', 'Állapot'),
            value: soldOutPost ? t('Sold Out', 'Eladva') : heldPost ? t('Held', 'Félretéve') : t('Open', 'Elérhető'),
          },
          { label: t('Posted', 'Közzétéve'), value: new Date(post.created_at).toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-US') },
        ]}
        belowSection={
          post.tagged_cards.length > 0 ? (
            <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  {t('Cards Included / Tagged', 'Megjelölt lapok ebben a posztban')} ({displayedTaggedCards.length}
                  {hideSoldTags && soldTagCount > 0 ? `/${post.tagged_cards.length}` : ''})
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {soldTagCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setHideSoldTags((v) => !v)}
                      className="px-2.5 py-1 rounded-lg border text-xs font-bold cursor-pointer transition"
                      style={
                        hideSoldTags
                          ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                          : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                      }
                    >
                      {hideSoldTags
                        ? t(`Show sold (${soldTagCount})`, `Eladottak mutatása (${soldTagCount})`)
                        : t(`Hide sold (${soldTagCount})`, `Eladottak elrejtése (${soldTagCount})`)}
                    </button>
                  )}
                  {post.tagged_cards.length > 1 && (
                    <select
                      value={tagSort}
                      onChange={(e) => setTagSort(e.target.value as 'default' | 'price_desc' | 'price_asc' | 'name_asc')}
                      aria-label={t('Sort cards', 'Lapok rendezése')}
                      className="h-7 px-2 rounded-lg border text-xs font-semibold outline-none focus:border-[var(--accent)] cursor-pointer"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <option value="default">{t('Default order', 'Alap sorrend')}</option>
                      <option value="price_desc">{t('Price: High → Low', 'Ár: csökkenő')}</option>
                      <option value="price_asc">{t('Price: Low → High', 'Ár: növekvő')}</option>
                      <option value="name_asc">{t('Name: A–Z', 'Név: A–Z')}</option>
                    </select>
                  )}
                  {isOwnPost && (
                    <button
                      type="button"
                      onClick={() => setEditingPost(post)}
                      className="text-xs font-bold hover:underline cursor-pointer"
                      style={{ color: 'var(--text-accent)' }}
                    >
                      {t('Manage Cards & Prices →', 'Lapok és árak szerkesztése →')}
                    </button>
                  )}
                </div>
              </div>

              {selectedTaggedCards.length > 0 && (
                <div
                  className="mb-3 px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 flex-wrap"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--accent-border)' }}
                >
                  <div className="flex items-center gap-2.5 flex-wrap text-xs">
                    <span className="font-black" style={{ color: 'var(--text-primary)' }}>
                      {t(`${selectedTaggedCards.length} selected`, `${selectedTaggedCards.length} lap kijelölve`)}
                    </span>
                    <span className="font-mono font-black text-emerald-400">
                      {formatPrice(selectedTotalHuf)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedTagIds([])}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      {t('Clear', 'Törlés')}
                    </button>
                    <button
                      type="button"
                      onClick={openBatchTaggedHold}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-black cursor-pointer hover:brightness-110"
                      style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                    >
                      {t(`Hold Selected (${selectedTaggedCards.length})`, `Kijelöltek félretétele (${selectedTaggedCards.length})`)}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {displayedTaggedCards.map((tc) => {
                  const thumb = tc.card?.image_path ? cardThumbProps(tc.card.image_path, 'avatar') : null;
                  const soldOutCard = tc.status === 'sold' || tc.quantity <= 0;
                  const allHeldCard = !soldOutCard && tc.available_quantity <= 0;
                  const hasFixedPrice = !tc.is_highlight_only && tc.price_huf != null && tc.price_huf > 0;
                  const canSelectCard = canMultiSelectTags && !soldOutCard && !allHeldCard && hasFixedPrice;
                  const isSelectedCard = canSelectCard && selectedTagSet.has(tc.id);
                  const containerSelectionActive = canSelectCard && selectedTaggedCards.length > 0;

                  return (
                    <div
                      key={tc.id}
                      onClick={containerSelectionActive ? () => toggleTagSelect(tc.id) : undefined}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition ${
                        containerSelectionActive ? 'cursor-pointer select-none hover:border-[var(--accent)]' : ''
                      }`}
                      style={{
                        background: 'var(--bg-surface)',
                        borderColor: isSelectedCard
                          ? 'var(--accent)'
                          : soldOutCard
                          ? 'rgba(244, 63, 94, 0.3)'
                          : 'var(--border)',
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {canSelectCard && (
                          <label
                            onClick={(e) => e.stopPropagation()}
                            className="-my-3 -ml-3 pl-3 pr-2 py-3 self-stretch flex items-center justify-center cursor-pointer shrink-0"
                            aria-label={t(`Select ${tc.card?.name}`, `${tc.card?.name} kijelölése`)}
                          >
                            <input
                              type="checkbox"
                              checked={isSelectedCard}
                              onChange={() => toggleTagSelect(tc.id)}
                              className="w-4 h-4 rounded accent-[var(--accent)] cursor-pointer"
                            />
                          </label>
                        )}
                        {thumb && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewCardId(tc.card_id);
                            }}
                            className="w-11 h-15 rounded-lg overflow-hidden border shrink-0 cursor-pointer hover:opacity-90"
                            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
                          >
                            <img src={thumb.src} alt={tc.card?.name} className={`w-full h-full object-cover ${soldOutCard ? 'opacity-50 grayscale' : ''}`} />
                          </button>
                        )}
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewCardId(tc.card_id);
                            }}
                            className={`text-sm font-black truncate block text-left hover:underline cursor-pointer ${soldOutCard ? 'line-through opacity-65' : ''}`}
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {tc.card?.name}
                          </button>
                          <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                            {tc.card?.card_number} · {tc.card?.sets?.name || ''} · {formatCondition(tc.condition, lang)}
                            {tc.is_foil ? ' · Foil' : ''}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {hasFixedPrice ? (
                              <span className="text-xs font-black font-mono text-emerald-400">
                                {formatPrice(tc.price_huf!)} · {tc.available_quantity}/{tc.quantity}
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                {hasLotPrice ? t('Included in lot · Ask in chat', 'Csomag része · Ár üzenetben') : t('Ask in chat', 'Ár üzenetben')}
                              </span>
                            )}
                            {soldOutCard && (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">
                                {t('Sold', 'Eladva')}
                              </span>
                            )}
                            {allHeldCard && (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                {t('Held', 'Félretéve')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {isOwnPost ? (
                          <div
                            className="inline-flex rounded-xl border p-0.5 gap-0.5"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
                          >
                            <button
                              type="button"
                              disabled={tagBusyId === tc.id || !soldOutCard}
                              onClick={() => setTaggedCardStatus(tc, 'available')}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                                !soldOutCard
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent cursor-pointer'
                              } disabled:cursor-default`}
                            >
                              {t('Available', 'Elérhető')}
                            </button>
                            <button
                              type="button"
                              disabled={tagBusyId === tc.id || soldOutCard}
                              onClick={() => setTaggedCardStatus(tc, 'sold')}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                                soldOutCard
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent cursor-pointer'
                              } disabled:cursor-default`}
                            >
                              {t('Sold', 'Eladva')}
                            </button>
                          </div>
                        ) : (
                          !soldOutCard &&
                          !allHeldCard &&
                          !isBundleOnly &&
                          (hasFixedPrice ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openTaggedCardHold(tc);
                              }}
                              className="px-3.5 py-2 rounded-xl text-xs font-black cursor-pointer hover:brightness-110"
                              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                            >
                              {t('Hold', 'Félreteszem')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                handleMessageSeller(
                                  post.seller_id,
                                  t(
                                    `Hi! Question about ${tc.card?.name} (${tc.card?.card_number}) from your post.`,
                                    `Szia! Érdeklődnék a posztodban lévő ${tc.card?.name} (${tc.card?.card_number}) lap iránt.`
                                  )
                                )
                              }
                              className="px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:border-[var(--accent)]"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                            >
                              {t('Message', 'Üzenet')}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <CardPreviewOverlay cardId={previewCardId} onClose={() => setPreviewCardId(null)} />
            </div>
          ) : undefined
        }
      >
        {renderCartAndModals()}
      </UnifiedProductDetail>
    );
  }

  // 2. Card Group (?card=) Redesign: 2-Column [Image | CardValuePanel + Graph], then Full-Width Listings Below
  if (cardGroup) {
    const card = cardGroup.card;
    const cardImg = card.image_path ? getCardImageUrl(card.image_path) : '';
    const eyebrow = [card.sets?.name, card.card_number].filter(Boolean).join(' · ') || null;

    return (
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-6 sm:py-8">
        {renderInlineBanner()}

        {/* Top Breadcrumb + Cart */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
            <a href="/marketplace" className="hover:underline" style={{ color: 'var(--text-muted)' }}>
              {t('Marketplace', 'Piactér')}
            </a>
            <span>/</span>
            <a href="/marketplace" className="hover:underline" style={{ color: 'var(--text-muted)' }}>
              {t('By Card', 'Kártyánként')}
            </a>
            {card.sets?.name && (
              <>
                <span>/</span>
                <span>{card.sets.name}</span>
              </>
            )}
            <span>/</span>
            <span className="font-semibold truncate max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
              {card.name}
            </span>
          </nav>

          {renderCartButton()}
        </div>

        {/* 2-Column Hero: Card Image (Left) + Title, Card Details & Value/Graph Panel (Right) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-8 items-start">
          <div className="md:col-span-5">
            <div
              onClick={() => cardImg && setCardLightboxOpen(true)}
              className={`relative aspect-square w-full rounded-2xl border overflow-hidden flex items-center justify-center ${cardImg ? 'cursor-zoom-in' : ''}`}
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
            >
              {cardImg ? (
                <img src={cardImg} alt={card.name} className="w-full h-full object-contain p-4" />
              ) : (
                <span className="text-xl font-black" style={{ color: 'var(--text-tertiary)' }}>TCG</span>
              )}
              {cardGroup.is_foil && (
                <span className="absolute top-3 left-3 text-[11px] font-black px-2.5 py-0.5 rounded-md bg-amber-500 text-zinc-950 shadow">
                  FOIL
                </span>
              )}
            </div>
          </div>

          <div className="md:col-span-7 min-w-0 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                {eyebrow && (
                  <p className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text-accent)' }}>
                    {eyebrow}
                  </p>
                )}
                <h1 className="text-2xl sm:text-3xl font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {card.name} {cardGroup.is_foil ? '(Foil)' : ''}
                </h1>
              </div>

              <button
                type="button"
                onClick={() => setPreviewCardId(card.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition hover:border-[var(--accent)] hover:brightness-110 cursor-pointer shrink-0"
                style={{ borderColor: 'var(--accent-border)', background: 'var(--accent-muted)', color: 'var(--text-accent)' }}
              >
                <span>{t('Card Details', 'Kártya adatlap')}</span>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            </div>

            <CardValuePanel card={card} isFoil={cardGroup.is_foil} className="mb-0" />
          </div>
        </div>

        {/* Full-Width Community Offers List Underneath */}
        <div className="mt-8">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="text-base sm:text-lg font-black" style={{ color: 'var(--text-primary)' }}>
              {t('Available Listings', 'Elérhető hirdetések')} ({cardGroup.offer_count})
            </h2>
            <span className="text-xs font-bold" style={{ color: 'var(--positive)' }}>
              {cardGroup.total_quantity} {t('in stock total', 'db összesen')}
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {cardGroup.offers.map((off) => {
              const isOwnOff = Boolean(userProfile && userProfile.id === off.seller_id);
              return (
                <div
                  key={off.id}
                  onClick={() => (window.location.href = `/marketplace/item?listing=${encodeURIComponent(off.id)}`)}
                  className="p-3.5 sm:p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:border-[var(--accent)] transition"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {off.images?.[0] && (
                      <img
                        src={off.images[0]}
                        alt={off.card.name}
                        className="w-12 h-16 rounded-lg object-cover border shrink-0"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] font-black px-1.5 py-0.5 rounded border"
                          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                        >
                          {off.seller.country}
                        </span>
                        {off.seller.avatar_url && (
                          <img
                            src={off.seller.avatar_url}
                            alt={off.seller.display_name}
                            className="w-5 h-5 rounded-full object-cover shrink-0"
                            style={resolveAvatarImageStyle(off.seller.avatar_url)}
                          />
                        )}
                        <a
                          href={getProfileUrl(off.seller)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs sm:text-sm font-black hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {off.seller.display_name}
                        </a>
                        {off.seller.rating_count > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-400">
                            <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                            <span>{off.seller.rating_avg.toFixed(1)}</span>
                            <span style={{ color: 'var(--text-tertiary)' }}>({off.seller.rating_count})</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 flex-wrap mt-1 text-xs">
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                          {formatCondition(off.condition, lang)}
                        </span>
                        {off.is_foil && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500 text-zinc-950">
                            Foil
                          </span>
                        )}
                        <span className="font-bold" style={{ color: 'var(--positive)' }}>
                          {off.quantity} {t('available', 'elérhető')}
                        </span>
                      </div>

                      {off.description && (
                        <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--text-tertiary)' }}>
                          {off.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-lg sm:text-xl font-black font-mono text-emerald-400 mr-2">
                      {formatPrice(off.price_huf)}
                    </span>

                    <LikeButton
                      compact
                      liked={off.liked_by_me}
                      count={off.likes_count}
                      busy={likeBusyId === off.id}
                      onToggle={async () => {
                        if (!requireSignedIn()) return;
                        setLikeBusyId(off.id);
                        try {
                          const r = await toggleLike({ listing_id: off.id });
                          setCardGroup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  offers: prev.offers.map((o) =>
                                    o.id === off.id ? { ...o, liked_by_me: r.liked, likes_count: r.likes_count } : o
                                  ),
                                }
                              : null
                          );
                        } finally {
                          setLikeBusyId(null);
                        }
                      }}
                    />

                    {isOwnOff ? (
                      <button
                        type="button"
                        onClick={() => setEditingListing(off)}
                        className="px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:border-[var(--accent)]"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        {t('Edit', 'Módosítás')}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleMessageSeller(off.seller_id, t(`Hi! Question about ${off.card.name}.`, `Szia! Kérdésem lenne a ${off.card.name} lappal kapcsolatban.`))}
                          className="px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:border-[var(--accent)]"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                        >
                          {t('Message', 'Üzenet')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddToCart(off, 1)}
                          className="px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:border-[var(--accent)]"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          {t('+ Cart', '+ Kosár')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!requireSignedIn()) return;
                            setHoldTarget({
                              mode: 'listing',
                              title: off.card.name,
                              subtitle: `${off.card.card_number}${off.is_foil ? ' · Foil' : ''} · ${formatCondition(off.condition, lang)}`,
                              sellerName: off.seller.display_name,
                              priceHuf: off.price_huf,
                              maxQuantity: off.quantity,
                              listingId: off.id,
                              imageUrl: off.images?.[0] || cardImg || null,
                            });
                          }}
                          className="px-4 py-2 rounded-xl text-xs font-black cursor-pointer hover:brightness-110"
                          style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                        >
                          {t('Hold', 'Félretétel')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {cardLightboxOpen && cardImg && (
          <ImageViewer open={cardLightboxOpen} onClose={() => setCardLightboxOpen(false)} src={cardImg} alt={card.name} />
        )}
        <CardPreviewOverlay cardId={previewCardId} onClose={() => setPreviewCardId(null)} />
        {renderCartAndModals()}
      </div>
    );
  }

  // 3. Single Listing (?listing=) via UnifiedProductDetail
  if (!listing) return null;

  const activeCard = listing.card;
  const galleryImages = [...(listing.images || []), ...(activeCard?.image_path ? [getCardImageUrl(activeCard.image_path)] : [])];
  const uniqueImages = Array.from(new Set(galleryImages.filter(Boolean)));
  const isOwnListing = Boolean(userProfile && userProfile.id === listing.seller_id);
  const soldOut = listing.quantity <= 0 || listing.status !== 'In Stock';

  const gameLabel = activeCard?.game ? GAMES.find((g) => g.id === activeCard.game)?.name || activeCard.game : null;
  const eyebrow = [activeCard?.sets?.name, activeCard?.card_number].filter(Boolean).join(' · ') || null;

  const breadcrumbs: BreadcrumbItem[] = [
    { label: t('Marketplace', 'Piactér'), href: '/marketplace' },
    { label: t('All Listings', 'Összes hirdetés'), href: '/marketplace/listings' },
    ...(activeCard?.sets?.name ? [{ label: activeCard.sets.name }] : []),
    { label: activeCard?.name || 'Item' },
  ];

  return (
    <UnifiedProductDetail
      topBanner={renderInlineBanner()}
      breadcrumbs={breadcrumbs}
      topRightActions={renderCartButton()}
      images={uniqueImages}
      alt={activeCard?.name || 'Card'}
      soldOut={soldOut}
      imageTopLeftBadges={
        listing.is_foil ? (
          <span className="text-[11px] font-black px-2.5 py-0.5 rounded-md bg-amber-500 text-zinc-950 shadow">
            FOIL
          </span>
        ) : undefined
      }
      eyebrow={eyebrow}
      title={activeCard?.name || ''}
      priceHuf={listing.price_huf}
      stockText={
        soldOut
          ? t('Out of stock', 'Elfogyott')
          : `${listing.quantity} ${t('available', 'elérhető')} · ${listing.status}`
      }
      stockTone={soldOut ? 'negative' : 'positive'}
      cardDetailsId={activeCard?.id || null}
      priceRightSlot={
        <LikeButton
          liked={listing.liked_by_me}
          count={listing.likes_count}
          busy={likeBusyId === listing.id}
          onToggle={async () => {
            if (!requireSignedIn()) return;
            setLikeBusyId(listing.id);
            try {
              const r = await toggleLike({ listing_id: listing.id });
              setListing((prev) => (prev ? { ...prev, liked_by_me: r.liked, likes_count: r.likes_count } : prev));
            } finally {
              setLikeBusyId(null);
            }
          }}
        />
      }
      condition={listing.condition}
      middleSlot={<SellerInfoCard seller={listing.seller} />}
      description={listing.description}
      actions={
        isOwnListing ? (
          <button
            type="button"
            onClick={() => setEditingListing(listing)}
            className="py-3 px-5 rounded-xl border text-sm font-black cursor-pointer hover:border-[var(--accent)] self-start"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {t('Edit Listing', 'Hirdetés módosítása')}
          </button>
        ) : !soldOut ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              {listing.quantity > 1 && (
                <div className="inline-flex items-center rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}>
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-10 h-11 flex items-center justify-center text-sm font-black cursor-pointer hover:bg-[var(--bg-raised)]">-</button>
                  <span className="px-4 text-sm font-black tabular-nums">{qty}</span>
                  <button type="button" onClick={() => setQty((q) => Math.min(listing.quantity, q + 1))} className="w-10 h-11 flex items-center justify-center text-sm font-black cursor-pointer hover:bg-[var(--bg-raised)]">+</button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  if (!requireSignedIn()) return;
                  setHoldTarget({
                    mode: 'listing',
                    title: listing.card.name,
                    subtitle: `${listing.card.card_number}${listing.is_foil ? ' · Foil' : ''} · ${formatCondition(listing.condition, lang)}`,
                    sellerName: listing.seller.display_name,
                    priceHuf: listing.price_huf,
                    maxQuantity: listing.quantity,
                    listingId: listing.id,
                    imageUrl: uniqueImages[0] || null,
                  });
                }}
                className="flex-1 min-w-[160px] py-3 px-5 rounded-xl text-sm font-black cursor-pointer hover:brightness-110"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
              >
                {t('Request Hold', 'Félretétel')}
              </button>

              <button
                type="button"
                onClick={() => handleAddToCart(listing, qty)}
                className="py-3 px-4 rounded-xl border text-sm font-bold cursor-pointer hover:border-[var(--accent)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {cartFeedback || t('+ Cart', '+ Kosár')}
              </button>

              <button
                type="button"
                onClick={() =>
                  handleMessageSeller(
                    listing.seller_id,
                    t(`Hi! Question about ${listing.card.name} (${listing.card.card_number}).`, `Szia! Kérdésem lenne a ${listing.card.name} (${listing.card.card_number}) lappal kapcsolatban.`)
                  )
                }
                className="py-3 px-4 rounded-xl border text-sm font-bold cursor-pointer hover:border-[var(--accent)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {t('Message', 'Üzenet')}
              </button>
            </div>
          </div>
        ) : null
      }
      afterActionsSlot={
        <div className="pt-1 flex items-center justify-between text-xs">
          <a
            href={`/marketplace/item?card=${encodeURIComponent(listing.card_id)}&foil=${listing.is_foil}`}
            className="font-bold hover:underline"
            style={{ color: 'var(--text-accent)' }}
          >
            {t('All seller offers for this card →', 'Összes ajánlat ehhez a kártyához →')}
          </a>
        </div>
      }
      specs={[
        { label: t('Category', 'Kategória'), value: t('Singles', 'Egyedi kártyák (Singles)') },
        { label: t('Game', 'Játék'), value: gameLabel },
        { label: t('Set', 'Kiadás'), value: activeCard?.sets?.name },
        { label: t('Card Number', 'Kártyaszám'), value: activeCard?.card_number },
        { label: t('Rarity', 'Ritkaság'), value: activeCard?.rarity },
        { label: t('Condition', 'Állapot'), value: formatCondition(listing.condition, lang) },
        { label: t('Finish', 'Kivitel'), value: listing.is_foil ? 'Foil' : t('Normal', 'Normál') },
        { label: t('Stock', 'Készlet'), value: `${listing.quantity} ${t('available', 'db elérhető')}` },
      ]}
    >
      {renderCartAndModals()}
    </UnifiedProductDetail>
  );
}
