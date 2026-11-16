import { useCallback, useEffect, useState } from 'react';
import { getCurrentProfile, isProfileAdmin, onSignedInUserChange } from '../../lib/auth';
import { formatCondition } from '../../lib/collectionDefaults';
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
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';
import { HoldConfirmModal, type HoldTarget } from './HoldConfirmModal';
import { LikeButton } from './LikeButton';
import { PhotoPostCard } from './PhotoPostCard';

/**
 * Store-product-page-style detail view for any P2P listing, post, bulk lot, or grouped card.
 * URL parameters: ?listing=<uuid> OR ?post=<uuid> OR ?card=<uuid>&foil=true|false
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

  const [imageIndex, setImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
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

  // If viewing a Photo Post or Bulk Lot detail
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

  // Listing or Card Group Store-Product-Page layout
  const activeCard = listing?.card || cardGroup?.card;
  const galleryImages = listing
    ? [...(listing.images || []), ...(activeCard?.image_path ? [getCardImageUrl(activeCard.image_path)] : [])]
    : activeCard?.image_path
    ? [getCardImageUrl(activeCard.image_path)]
    : [];
  const uniqueImages = Array.from(new Set(galleryImages.filter(Boolean)));
  const isOwnListing = Boolean(listing && userProfile && userProfile.id === listing.seller_id);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <nav className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
          <a href="/marketplace" className="hover:underline font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {t('Marketplace', 'Piactér')}
          </a>
          <span>/</span>
          <a
            href={listing ? '/marketplace/listings' : '/marketplace'}
            className="hover:underline font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            {listing ? t('All Listings', 'Összes hirdetés') : t('By Card', 'Kártyánként')}
          </a>
          {activeCard?.sets?.name && (
            <>
              <span>/</span>
              <span>{activeCard.sets.name}</span>
            </>
          )}
          <span>/</span>
          <span className="font-bold truncate max-w-[220px]" style={{ color: 'var(--text-primary)' }}>
            {activeCard?.name}
          </span>
        </nav>

        <a
          href="/marketplace"
          className="px-3 py-1.5 rounded-xl border text-xs font-bold hover:border-[var(--accent)]"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          ← {t('Marketplace', 'Piactér')}
        </a>
      </div>

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

      {/* 2-Column Store-Product-Page Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10 items-start">
        {/* Left Gallery */}
        <div>
          <div
            onClick={() => uniqueImages.length > 0 && setLightboxOpen(true)}
            className="relative aspect-[5/6] w-full rounded-2xl border overflow-hidden flex items-center justify-center cursor-zoom-in"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
          >
            {uniqueImages[imageIndex] ? (
              <img
                src={uniqueImages[imageIndex]}
                alt={activeCard?.name || 'Card'}
                className="w-full h-full object-contain p-4"
              />
            ) : (
              <span className="text-xl font-black" style={{ color: 'var(--text-tertiary)' }}>
                TCG
              </span>
            )}
          </div>

          {uniqueImages.length > 1 && (
            <div className="flex gap-2 mt-2.5 overflow-x-auto pb-1">
              {uniqueImages.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  className={`w-16 h-20 rounded-xl overflow-hidden border shrink-0 cursor-pointer ${
                    i === imageIndex ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ borderColor: i === imageIndex ? 'var(--accent)' : 'var(--border)' }}
                >
                  <img src={src} alt={`Thumb ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Product Details & Actions */}
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {activeCard?.rarity && (
                <span className="text-[11px] font-black uppercase px-2.5 py-0.5 rounded-lg border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                  {activeCard.rarity}
                </span>
              )}
              {(listing?.is_foil || cardGroup?.is_foil) && (
                <span className="text-[11px] font-black uppercase px-2.5 py-0.5 rounded-lg bg-amber-500 text-zinc-950">
                  Foil
                </span>
              )}
              {listing && (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-lg border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                  {formatCondition(listing.condition, lang)}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {activeCard?.name}
            </h1>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {[activeCard?.sets?.name, activeCard?.card_number, activeCard?.card_type].filter(Boolean).join(' · ')}
            </p>
          </div>

          {listing ? (
            <>
              {/* Big Price + Stock */}
              <div className="p-4 rounded-2xl border flex items-center justify-between gap-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                <div>
                  <div className="text-3xl font-black font-mono text-emerald-400">
                    {formatPrice(listing.price_huf)}
                  </div>
                  <div className="text-xs font-bold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {listing.quantity} {t('In Stock', 'elérhető')} · {listing.status}
                  </div>
                </div>
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
              </div>

              {/* Seller Box */}
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

              {listing.description && (
                <div className="p-3.5 rounded-2xl border text-xs sm:text-sm" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                  {listing.description}
                </div>
              )}

              {/* Actions */}
              {!isOwnListing && listing.status === 'In Stock' && listing.quantity > 0 && (
                <div className="flex flex-col gap-2.5">
                  {listing.quantity > 1 && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                      <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{t('Quantity', 'Mennyiség')}</span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-7 h-7 rounded-lg border font-bold cursor-pointer" style={{ borderColor: 'var(--border)' }}>-</button>
                        <span className="text-sm font-black w-6 text-center">{qty}</span>
                        <button type="button" onClick={() => setQty((q) => Math.min(listing.quantity, q + 1))} className="w-7 h-7 rounded-lg border font-bold cursor-pointer" style={{ borderColor: 'var(--border)' }}>+</button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
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
                      className="flex-1 min-w-[160px] py-3 px-4 rounded-xl text-sm font-black cursor-pointer hover:brightness-110"
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
              )}

              <div className="pt-2 flex items-center justify-between text-xs">
                <a
                  href={`/marketplace/item?card=${encodeURIComponent(listing.card_id)}&foil=${listing.is_foil}`}
                  className="font-bold hover:underline"
                  style={{ color: 'var(--text-accent)' }}
                >
                  {t('All seller offers for this card →', 'Összes ajánlat ehhez a kártyához →')}
                </a>
                <a
                  href={`/card?id=${encodeURIComponent(listing.card_id)}`}
                  className="font-bold hover:underline"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t('Catalog Card Page', 'Katalógus oldal')}
                </a>
              </div>
            </>
          ) : cardGroup ? (
            <div className="flex flex-col gap-3">
              <div className="p-4 rounded-2xl border flex items-center justify-between" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                <div>
                  <div className="text-xs font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>{t('From', 'Tól')}</div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-400">
                    {formatPrice(cardGroup.lowest_price_huf)}
                  </div>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                  {cardGroup.offer_count} {cardGroup.offer_count === 1 ? t('offer', 'ajánlat') : t('offers', 'ajánlat')} · {cardGroup.total_quantity} db
                </span>
              </div>

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
            </div>
          ) : null}
        </div>
      </div>

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

      {lightboxOpen && uniqueImages[imageIndex] && (
        <div className="fixed inset-0 z-[2500] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setLightboxOpen(false)}>
          <img src={uniqueImages[imageIndex]} alt={activeCard?.name || 'Full size'} className="max-w-full max-h-[90vh] rounded-2xl object-contain" />
        </div>
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
    </div>
  );
}
