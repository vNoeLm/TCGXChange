import { useCallback, useEffect, useState } from 'react';
import { getCurrentProfile, isProfileAdmin, onSignedInUserChange } from '../../lib/auth';
import { formatCondition } from '../../lib/collectionDefaults';
import { GAMES } from '../../lib/constants';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { isP2PEnabledFor } from '../../lib/p2pConstants';
import {
  fetchListings,
  fetchPosts,
  loadP2PCart,
  saveP2PCart,
  startP2PConversation,
  toggleLike,
  type P2PCardGroup,
  type P2PCartEntry,
  type P2PListing,
  type P2PPost,
} from '../../lib/p2pClient';
import { getProfileUrl } from '../../lib/profileUrl';
import { getCardImageUrl } from '../../lib/supabase';
import type { UserProfile } from '../../types';
import { AuthModal } from '../auth/AuthModal';
import { UnifiedProductDetail, type BreadcrumbItem } from '../product/UnifiedProductDetail';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';
import { EditListingModal } from './EditListingModal';
import { HoldConfirmModal, type HoldTarget } from './HoldConfirmModal';
import { LikeButton } from './LikeButton';
import { PhotoPostCard } from './PhotoPostCard';

/**
 * Unified P2P item detail page (?listing=, ?post=, or ?card=) sharing StoreProductApp's visual layout.
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
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [editingListing, setEditingListing] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{ text: string; conversationId?: string } | null>(null);

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
    try {
      const res = await startP2PConversation(sellerId, prefill);
      window.location.href = `/messages?conversation=${encodeURIComponent(res.conversation_id)}`;
    } catch (err: any) {
      setError(err?.message || 'Chat failed');
    }
  };

  const handleAddToCart = (targetListing: P2PListing, addQty = 1) => {
    if (!requireSignedIn()) return;
    const prev = loadP2PCart();
    const existing = prev.find((e) => e.listingId === targetListing.id);
    const next: P2PCartEntry[] = existing
      ? prev.map((e) =>
          e.listingId === targetListing.id
            ? { ...e, quantity: Math.min(targetListing.quantity, e.quantity + addQty), listing: targetListing }
            : e
        )
      : [...prev, { listingId: targetListing.id, quantity: Math.min(targetListing.quantity, addQty), listing: targetListing }];
    saveP2PCart(next);
    setCartFeedback(t('Added to Hold Cart', 'Kosárba téve'));
    setTimeout(() => setCartFeedback(null), 2500);
  };

  if (authLoading || loading) {
    return (
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-8">
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
            {t('Back to Marketplace', 'Vissza a Piactérre')}
          </a>
        </div>
      </div>
    );
  }

  if (post) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <nav className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
          <a href="/marketplace" className="hover:underline font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {t('Marketplace', 'Piactér')}
          </a>
          <span>/</span>
          <a
            href={post.post_type === 'bulk' ? '/marketplace/bulk' : '/marketplace/posts'}
            className="hover:underline font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            {post.post_type === 'bulk' ? t('Bulk', 'Bulk') : t('Photo Posts', 'Fotós posztok')}
          </a>
          <span>/</span>
          <span className="font-bold truncate max-w-[260px]" style={{ color: 'var(--text-primary)' }}>
            {post.title || post.seller.display_name}
          </span>
        </nav>

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

        <PhotoPostCard
          post={post}
          currentUserId={userProfile?.id || null}
          likeBusy={likeBusy}
          onToggleLike={async (id) => {
            if (!requireSignedIn()) return;
            setLikeBusy(true);
            try {
              const r = await toggleLike({ post_id: id });
              setPost((p) => (p ? { ...p, liked_by_me: r.liked, likes_count: r.likes_count } : p));
            } finally {
              setLikeBusy(false);
            }
          }}
          onHoldRequest={(target) => {
            if (requireSignedIn()) setHoldTarget(target);
          }}
          onMessageSeller={handleMessageSeller}
        />

        {holdTarget && (
          <HoldConfirmModal
            target={holdTarget}
            onClose={() => setHoldTarget(null)}
            onSuccess={(convId) => {
              setHoldTarget(null);
              setBannerNotice({ text: t('Hold request sent.', 'Félretétel elküldve.'), conversationId: convId });
              loadItem();
            }}
          />
        )}
      </div>
    );
  }

  const activeCard = listing?.card || cardGroup?.card;
  const galleryImages = listing
    ? [...(listing.images || []), ...(activeCard?.image_path ? [getCardImageUrl(activeCard.image_path)] : [])]
    : activeCard?.image_path
    ? [getCardImageUrl(activeCard.image_path)]
    : [];
  const uniqueImages = Array.from(new Set(galleryImages.filter(Boolean)));
  const isOwnListing = Boolean(listing && userProfile && userProfile.id === listing.seller_id);
  const soldOut = listing ? listing.quantity <= 0 || listing.status !== 'In Stock' : false;

  const gameLabel = activeCard?.game ? GAMES.find((g) => g.id === activeCard.game)?.name || activeCard.game : null;
  const eyebrow = [activeCard?.sets?.name, activeCard?.card_number].filter(Boolean).join(' · ') || null;

  const breadcrumbs: BreadcrumbItem[] = [
    { label: t('Marketplace', 'Piactér'), href: '/marketplace' },
    { label: listing ? t('All Listings', 'Összes hirdetés') : t('By Card', 'Kártyánként'), href: listing ? '/marketplace/listings' : '/marketplace' },
    ...(activeCard?.sets?.name ? [{ label: activeCard.sets.name }] : []),
    { label: activeCard?.name || 'Item' },
  ];

  return (
    <UnifiedProductDetail
      topBanner={
        bannerNotice ? (
          <div className="mb-4 px-4 py-2.5 rounded-xl border flex items-center justify-between gap-2" style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.4)' }}>
            <span className="text-xs font-bold text-emerald-300">{bannerNotice.text}</span>
            {bannerNotice.conversationId && (
              <a href={`/messages?conversation=${encodeURIComponent(bannerNotice.conversationId)}`} className="px-3 py-1 rounded-lg text-xs font-black bg-emerald-500 text-zinc-950">
                {t('Open Chat', 'Chat megnyitása')}
              </a>
            )}
          </div>
        ) : undefined
      }
      breadcrumbs={breadcrumbs}
      topRightActions={
        <a
          href={listing ? '/marketplace/listings' : '/marketplace'}
          className="px-3 py-1.5 rounded-xl border text-xs font-bold hover:border-[var(--accent)]"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          ← {t('Marketplace', 'Piactér')}
        </a>
      }
      images={uniqueImages}
      alt={activeCard?.name || 'Card'}
      soldOut={soldOut}
      imageTopLeftBadges={
        (listing?.is_foil || cardGroup?.is_foil) ? (
          <span className="text-[11px] font-black px-2.5 py-0.5 rounded-md bg-amber-500 text-zinc-950 shadow">
            FOIL
          </span>
        ) : undefined
      }
      eyebrow={eyebrow}
      title={activeCard?.name || ''}
      priceHuf={listing ? listing.price_huf : cardGroup ? cardGroup.lowest_price_huf : null}
      stockText={
        listing
          ? `${listing.quantity} ${t('available', 'elérhető')} · ${listing.status}`
          : cardGroup
          ? `${cardGroup.offer_count} ${cardGroup.offer_count === 1 ? t('offer', 'ajánlat') : t('offers', 'ajánlat')} · ${cardGroup.total_quantity} db`
          : ''
      }
      stockTone={soldOut ? 'negative' : 'positive'}
      cardDetailsId={activeCard?.id || null}
      priceRightSlot={
        listing ? (
          <LikeButton
            liked={listing.liked_by_me}
            count={listing.likes_count}
            busy={likeBusy}
            onToggle={async () => {
              if (!requireSignedIn()) return;
              setLikeBusy(true);
              try {
                const r = await toggleLike({ listing_id: listing.id });
                setListing((prev) => (prev ? { ...prev, liked_by_me: r.liked, likes_count: r.likes_count } : prev));
              } finally {
                setLikeBusy(false);
              }
            }}
          />
        ) : undefined
      }
      condition={listing?.condition || null}
      middleSlot={
        listing ? (
          <a
            href={getProfileUrl(listing.seller)}
            className="p-3.5 rounded-2xl border flex items-center justify-between gap-3 hover:border-[var(--accent)] transition"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              {listing.seller.avatar_url ? (
                <img
                  src={listing.seller.avatar_url}
                  alt={listing.seller.display_name}
                  className="w-10 h-10 rounded-full object-cover border shrink-0"
                  style={{ borderColor: 'var(--border)', ...resolveAvatarImageStyle(listing.seller.avatar_url) }}
                />
              ) : (
                <div className="w-10 h-10 rounded-full border flex items-center justify-center text-sm font-black shrink-0" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--accent)' }}>
                  {listing.seller.display_name[0]?.toUpperCase() || 'U'}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>
                  {listing.seller.display_name}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {listing.seller.country}
                  {listing.seller.rating_count > 0 && (
                    <span className="ml-2 text-amber-400 font-bold">
                      ★ {listing.seller.rating_avg.toFixed(1)} ({listing.seller.rating_count})
                    </span>
                  )}
                </div>
              </div>
            </div>
            <span className="text-xs font-bold shrink-0" style={{ color: 'var(--text-accent)' }}>
              {t('Profile', 'Profil')} →
            </span>
          </a>
        ) : undefined
      }
      actions={
        listing ? (
          isOwnListing ? (
            <button
              type="button"
              onClick={() => setEditingListing(true)}
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
        ) : cardGroup ? (
          <div className="flex flex-col gap-2">
            {cardGroup.offers.map((off) => {
              const isOwnOff = Boolean(userProfile && userProfile.id === off.seller_id);
              return (
                <div
                  key={off.id}
                  onClick={() => (window.location.href = `/marketplace/item?listing=${encodeURIComponent(off.id)}`)}
                  className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 cursor-pointer hover:border-[var(--accent)] transition"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                      {off.seller.display_name} <span className="font-normal text-[11px]" style={{ color: 'var(--text-tertiary)' }}>({off.seller.country})</span>
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {formatCondition(off.condition, lang)} · {off.quantity} db
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-sm font-black font-mono text-emerald-400 mr-1">
                      {formatPrice(off.price_huf)}
                    </span>
                    {!isOwnOff && (
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
                            imageUrl: off.images?.[0] || uniqueImages[0] || null,
                          });
                        }}
                        className="px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                      >
                        {t('Hold', 'Félretétel')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null
      }
      afterActionsSlot={
        listing ? (
          <div className="pt-1 flex items-center justify-between text-xs">
            <a
              href={`/marketplace/item?card=${encodeURIComponent(listing.card_id)}&foil=${listing.is_foil}`}
              className="font-bold hover:underline"
              style={{ color: 'var(--text-accent)' }}
            >
              {t('All seller offers for this card →', 'Összes ajánlat ehhez a kártyához →')}
            </a>
          </div>
        ) : undefined
      }
      description={listing?.description || null}
      specs={[
        { label: t('Category', 'Kategória'), value: t('Singles', 'Egyedi kártyák (Singles)') },
        { label: t('Game', 'Játék'), value: gameLabel },
        { label: t('Set', 'Kiadás'), value: activeCard?.sets?.name },
        { label: t('Card Number', 'Kártyaszám'), value: activeCard?.card_number },
        { label: t('Rarity', 'Ritkaság'), value: activeCard?.rarity },
        { label: t('Condition', 'Állapot'), value: listing ? formatCondition(listing.condition, lang) : null },
        { label: t('Finish', 'Kivitel'), value: (listing?.is_foil ?? cardGroup?.is_foil) ? 'Foil' : t('Normal', 'Normál') },
        { label: t('Stock', 'Készlet'), value: listing ? `${listing.quantity} ${t('available', 'db elérhető')}` : cardGroup ? `${cardGroup.total_quantity} db` : null },
      ]}
    >
      {holdTarget && (
        <HoldConfirmModal
          target={holdTarget}
          onClose={() => setHoldTarget(null)}
          onSuccess={(convId) => {
            setHoldTarget(null);
            setBannerNotice({ text: t('Hold request sent.', 'Félretétel elküldve.'), conversationId: convId });
            loadItem();
          }}
        />
      )}

      {editingListing && listing && (
        <EditListingModal
          listing={listing}
          onClose={() => setEditingListing(false)}
          onSaved={() => {
            setEditingListing(false);
            loadItem();
          }}
          onDeleted={() => {
            window.location.href = '/marketplace';
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
    </UnifiedProductDetail>
  );
}
