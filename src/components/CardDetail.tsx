import React, { useState, useEffect, useRef } from 'react';
import type { CatalogCard, UserProfile, SellerProfileSummary } from '../types';
import { fetchCardDetail, fetchCardOnly, clearStoreCache, clearApiCache, getDisplayConditionNotes } from '../lib/api';
import { getCardImageUrl, supabase } from '../lib/supabase';
import { getCurrentProfile, isProfileAdmin } from '../lib/auth';
import { fetchSellerRatingSummary } from '../lib/reviews';
import { getSellerTier, BadgeIconSvg, SiteOwnerTag } from '../lib/badges';
import { useSiteTheme } from '../lib/theme';
import { parseDomains, getEnergyBadgeStyle } from '../lib/domainColors';

const RARITY_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  Common:          { bg: "rgba(31, 41, 55, 0.9)", text: "#cbd5e1", glow: "rgba(203, 213, 225, 0.2)" },
  Uncommon:        { bg: "rgba(12, 74, 110, 0.9)", text: "#38bdf8", glow: "rgba(56, 189, 248, 0.4)" },
  Rare:            { bg: "rgba(88, 28, 135, 0.9)", text: "#d8b4fe", glow: "rgba(216, 180, 254, 0.5)" },
  Epic:            { bg: "rgba(154, 52, 18, 0.9)", text: "#fb923c", glow: "rgba(251, 146, 60, 0.5)" },
  Showcase:        { bg: "rgba(113, 63, 18, 0.9)", text: "#fde047", glow: "rgba(253, 224, 71, 0.6)" },
};

import { formatGameText, splitCardTitle, formatCleanCardNumber } from '../lib/formatGameText';
import { TYPE_ICONS, RUNE_ICONS, RARITY_ICONS } from '../lib/riftboundIcons';
import { isOvernumbered, isSigned, isAltArt } from '../lib/cardVariants';
import { getCardPowerRequirement } from '../lib/cardPowerData';
import { isNeutralCard } from '../lib/riftboundRules';
import { addToCart, removeFromCart, updateCartItemQuantity, cartQuantityFor, openCart, type MarketplaceCartItem } from '../lib/marketplaceCart';
import { useCart } from '../lib/useCart';
import { CardImageViewer } from './CardImageViewer';
import { useUrlOverlay } from '../lib/useUrlOverlay';
import { HANDOVER_METHODS, listingHandoverIds } from '../lib/handover';
import { describeOption, shippingOption, type ShippingSettings } from '../lib/shipping';
import { fetchShippingSettings } from '../lib/shippingClient';
import { CountryFlag } from './CountryFlag';
import { getCountry } from '../lib/countries';
import { ListCardModal } from './marketplace/ListCardModal';
import { SellerReviewsModal } from './marketplace/SellerReviewsModal';
import { ListingLikeButton } from './marketplace/ListingLikeButton';
import { AuthModal } from './auth/AuthModal';
import { CardValuePanel } from './CardValuePanel';
import { ReportModal } from './common/ReportModal';
import { MoveCardModal } from './collection/MoveCardModal';
import { WishlistControls } from './wishlists/WishlistControls';
import { hasFoilVariant } from '../lib/cardVariants';
import { saveLocalCollection } from '../lib/collectionClient';
import { PERSONAL_COLLECTION_ID } from '../lib/collectionDefaults';
import { useCollectionsStore, activeNamedCollection, changeCollectionCard } from '../lib/collectionsStore';
import { listPriceForCard } from '../lib/collectionPricing';
import { printLanguage } from '../lib/cardPreview';
import { useCardValueData } from '../lib/cardValues';
import { useCurrency } from '../lib/currency';
import { OWNER_ID } from '../lib/constants';

const fmt = (n: number) =>
  new Intl.NumberFormat('hu-HU', { style:'currency', currency:'HUF', maximumFractionDigits:0 }).format(n);

export function CardDetail({ inventoryId, cardId, onClose }: { inventoryId?: string, cardId?: string, onClose?: () => void }) {
  const isLightTheme = useSiteTheme().theme === 'light';
  const { formatPrice } = useCurrency();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  // The image on its own, full screen, where it can be rotated (?view=full, so Back closes it).
  const [fullView, openFullView, closeFullView] = useUrlOverlay('view');
  const [isInventory, setIsInventory] = useState(false);
  // Personal, from this browser; the tracker shows whichever collection is active in the catalog.
  const [personalCollection, setCollection] = useState<Record<string, number>>({});
  const collectionsStore = useCollectionsStore();
  const activeNamed = activeNamedCollection(collectionsStore);
  const collection = activeNamed ? activeNamed.cards : personalCollection;
  const cardValuesForListing = useCardValueData();
  const cart = useCart();
  // "Added to cart" confirmation on the button - the floating cart button that also reacts sits
  // behind this overlay, so without it nothing visible happened on click.
  const [justAdded, setJustAdded] = useState(false);
  const justAddedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (justAddedTimer.current) clearTimeout(justAddedTimer.current); }, []);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  // Existing buyer/seller thread with this listing's seller, if there is one. Messaging is only
  // available between people who already have a conversation (a hold request creates it).
  const [sellerConversationId, setSellerConversationId] = useState<string | null>(null);
  const [moveToast, setMoveToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const moveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLocalToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (moveToastTimerRef.current) clearTimeout(moveToastTimerRef.current);
    setMoveToast({ msg, type });
    moveToastTimerRef.current = setTimeout(() => setMoveToast(null), 3500);
  };

  // Admin Quick Edit State
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editPriceHuf, setEditPriceHuf] = useState<string>('');
  const [editCondition, setEditCondition] = useState<string>('Near Mint');
  const [editQuantity, setEditQuantity] = useState<number>(1);
  const [isSavingAdmin, setIsSavingAdmin] = useState(false);
  const [adminFeedback, setAdminFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const adminPhotoInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = isProfileAdmin(profile);
  const [sellerSummary, setSellerSummary] = useState<SellerProfileSummary | null>(null);
  const [reviewsModalSellerId, setReviewsModalSellerId] = useState<string | null>(null);
  // Closing nulls this immediately, but the modal needs a sellerId for the length of its own
  // exit transition - freeze the last non-null value instead of reading the live one.
  const reviewsModalSellerIdRef = useRef<string | null>(null);
  if (reviewsModalSellerId) reviewsModalSellerIdRef.current = reviewsModalSellerId;

  // The seller's delivery prices and minimums, shown under the listing's price.
  const [sellerShipping, setSellerShipping] = useState<ShippingSettings | null>(null);
  const shippingSellerId = data?.seller_id || sellerSummary?.id || null;
  useEffect(() => {
    if (!isInventory || !shippingSellerId) return;
    fetchShippingSettings([shippingSellerId]).then(map => setSellerShipping(map[shippingSellerId] ?? null));
  }, [isInventory, shippingSellerId]);

  useEffect(() => {
    if (data?.seller_id) {
      fetchSellerRatingSummary(data.seller_id).then(s => setSellerSummary(s));
    } else if (isInventory && data) {
      fetchSellerRatingSummary().then(s => setSellerSummary(s));
    }
  }, [data?.seller_id, isInventory, Boolean(data)]);

  useEffect(() => {

    const loadCollection = () => {
      const saved = localStorage.getItem("tcg_user_collection") || localStorage.getItem("tcg_collection");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const dict: Record<string, number> = {};
            parsed.forEach((id: string) => { if (typeof id === 'string') dict[id] = 1; });
            setCollection(dict);
          } else if (parsed && typeof parsed === 'object') {
            setCollection(parsed);
          }
        } catch (e) {}
      }
    };
    loadCollection();

    const handleColChange = (e: Event) => {
      const custom = e as CustomEvent<{ collection: Record<string, number> }>;
      if (custom.detail?.collection) setCollection(custom.detail.collection);
    };
    window.addEventListener('tcg-collection-change', handleColChange);

    getCurrentProfile().then(p => setProfile(p));

    return () => {
      window.removeEventListener('tcg-collection-change', handleColChange);
    };
  }, []);

  // Sync admin state with current card data
  useEffect(() => {
    if (data) {
      setEditPriceHuf(data.price_huf ? String(data.price_huf) : '');
      setEditCondition(data.condition || 'Near Mint');
      setEditQuantity(data.quantity || 1);
    }
  }, [data]);

  const handleUpdateCount = (targetCardId: string, isFoil: boolean, delta: number) => {
    if (!targetCardId) return;
    const targetKey = isFoil ? `${targetCardId}_foil` : targetCardId;
    if (activeNamed) {
      const price = activeNamed.always_list && delta > 0
        ? listPriceForCard(activeNamed.list_defaults, data?.cards, isFoil, cardValuesForListing)
        : null;
      changeCollectionCard(activeNamed.id, targetKey, delta, price);
      return;
    }
    const next = { ...personalCollection };
    const current = next[targetKey] || 0;
    const updated = current + delta;
    if (updated <= 0) {
      delete next[targetKey];
    } else {
      next[targetKey] = updated;
    }
    setCollection(next);
    saveLocalCollection(next);
  };

  // ── Admin Quick Edit Handlers ──
  const handleAdminSaveDetails = async () => {
    if (!data?.id) return;
    setIsSavingAdmin(true);
    setAdminFeedback(null);
    try {
      const numPrice = editPriceHuf ? parseFloat(editPriceHuf) : null;
      if (numPrice !== null && (isNaN(numPrice) || numPrice < 0)) {
        setAdminFeedback({ type: 'error', message: 'Please enter a valid price.' });
        setIsSavingAdmin(false);
        return;
      }

      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error('Please sign in as admin to save changes.');
      }

      const res = await fetch('/api/admin/inventory-images', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventory_id: data.id,
          price_huf: numPrice,
          condition: editCondition,
          quantity: editQuantity > 0 ? editQuantity : 1,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to save inventory.');
      }

      setData((prev: any) => ({
        ...prev,
        price_huf: numPrice,
        condition: editCondition,
        quantity: editQuantity,
      }));

      clearStoreCache();
      clearApiCache();
      window.dispatchEvent(new CustomEvent('tcg-store-inventory-change'));
      setAdminFeedback({ type: 'success', message: 'Saved successfully!' });
    } catch (err: any) {
      console.error('Admin save error:', err);
      setAdminFeedback({ type: 'error', message: err.message || 'Failed to save changes.' });
    } finally {
      setIsSavingAdmin(false);
    }
  };

  const handleAdminUploadPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !data) return;

    setIsUploadingPhoto(true);
    setAdminFeedback(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error('Please sign in as admin to upload photos.');
      }

      const formData = new FormData();
      files.forEach(f => formData.append('files', f));

      const uploadRes = await fetch('/api/admin/upload-image', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      if (!uploadRes.ok) {
        const errJson = await uploadRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to upload photo file.');
      }

      const { urls } = await uploadRes.json();
      if (urls && Array.isArray(urls) && urls.length > 0) {
        const cardObj = data.cards || data;
        const res = await fetch('/api/admin/inventory-images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            inventory_id: data.id,
            card_id: cardObj.id,
            condition: editCondition || 'Near Mint',
            is_foil: Boolean(data.is_foil),
            price_huf: editPriceHuf ? parseFloat(editPriceHuf) : null,
            quantity: editQuantity || 1,
            image_urls: urls,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || 'Failed to link photos to inventory.');
        }

        const json = await res.json();
        const targetInvId = json.inventory_id || data.id;
        const currentImgs = data.inventory_images || [];
        const updatedInvImgs = [...currentImgs, ...(json.images || urls.map((u: string) => ({ image_path: u })))];

        setData((prev: any) => ({
          ...prev,
          id: targetInvId,
          inventory_images: updatedInvImgs,
        }));

        if (urls[0]) setActiveUrl(urls[0]);

        clearStoreCache();
        clearApiCache();
        window.dispatchEvent(new CustomEvent('tcg-store-inventory-change'));
        setAdminFeedback({ type: 'success', message: `${urls.length} photo(s) added!` });
      }
    } catch (err: any) {
      console.error('Admin photo upload error:', err);
      setAdminFeedback({ type: 'error', message: err.message || 'Failed to upload photo.' });
    } finally {
      setIsUploadingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleAdminDeletePhoto = async (imagePath: string) => {
    if (!data?.id || !imagePath) return;
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error('Please sign in as admin to delete photos.');
      }

      const res = await fetch('/api/admin/inventory-images', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventory_id: data.id,
          image_path: imagePath,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to delete photo.');
      }

      const updatedImgs = (data.inventory_images || []).filter((img: any) => img.image_path !== imagePath);
      setData((prev: any) => ({
        ...prev,
        inventory_images: updatedImgs,
      }));

      if (activeUrl === imagePath) {
        const nextImg = updatedImgs[0]?.image_path || data?.cards?.image_path;
        if (nextImg) setActiveUrl(getCardImageUrl(nextImg));
      }

      clearStoreCache();
      clearApiCache();
      window.dispatchEvent(new CustomEvent('tcg-store-inventory-change'));
      setAdminFeedback({ type: 'success', message: 'Photo deleted.' });
    } catch (err: any) {
      console.error('Error deleting photo:', err);
      setAdminFeedback({ type: 'error', message: err.message || 'Failed to delete photo.' });
    }
  };

  useEffect(() => {
    // If not provided via props, fallback to URL search params
    const searchParams = new URLSearchParams(window.location.search);
    const resolvedInvId = inventoryId || searchParams.get('id') || searchParams.get('listing');
    const resolvedCardId = cardId || searchParams.get('card_id') || searchParams.get('card');
    
    if (resolvedInvId) {
      setLoading(true);
      const storageKey = `tcg_viewed_${resolvedInvId}`;
      let alreadyViewed = false;
      try {
        alreadyViewed = Boolean(localStorage.getItem(storageKey));
      } catch (e) {}

      if (!alreadyViewed) {
        try {
          localStorage.setItem(storageKey, '1');
        } catch (e) {}

        supabase.auth.getSession().then(({ data: sessionData }) => {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (sessionData?.session?.access_token) {
            headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
          }
          fetch('/api/marketplace/track-click', {
            method: 'POST',
            headers,
            body: JSON.stringify({ inventory_id: resolvedInvId, type: 'view' }),
          }).catch(() => {});
        }).catch(() => {});
      }
      fetchCardDetail(resolvedInvId, true)
        .then(row => {
          setData(row);
          setIsInventory(true);
          const rowData = row as any;
          const invImgs: any[] = (rowData?.inventory_images ?? []).slice().sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));
          const first = invImgs[0]?.image_path || rowData?.cards?.image_path;
          if (first) setActiveUrl(getCardImageUrl(first));
          setLoading(false);
        })
        .catch(() => {
          // Fallback: if resolving as an inventory listing fails, check if resolvedInvId is a card in the catalog
          fetchCardOnly(resolvedInvId)
            .then(row => {
              setData({ cards: row, condition: null, price_huf: null, status: 'Not in Inventory', notes: null });
              setIsInventory(false);
              const first = row?.image_path;
              if (first) setActiveUrl(getCardImageUrl(first));
              setLoading(false);
            })
            .catch(() => {
              setError('Item not found.');
              setLoading(false);
            });
        });
    } else if (resolvedCardId) {
      setLoading(true);
      fetchCardOnly(resolvedCardId)
        .then(row => {
          setData({ cards: row, condition: null, price_huf: null, status: 'Not in Inventory', notes: null });
          setIsInventory(false);
          const first = row?.image_path;
          if (first) setActiveUrl(getCardImageUrl(first));
          setLoading(false);
        })
        .catch(() => { setError('Card not found.'); setLoading(false); });
    } else {
      setError('No ID provided.'); setLoading(false); 
    }
  }, [inventoryId, cardId]);

  useEffect(() => {
    if (!data?.seller_id) {
      setSellerConversationId(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const me = authData?.user;
      if (cancelled) return;
      if (!me || me.id === data.seller_id) {
        setSellerConversationId(null);
        return;
      }

      const { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .or(`and(buyer_id.eq.${me.id},seller_id.eq.${data.seller_id}),and(buyer_id.eq.${data.seller_id},seller_id.eq.${me.id})`)
        .maybeSingle();

      if (!cancelled) setSellerConversationId(conversation?.id || null);
    })().catch(() => {
      if (!cancelled) setSellerConversationId(null);
    });

    return () => { cancelled = true; };
  }, [data?.seller_id]);

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <span style={{ color:'var(--accent-light)' }}>Loading…</span>
    </div>
  );
  if (error || !data) return (
    <div style={{ maxWidth:600, margin:'80px auto', textAlign:'center' }}>
      <p style={{ color:'var(--text-muted)' }}>{error || 'Not found.'}</p>
      <BackLink />
    </div>
  );

  const card = data.cards;
  const domainValue = card.domain || 'Colorless';
  const parsedDomains = parseDomains(card.domain);
  // Neutral cards (Neeko, Blending In) are stored as "Colorless", like battlefields and tokens -
  // shown as what the game calls them, with the neutral rune.
  const isNeutral = isNeutralCard(card);
  const shownDomains = isNeutral ? parsedDomains.map(d => ({ ...d, key: 'neutral', name: 'Neutral' })) : parsedDomains;
  const rarityStyle = RARITY_COLORS[card.rarity] ?? RARITY_COLORS.Common;
  const isAvailable = (data.status === 'In Stock' || data.status === 'Available') &&
    (Number(data.quantity) || 0) > 0 &&
    data.status !== 'On Hold' &&
    data.status !== 'Reserved' &&
    data.status !== 'Sold';

  const inCart = cartQuantityFor(cart, data.id);
  const copiesLeft = Math.max(0, (Number(data.quantity) || 1) - inCart);
  const cartItemForListing = (): MarketplaceCartItem => ({
    inventoryId: data.id,
    sellerId: data.seller_id,
    sellerName: sellerSummary?.display_name || data.seller_name || 'Seller',
    cardName: card.name,
    cardNumber: card.card_number,
    imagePath: card.image_path,
    priceHuf: data.price_huf || 0,
    quantity: 1,
    maxQuantity: Math.max(1, Number(data.quantity) || 1),
    isFoil: Boolean(data.is_foil),
    condition: data.condition || 'Near Mint',
    handoverMethods: data.handover_methods,
    sellerCountry: data.seller_country || 'HU',
  });

  // Strictly only the actual user who created this listing is considered the seller
  const isSeller = Boolean(
    profile && data && (
      profile.id === data?.seller_id ||
      profile.id === data?.user_id
    )
  );

  const handleSellerChangeStatus = async (newStatus: 'In Stock' | 'On Hold' | 'Sold') => {
    if (!data?.id) return;
    setIsUpdatingStatus(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setShowAuthModal(true);
        return;
      }

      const res = await fetch('/api/marketplace/listings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: data.id,
          status: newStatus,
        }),
      });

      const resJson = await res.json();
      if (!res.ok || !resJson.success) {
        alert(resJson.error || 'Failed to update listing status');
      } else {
        setData((prev: any) => ({
          ...prev,
          status: newStatus,
          quantity: newStatus === 'Sold' ? 0 : (prev.quantity <= 0 ? 1 : prev.quantity),
        }));
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      }
    } catch (e: any) {
      alert(e?.message || 'Error updating status');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const allThumbs: Array<{ url: string; label: string }> = [];
  const invImgs: any[] = (data.inventory_images ?? []).slice().sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));

  // 1. Put actual physical condition photos first
  invImgs.forEach((img, i) => {
    allThumbs.push({ url: getCardImageUrl(img.image_path), label: `Photo #${i + 1} (Condition)` });
  });

  // 2. Put catalog cover artwork
  if (card.image_path) {
    allThumbs.push({ url: getCardImageUrl(card.image_path), label: 'Official Art' });
  }

  const messengerMsg = encodeURIComponent(
    `Hi! I am interested in this card: ${card.name} (${card.card_number?.includes('-') ? card.card_number : `${card.sets?.code?.toLowerCase()}-${card.card_number}`}) — ${card.rarity?.toUpperCase()} — ${fmt(data.price_huf)}`
  );
  const messengerUrl = `https://m.me/your-page?ref=${messengerMsg}`;

  return (
    <div className={`w-full mx-auto relative ${onClose ? 'p-4 sm:p-6 lg:p-8' : 'px-4 sm:px-6 py-6 sm:py-10 max-w-6xl 2xl:max-w-[1400px]'}`}>
      <style>{`
        @keyframes foilShine {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <BackLink onClose={onClose} />

      <div className="grid grid-cols-1 lg:grid-cols-[clamp(280px,38%,440px)_1fr] 2xl:grid-cols-[clamp(300px,26%,380px)_1fr] gap-6 sm:gap-8 lg:gap-12 items-start">

        {/* ── Left: image column ── */}
        <div className="w-full max-w-[280px] xs:max-w-[320px] sm:max-w-[360px] lg:max-w-none mx-auto">
          {/* Main display */}
          <div 
            style={{
              background: 'var(--bg-input)',
              border: `1px solid ${rarityStyle.text}33`,
              boxShadow: `0 4px 24px rgba(0,0,0,0.4)`
            }}
            className="rounded-2xl sm:rounded-3xl overflow-hidden relative p-4 sm:p-6 flex items-center justify-center mb-3"
          >
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:24px_24px]" />

            {activeUrl ? (
              <div 
                style={{ filter: `drop-shadow(0 4px 16px rgba(0,0,0,0.5))` }}
                className="relative z-10 w-full rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => openFullView('full')}
                  className="group block w-full cursor-zoom-in"
                  aria-label={`View ${card.name} full screen`}
                  title="Full view"
                >
                  <img
                    src={activeUrl}
                    alt={card.name}
                    className="w-full h-auto block rounded-lg"
                    onError={() => {
                      const fallback = card?.image_path ? getCardImageUrl(card.image_path) : null;
                      if (fallback && activeUrl !== fallback) {
                        setActiveUrl(fallback);
                      }
                    }}
                  />
                  <span
                    className="absolute bottom-2 right-2 w-9 h-9 rounded-full flex items-center justify-center opacity-80 group-hover:opacity-100 transition"
                    style={{ background: 'rgba(15,23,42,0.8)', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.18)' }}
                    aria-hidden="true"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </span>
                </button>
              </div>
            ) : (
              <div className="relative z-10 text-center text-zinc-400 py-10">
                <div className="text-6xl font-black bg-gradient-to-br from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  {card.name.split(' ').map((w: string) => w[0]).join('').slice(0,2)}
                </div>
                <div className="text-xs mt-2 font-medium">No image uploaded</div>
              </div>
            )}

            {[['top-3 left-3', 'border-l-2 border-t-2'], ['top-3 right-3', 'border-r-2 border-t-2'], ['bottom-3 left-3', 'border-l-2 border-b-2'], ['bottom-3 right-3', 'border-r-2 border-b-2']].map(([pos, border], i) => (
              <div key={i} className={`absolute w-5 h-5 ${pos} ${border}`} style={{ borderColor: `${rarityStyle.text}44`, zIndex: 2 }} />
            ))}
          </div>

          {activeUrl && (
            <CardImageViewer
              src={activeUrl}
              alt={card.name}
              open={fullView === 'full'}
              onClose={closeFullView}
              landscapeCard={(card.card_type || '').toLowerCase() === 'battlefield'}
            />
          )}

          {/* Thumbnail strip */}
          {allThumbs.length > 0 && (
            <div className="flex gap-2 justify-center lg:justify-start flex-wrap">
              {allThumbs.map((thumb, i) => (
                <button 
                  key={i} 
                  onClick={() => setActiveUrl(thumb.url)} 
                  title={thumb.label}
                  className={`w-14 h-20 sm:w-16 sm:h-22 rounded-xl overflow-hidden p-0 cursor-pointer border-2 transition-all shrink-0 ${
                    activeUrl === thumb.url ? 'scale-105 shadow-md' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    borderColor: activeUrl === thumb.url ? 'var(--accent)' : 'var(--border)',
                    background: 'var(--bg-surface-2)'
                  }}
                >
                  <img src={thumb.url} alt={thumb.label} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Art credit, like the line under a picture in a gallery */}
          {card.artist && (
            <p className="mt-3 text-xs text-center lg:text-left" style={{ color: 'var(--text-tertiary)' }}>
              Illustrated by <span style={{ color: 'var(--text-secondary)' }}>{card.artist}</span>
            </p>
          )}
        </div>

        {/* ── Right: info column (two columns side by side on a wide screen) ── */}
        <div className="w-full min-w-0 2xl:grid 2xl:grid-cols-2 2xl:gap-x-6 2xl:items-start">
          <div className="2xl:col-span-2">
          {(() => {
            const { main, sub } = splitCardTitle(card.name);
            const cardNumberStr = formatCleanCardNumber(card.card_number);

            if (sub) {
              return (
                <div className="text-center mb-2 sm:mb-2.5">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest leading-none mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    {card.sets?.name || "Base Set"} · <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{cardNumberStr}</span>
                  </p>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-none tracking-tight uppercase my-0.5" style={{ color: 'var(--text-primary)' }}>
                    {main}
                  </h1>
                  <p className="text-xs sm:text-sm font-extrabold uppercase tracking-[0.2em] leading-snug mt-0.5" style={{ color: 'var(--text-accent)' }}>
                    {sub}
                  </p>
                </div>
              );
            }

            return (
              <div className="text-center mb-2 sm:mb-2.5">
                <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest leading-none mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  {card.sets?.name || "Base Set"} · <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{cardNumberStr}</span>
                </p>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight tracking-tight uppercase my-0.5" style={{ color: 'var(--text-primary)' }}>
                  {card.name}
                </h1>
              </div>
            );
          })()}

          {/* Foreign prints show the official English text (the ability text below). */}
          {printLanguage(card.name) && (
            <div className="flex justify-center mb-3">
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                {printLanguage(card.name)} print - the official English text is shown below.
              </span>
            </div>
          )}
          </div>

          {isInventory ? (
            <div className="2xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              {/* LEFT: Complete Marketplace Listing & Purchase Card */}
              <div 
                className="rounded-2xl p-4 sm:p-5 border flex flex-col gap-4 shadow-sm"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
              >
                {/* 1. Price & Availability Header */}
                <div className="flex items-center justify-between gap-3 pb-3 border-b flex-wrap" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider block mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Price</span>
                    <div className="text-3xl sm:text-4xl font-black text-[var(--positive)] leading-none">
                      {data.price_huf ? formatPrice(data.price_huf) : 'N/A'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ListingLikeButton id={data.inventory_id || inventoryId || ''} type="listing" initialCount={data.likes_count} alwaysShowCount showLabel variant="surface" />
                    {data.status === 'In Stock' && (
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full border text-[var(--positive)] inline-flex items-center gap-1.5" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)' }}>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                        <span key={copiesLeft} className={inCart > 0 ? 'tv-bump inline-block' : 'inline-block'}>
                          {copiesLeft === 0 ? 'None left to add' : copiesLeft > 1 ? `${copiesLeft} available` : 'Available'}
                        </span>
                      </span>
                    )}
                    {data.status === 'In Stock' && inCart > 0 && (
                      <button
                        type="button"
                        onClick={openCart}
                        className="text-xs font-bold px-3 py-1.5 rounded-full border inline-flex items-center gap-1.5 cursor-pointer hover:brightness-110"
                        style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                          <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
                        </svg>
                        <span>{inCart} in cart · View</span>
                      </button>
                    )}
                    {(data.status === 'On Hold' || data.status === 'Reserved') && (
                      <span className="text-xs font-black px-3 py-1.5 rounded-full border bg-amber-500/20 text-amber-300 border-amber-500/50 inline-flex items-center gap-1.5 uppercase tracking-wider shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        <span>ON HOLD</span>
                      </span>
                    )}
                    {data.status === 'Sold' && (
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full border bg-zinc-800 text-zinc-400 border-zinc-700 inline-flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>SOLD</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* 2. Seller Identity Bar */}
                <div 
                  className="rounded-xl p-3 border flex items-center justify-between gap-3 cursor-pointer transition hover:bg-[var(--bg-raised)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                  onClick={() => {
                    if (data?.seller_id) {
                      setReviewsModalSellerId(data.seller_id);
                    }
                  }}
                  title="Click to view seller reviews and ratings"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {sellerSummary?.avatar_url ? (
                      <img
                        src={sellerSummary.avatar_url}
                        alt={sellerSummary.display_name || data?.seller_name || 'Seller'}
                        className="w-10 h-10 rounded-full object-cover border border-amber-400/40 shrink-0"
                      />
                    ) : (
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 border"
                        style={{
                          background: 'var(--accent-muted)',
                          borderColor: 'var(--accent)',
                          color: 'var(--text-accent)',
                        }}
                      >
                        {sellerSummary?.display_name ? sellerSummary.display_name[0].toUpperCase() : (data?.seller_name ? data.seller_name[0].toUpperCase() : 'S')}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <CountryFlag countryCode={data?.seller_country || 'HU'} className="w-4 h-3 rounded-[2px]" />
                        {data?.seller_id ? (
                          <a
                            href={`/user?id=${data.seller_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-black truncate hover:underline"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {sellerSummary?.display_name || data?.seller_name || (data?.seller_role === 'owner' ? 'Noel :3' : 'Community Seller')}
                          </a>
                        ) : (
                          <span className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>
                            {sellerSummary?.display_name || data?.seller_name || (data?.seller_role === 'owner' ? 'Noel :3' : 'Community Seller')}
                          </span>
                        )}
                        {(() => {
                          const isOwner = Boolean(sellerSummary?.is_owner || sellerSummary?.role === 'owner' || data?.seller_role === 'owner' || data?.seller_id === OWNER_ID);
                          const tier = getSellerTier(sellerSummary?.sales_count || data?.seller_sales_count || 0, sellerSummary?.rating_avg ?? null, isOwner, isLightTheme);
                          return (
                            <>
                              {isOwner && <SiteOwnerTag />}
                              <span
                                className="text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 border"
                                style={tier.badgeStyle}
                                title={tier.nameEn}
                              >
                                <BadgeIconSvg iconType={tier.iconType} className="w-3 h-3" />
                                <span>{tier.nameEn}</span>
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                        {sellerSummary && sellerSummary.rating_count > 0 && sellerSummary.rating_avg !== null ? (
                          <>
                            <div className="flex items-center gap-1 font-bold" style={{ color: 'var(--text-accent)' }}>
                              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                              <span>{sellerSummary.rating_avg.toFixed(1)}</span>
                            </div>
                            <span>•</span>
                            <span>
                              {sellerSummary.rating_count} {sellerSummary.rating_count === 1 ? ('rating') : ('ratings')}
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-400 text-[11px]">
                            New Seller (No ratings yet)
                          </span>
                        )}
                        <span>•</span>
                        <span className="inline-flex items-center gap-1 text-[11px]">
                          <span>Ships from</span>
                          <CountryFlag countryCode={data?.seller_country || 'HU'} className="w-3 h-2 rounded-[2px]" />
                          <span>({getCountry(data?.seller_country).name}{sellerShipping?.international?.length ? ` · also ships to ${sellerShipping.international.length} ${sellerShipping.international.length === 1 ? 'country' : 'countries'}` : ''})</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  {data?.seller_id && !isSeller && sellerConversationId && (
                    <a
                      href={`/messages?conversation_id=${sellerConversationId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold shrink-0 transition hover:brightness-110 flex items-center gap-1.5"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      title="Open your conversation with this seller"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <span className="hidden sm:inline">Message</span>
                    </a>
                  )}
                </div>

                {/* 3. Condition & Seller's Description */}
                <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Condition</span>
                    <span className="text-xs font-black uppercase px-2.5 py-0.5 rounded-md border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                      {data.condition}
                    </span>
                  </div>
                  {(() => {
                    const displayNotes = getDisplayConditionNotes(data.notes);
                    if (!displayNotes) return null;
                    return (
                      <div className="mt-2.5 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Seller's Note</p>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                          {displayNotes}
                        </p>
                      </div>
                    );
                  })()}
                </div>

                {/* 4. Delivery Options */}
                {(() => {
                  const listed = listingHandoverIds(data.handover_methods);
                  const builtInOffered = HANDOVER_METHODS
                    .filter(m => listed.includes(m.id))
                    .map(m => ({ m: { id: m.id, label: m.label }, o: shippingOption(sellerShipping, m.id) }))
                    .filter(({ o }) => o.enabled);
                  const customOffered = (sellerShipping?.custom_methods || [])
                    .filter(cm => cm.enabled && listed.includes(cm.id))
                    .map(cm => ({
                      m: { id: cm.id, label: cm.label },
                      o: { enabled: true, price_huf: cm.price_huf, min_order_huf: cm.min_order_huf }
                    }));
                  const offered = [...builtInOffered, ...customOffered];
                  if (offered.length === 0) return null;
                  const personalOpt = offered.find(({ m }) => m.id === 'personal');
                  return (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Delivery Options</p>
                      <div className="flex flex-wrap gap-1.5">
                        {offered.map(({ m, o }) => (
                          <span key={m.id} className="text-[11px] px-2 py-1 rounded-lg border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{m.label}</span>{' '}
                            {describeOption({ price: o.price_huf, min: o.min_order_huf }, formatPrice)}
                          </span>
                        ))}
                      </div>
                      {personalOpt && sellerShipping?.in_person_location && (
                        <div className="mt-2 text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Pickup Location:</span>
                          <span>{sellerShipping.in_person_location}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 5. Primary Buyer & Seller Action Controls */}
                <div className="flex items-center gap-2.5 flex-wrap pt-1">
                  {/* Primary Buyer Action: Request Hold */}
                  {isAvailable && !isSeller && (
                    <button
                      type="button"
                      onClick={() => {
                        if (inCart === 0) addToCart(cartItemForListing());
                        openCart();
                      }}
                      className="inline-flex items-center gap-2 rounded-xl h-10 px-5 text-xs sm:text-sm font-black shadow-lg transition transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                      style={{
                        background: 'var(--accent-gradient, linear-gradient(135deg, #f59e0b 0%, #d97706 100%))',
                        color: 'var(--accent-contrast, #000000)',
                        boxShadow: '0 4px 14px var(--accent-glow, rgba(245, 158, 11, 0.4))',
                      }}
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                      <span>Request Hold</span>
                    </button>
                  )}

                  {(data.status === 'On Hold' || data.status === 'Reserved') && !isSeller && (
                    <span
                      className="inline-flex items-center gap-2 rounded-xl h-10 px-5 text-xs sm:text-sm font-black border opacity-90 cursor-not-allowed select-none"
                      style={{
                        background: 'var(--accent-muted, rgba(245, 158, 11, 0.15))',
                        color: 'var(--text-accent, #f59e0b)',
                        borderColor: 'var(--accent-border, rgba(245, 158, 11, 0.3))',
                      }}
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <span>On Hold</span>
                    </span>
                  )}

                  {/* Add to Cart Stepper */}
                  {isAvailable && !isSeller && inCart > 0 && (
                    <div className="inline-flex items-center rounded-xl border overflow-hidden shadow-xs h-[40px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (inCart <= 1) {
                            removeFromCart(data.inventory_id);
                          } else {
                            updateCartItemQuantity(data.inventory_id, inCart - 1);
                          }
                        }}
                        aria-label="Decrease quantity in cart"
                        title="Decrease quantity or remove"
                        className="w-10 h-full flex items-center justify-center cursor-pointer hover:bg-[var(--bg-raised)] transition"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                      <span className="min-w-[42px] px-2 text-center text-xs sm:text-sm font-black tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {inCart} in cart
                      </span>
                      <button
                        type="button"
                        disabled={copiesLeft === 0}
                        onClick={() => {
                          addToCart(cartItemForListing());
                          setJustAdded(true);
                          if (justAddedTimer.current) clearTimeout(justAddedTimer.current);
                          justAddedTimer.current = setTimeout(() => setJustAdded(false), 1400);
                        }}
                        aria-label="Increase quantity in cart"
                        title={copiesLeft === 0 ? 'No more copies available' : 'Add another copy'}
                        className="w-10 h-full flex items-center justify-center cursor-pointer hover:bg-[var(--bg-raised)] transition disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                    </div>
                  )}

                  {isAvailable && !isSeller && inCart === 0 && (
                    <button
                      type="button"
                      disabled={copiesLeft === 0}
                      onClick={() => {
                        addToCart(cartItemForListing());
                        setJustAdded(true);
                        if (justAddedTimer.current) clearTimeout(justAddedTimer.current);
                        justAddedTimer.current = setTimeout(() => setJustAdded(false), 1400);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl h-10 px-4 text-xs sm:text-sm font-bold border transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      style={
                        justAdded
                          ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
                          : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                      }
                      title={copiesLeft === 0 ? 'Every copy of this listing is already in your cart' : 'Add a copy to your cart'}
                    >
                      {justAdded ? (
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                          <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
                        </svg>
                      )}
                      <span aria-live="polite">
                        {justAdded ? 'Added to cart' : 'Add to Cart'}
                      </span>
                    </button>
                  )}

                  {/* Seller Quick Action Controls: hold/release and relist only. A sale completed
                      outside the site is handled by unlisting, so there is no manual "Confirm Sale". */}
                  {isSeller && (data.status === 'On Hold' || data.status === 'Reserved' || data.status === 'Sold') && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(data.status === 'On Hold' || data.status === 'Reserved') && (
                        <button
                          type="button"
                          disabled={isUpdatingStatus}
                          onClick={() => handleSellerChangeStatus('In Stock')}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer hover:brightness-110 disabled:opacity-50"
                          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                          title={'Release hold back to available'}
                        >
                          Release Hold
                        </button>
                      )}
                      {data.status === 'Sold' && (
                        <button
                          type="button"
                          disabled={isUpdatingStatus}
                          onClick={() => handleSellerChangeStatus('In Stock')}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold hover:brightness-110 border transition cursor-pointer disabled:opacity-50"
                          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                          title={'Relist as in stock'}
                        >
                          Relist
                        </button>
                      )}
                    </div>
                  )}

                  <PriceChartingButton card={card} isFoil={data.is_foil} />

                  {!isSeller && (
                    <button
                      type="button"
                      onClick={() => setShowReportModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400"
                      style={{
                        background: 'var(--bg-input)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-tertiary)',
                      }}
                      title="Report this listing to moderators"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                        <line x1="4" y1="22" x2="4" y2="15" />
                      </svg>
                      <span>Report listing</span>
                    </button>
                  )}
                </div>

                {(data.status === 'On Hold' || data.status === 'Reserved') && (
                  <p className="text-xs mt-1 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl" style={{ color: 'var(--text-accent)' }}>
                    This item is currently on hold for another buyer while handover/payment is arranged.
                  </p>
                )}
              </div>

              {/* RIGHT: Value & Price History Graph Panel */}
              <div>
                <CardValuePanel card={card} className="mb-0" isFoil={isInventory ? Boolean(data?.is_foil) : undefined} />
              </div>
            </div>
          ) : (
            <>
              <div className="min-w-0">
              <div 
                className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 mb-4"
                style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}
              >

                {/* Row 1: Rarity + Lucky */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Rarity icon + label */}
              {(() => {
                const isRiftbound = !card.game || card.game === 'riftbound';
                const rarityKey = (card.rarity || '').toLowerCase();
                const rarityIcon = isRiftbound ? RARITY_ICONS[rarityKey] : null;
                return (
                  <span 
                    style={{ background: rarityStyle.bg, color: rarityStyle.text, borderColor: `${rarityStyle.text}44`, boxShadow: `0 0 12px ${rarityStyle.glow}` }}
                    className="inline-flex items-center gap-2 text-sm font-black px-3 py-1.5 rounded-xl border uppercase tracking-wider"
                  >
                    {rarityIcon && <img src={rarityIcon} alt={card.rarity} className="w-5 h-5 object-contain" />}
                    {card.rarity}
                  </span>
                );
              })()}

              {isSigned(card) && (
                <span className="inline-flex items-center gap-1.5 text-sm font-black px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/50 uppercase tracking-wider shadow-sm" style={{ color: 'var(--text-primary)' }}>
                  Signed Edition
                </span>
              )}

              {isAltArt(card) && (
                <span className="inline-flex items-center gap-1.5 text-sm font-black px-3 py-1.5 rounded-xl bg-pink-500/15 border border-pink-500/50 uppercase tracking-wider shadow-sm" style={{ color: 'var(--text-primary)' }}>
                  Alt Art
                </span>
              )}

              {isOvernumbered(card) && (
                <span className="inline-flex items-center gap-1.5 text-sm font-black px-3 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/50 uppercase tracking-wider shadow-sm" style={{ color: 'var(--text-primary)' }}>
                  Overnumbered Edition
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                
                {card.game === 'mtg' && card.cost != null && (
                  <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Mana Value</div>
                    <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>{card.cost}</div>
                  </div>
                )}

                {(card.game === 'onepiece' || card.game === 'lorcana' || card.game === 'starwars' || card.game === 'fab') && (
                  <>
                    {card.domain && (
                      <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                        <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                          {card.game === 'onepiece' ? 'Color' : card.game === 'lorcana' ? 'Ink' : card.game === 'starwars' ? 'Aspect' : card.game === 'fab' ? 'Class' : 'Domain'}
                        </div>
                        <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>{card.domain}</div>
                      </div>
                    )}
                  </>
                )}

                {(!card.game || card.game === 'riftbound') && ((card.domain && card.domain !== 'Colorless') || isNeutral) && (() => {
                  return (
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                      <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                        {shownDomains.length > 1 ? "Domains" : "Domain"}
                      </div>
                      <div className="flex items-center gap-2 text-base font-black flex-wrap">
                        {shownDomains.map((d, idx) => {
                          const icon = RUNE_ICONS[d.key];
                          return (
                            <span key={d.key} className="inline-flex items-center gap-1.5" style={{ color: d.border }}>
                              {icon && <img src={icon} alt={d.name} className="w-5 h-5 object-contain" />}
                              {d.name}
                              {idx < shownDomains.length - 1 && <span className="font-normal" style={{ color: 'var(--text-muted)' }}>/</span>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {(() => {
                  const rawType = (card.card_type || '').toLowerCase();
                  const superType = (card.subtype || '').toLowerCase();
                  const isRiftbound = !card.game || card.game === 'riftbound';
                  const isChampionUnit = isRiftbound && rawType === 'unit' && superType === 'champion';
                  const typeIcon = isRiftbound ? TYPE_ICONS[rawType] : null;
                  const superIcon = isRiftbound ? TYPE_ICONS[superType] : null;

                  // Compute clean displayType:
                  let displayType = card.card_type || '';
                  if (card.game === 'fab') {
                    // In FaB, subtype is e.g. "Guardian Action - Aura".
                    // If card.domain is "Guardian", strip "Guardian " so it shows "Action - Aura"
                    if (card.subtype) {
                      const domainClean = (card.domain || '').trim();
                      if (domainClean && card.subtype.toLowerCase().startsWith(domainClean.toLowerCase())) {
                        displayType = card.subtype.slice(domainClean.length).trim();
                        if (displayType.startsWith('-')) displayType = displayType.slice(1).trim();
                      } else {
                        displayType = card.subtype;
                      }
                    }
                  }

                  // Only Riftbound shows superType as a subtitle in the Type box (e.g. Unit · Champion)
                  // For SWU, Lorcana, and One Piece, traits are shown below in the Traits/Classifications section!
                  const displaySubtype = isRiftbound ? card.subtype : null;

                  return (
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                      <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Type</div>
                      <div className="flex items-center gap-1.5 text-base font-bold flex-wrap leading-snug break-words" style={{ color: 'var(--text-primary)' }}>
                        {isChampionUnit ? (
                          <>
                            {superIcon && <img src={superIcon} alt={superType} title={card.subtype} className="w-5 h-5 object-contain shrink-0" />}
                            <span className="text-amber-300 break-words">{card.subtype}</span>
                          </>
                        ) : (
                          <>
                            {typeIcon && <img src={typeIcon} alt={rawType} title={card.card_type} className="w-5 h-5 object-contain shrink-0" />}
                            <span className="break-words">{displayType}</span>
                            {displaySubtype && (
                              <>
                                <span className="mx-0.5" style={{ color: 'var(--text-muted)' }}>·</span>
                                {superIcon && <img src={superIcon} alt={superType} title={displaySubtype} className="w-5 h-5 object-contain shrink-0" />}
                                <span className="text-amber-300 break-words">{displaySubtype}</span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Traits / Classifications / Affiliations / Tags */}
              {(() => {
                const isSWU = card.game === 'starwars';
                const isLorcana = card.game === 'lorcana';
                const isOnePiece = card.game === 'onepiece';

                // Extract traits from subtype for SWU / Lorcana / OnePiece
                const extraPills: string[] = [];
                if ((isSWU || isLorcana || isOnePiece) && card.subtype) {
                  const parts = card.subtype.split(/[·•,]/).map((s: string) => s.trim()).filter(Boolean);
                  extraPills.push(...parts);
                }

                const rawTags: string[] = Array.isArray(card.tags) ? card.tags : (card.tags?.tags || []);
                const allPills = Array.from(new Set([...extraPills, ...rawTags]));
                if (allPills.length === 0) return null;

                const sectionTitle = isSWU ? 'Traits' : isLorcana ? 'Classifications' : isOnePiece ? 'Affiliations & Traits' : 'Tags';

                return (
                  <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>{sectionTitle}</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {allPills.map((tag: string) => (
                        <span 
                          key={tag} 
                          className="text-xs sm:text-sm font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider"
                          style={{
                            background: 'var(--bg-surface)',
                            color: 'var(--text-secondary)',
                            borderColor: 'var(--border)'
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {(() => {
            const isRiftbound = !card.game || card.game === 'riftbound';
            const isOnePiece = card.game === 'onepiece';
            const isLorcana = card.game === 'lorcana';
            const isSWU = card.game === 'starwars';
            const isFaB = card.game === 'fab';

            // Riftbound specific
            const powerReq = getCardPowerRequirement(card);
            const hasPowerCost = isRiftbound && powerReq.power > 0 && powerReq.domains.length > 0;
            const hasEnergy = isRiftbound && card.energy != null;

            // Stats across games
            const hasCost = (isOnePiece || isLorcana || isSWU || isFaB) && card.cost != null;
            const hasMight = card.might != null;
            const hasMightBonus = card.might_bonus != null;
            const hasLore = isLorcana && card.energy != null;
            const hasFaBPitch = isFaB && card.energy != null;

            if (!hasEnergy && !hasMight && !hasMightBonus && !hasPowerCost && !hasCost && !hasLore && !hasFaBPitch) return null;

            let statCount = 0;
            if (isRiftbound) {
              statCount = (hasEnergy ? 1 : 0) + (hasPowerCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
            } else if (isOnePiece) {
              statCount = (hasCost ? 1 : 0) + (hasMight ? 1 : 0);
            } else if (isLorcana) {
              statCount = (hasCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0) + (hasLore ? 1 : 0);
            } else if (isSWU) {
              statCount = (hasCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
            } else if (isFaB) {
              statCount = (hasFaBPitch ? 1 : 0) + (hasCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
            } else {
              statCount = (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
            }

            const gridClass = statCount === 4 ? "grid-cols-2 sm:grid-cols-4" : statCount === 3 ? "grid-cols-3" : statCount === 2 ? "grid-cols-2" : "grid-cols-1";

            return (
              <div className={`grid ${gridClass} gap-2.5 mb-4`}>
                {/* 1. Riftbound Energy Cost */}
                {hasEnergy && (() => {
                  const isMulti = parsedDomains.length > 1;
                  return (
                    <div 
                      style={{
                        background: isMulti
                          ? `linear-gradient(135deg, ${parsedDomains[0].bg} 0%, ${parsedDomains[0].bg} 50%, ${parsedDomains[1].bg} 50%, ${parsedDomains[1].bg} 100%)`
                          : (parsedDomains[0]?.bg || 'rgba(75,85,99,0.95)'),
                        borderColor: isMulti ? 'rgba(255,255,255,0.4)' : (parsedDomains[0]?.border || 'rgba(107,114,128,1)'),
                        boxShadow: isMulti
                          ? `0 0 16px ${parsedDomains[0].glow}, 0 0 16px ${parsedDomains[1].glow}`
                          : `0 0 14px ${parsedDomains[0]?.glow || 'rgba(0,0,0,0.5)'}`,
                      }}
                      className="border rounded-xl p-3 flex flex-col items-center justify-center text-center shadow-lg"
                    >
                      <div className="text-xs font-black uppercase tracking-wider mb-0.5 text-white/90 drop-shadow">
                        {isMulti ? `${shownDomains.map(d => d.name).join(' / ')} Energy` : `${shownDomains[0]?.name || ''} Energy`}
                      </div>
                      <div className="text-3xl sm:text-4xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                        {card.energy}
                      </div>
                    </div>
                  );
                })()}

                {/* 2. Riftbound Power Cost */}
                {hasPowerCost && (
                  <div 
                    className="rounded-xl p-3 flex flex-col items-center justify-center text-center shadow-lg border"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                  >
                    <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                      Power Cost
                    </div>
                    <div className="flex items-center gap-2 my-auto flex-wrap justify-center">
                      {powerReq.isMixed ? (
                        <div className="flex items-center gap-1.5 font-black text-base" style={{ color: 'var(--text-primary)' }}>
                          {powerReq.domains.map((domKey, idx) => {
                            const runeIcon = RUNE_ICONS[domKey];
                            return (
                              <React.Fragment key={domKey}>
                                {idx > 0 && <span className="font-bold text-sm" style={{ color: 'var(--text-muted)' }}>/</span>}
                                {runeIcon ? (
                                  <img
                                    src={runeIcon}
                                    alt={domKey}
                                    className="w-8 h-8 object-contain drop-shadow"
                                    title={domKey}
                                  />
                                ) : (
                                  <span className="capitalize text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{domKey}</span>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>{powerReq.power}x</span>
                          {RUNE_ICONS[powerReq.domains[0]] ? (
                            <img
                              src={RUNE_ICONS[powerReq.domains[0]]}
                              alt={powerReq.domains[0]}
                              className="w-8 h-8 object-contain drop-shadow"
                              title={`${powerReq.power}x ${powerReq.domains[0]}`}
                            />
                          ) : (
                            <span className="capitalize text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{powerReq.domains[0]}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. FaB Pitch */}
                {hasFaBPitch && (() => {
                  const pitch = Number(card.energy);
                  const colorClass = pitch === 1 ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : pitch === 2 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : pitch === 3 ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                    : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300';
                  const label = pitch === 1 ? 'Pitch 1 (Red)' : pitch === 2 ? 'Pitch 2 (Yellow)' : pitch === 3 ? 'Pitch 3 (Blue)' : `Pitch ${pitch}`;
                  return (
                    <div className={`rounded-xl p-3 flex flex-col items-center justify-center text-center border ${colorClass}`}>
                      <div className="text-xs font-black uppercase tracking-wider mb-0.5 opacity-90">{label}</div>
                      <div className="flex items-center gap-1.5 justify-center mt-1">
                        {Array.from({ length: Math.min(Math.max(pitch, 1), 3) }).map((_, i) => (
                          <span key={i} className="w-3.5 h-3.5 rounded-full bg-current inline-block" />
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* 4. Cost for Non-Riftbound games */}
                {hasCost && (
                  <div 
                    className="rounded-xl p-3 flex flex-col items-center justify-center text-center border"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                  >
                    <div className="text-xs font-black uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {isLorcana ? 'Ink Cost' : 'Cost'}
                    </div>
                    <div className="text-3xl sm:text-4xl font-black" style={{ color: 'var(--text-primary)' }}>{card.cost}</div>
                  </div>
                )}

                {/* 5. Primary Offensive Stat: Might (Riftbound) / Power (One Piece, SWU) / Strength (Lorcana) / Attack (FaB) */}
                {hasMight && (
                  <div 
                    className="rounded-xl p-3 flex flex-col items-center justify-center text-center border" 
                    style={{ 
                      background: isFaB ? 'rgba(239, 68, 68, 0.1)' : 'var(--accent-muted)', 
                      borderColor: isFaB ? 'rgba(239, 68, 68, 0.3)' : 'var(--accent-border)' 
                    }}
                  >
                    <div 
                      className="text-xs font-black uppercase tracking-wider mb-0.5" 
                      style={{ color: isFaB ? '#f87171' : 'var(--text-accent)' }}
                    >
                      {isOnePiece || isSWU ? 'Power' : isLorcana ? 'Strength' : isFaB ? 'Attack' : 'Might'}
                    </div>
                    <div 
                      className="text-3xl sm:text-4xl font-black" 
                      style={{ color: isFaB ? '#f87171' : 'var(--text-accent)' }}
                    >
                      {card.might}
                    </div>
                  </div>
                )}

                {/* 6. Primary Defensive Stat: Might Bonus (Riftbound) / Willpower (Lorcana) / HP (SWU) / Defense (FaB) */}
                {hasMightBonus && (
                  <div
                    className="rounded-xl p-3 flex flex-col items-center justify-center text-center border"
                    style={{ 
                      background: isSWU ? 'rgba(239, 68, 68, 0.1)' : isFaB ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-surface-2)', 
                      borderColor: isSWU ? 'rgba(239, 68, 68, 0.3)' : isFaB ? 'rgba(59, 130, 246, 0.3)' : 'var(--border)' 
                    }}
                    title={isRiftbound ? "Might added to the unit this is attached to" : undefined}
                  >
                    <div 
                      className="text-xs font-black uppercase tracking-wider mb-0.5" 
                      style={{ color: isSWU ? '#f87171' : isFaB ? '#60a5fa' : 'var(--text-tertiary)' }}
                    >
                      {isLorcana ? 'Willpower' : isSWU ? 'HP' : isFaB ? 'Defense' : 'Might Bonus'}
                    </div>
                    <div 
                      className="text-3xl sm:text-4xl font-black" 
                      style={{ color: isSWU ? '#f87171' : isFaB ? '#60a5fa' : 'var(--text-primary)' }}
                    >
                      {isRiftbound && card.might_bonus >= 0 ? `+${card.might_bonus}` : card.might_bonus}
                    </div>
                  </div>
                )}

                {/* 7. Lorcana Lore */}
                {hasLore && (
                  <div 
                    className="rounded-xl p-3 flex flex-col items-center justify-center text-center border" 
                    style={{ background: 'rgba(234, 179, 8, 0.1)', borderColor: 'rgba(234, 179, 8, 0.3)' }}
                  >
                    <div className="text-xs font-black uppercase tracking-wider mb-0.5 text-amber-400">Lore</div>
                    <div className="text-3xl sm:text-4xl font-black text-amber-300 flex items-center justify-center gap-1.5">
                      <span>{card.energy}</span>
                      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-amber-400 shrink-0" aria-label="Lore">
                        <polygon points="12,2 20,12 12,22 4,12" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Text Abilities */}
          {(card.text || card.ability || card.effect) && (
            <div 
              className="rounded-2xl p-4 sm:p-5 mb-4 border"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
            >
              {card.ability && (
                <div className={card.effect || card.text ? "mb-4" : ""}>
                  <div 
                    className="text-sm font-black uppercase tracking-wider pb-1.5 mb-2"
                    style={{ color: 'var(--text-accent)', borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    Ability
                  </div>
                  <div className="text-sm sm:text-base leading-relaxed space-y-1" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.ability) }} />
                </div>
              )}
              
              {/* The separate effect box printed on gear and a few spells */}
              {card.effect && (
                <div
                  className={`rounded-xl p-3.5 border ${card.text ? 'mb-4' : ''}`}
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border, var(--border))' }}
                >
                  <div className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-accent)' }}>
                    Effect
                  </div>
                  <div className="text-sm sm:text-base leading-relaxed space-y-1" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.effect) }} />
                </div>
              )}

              {card.text && (
                <div className={card.ability ? "pt-3" : ""} style={card.ability ? { borderTop: '1px solid var(--border-subtle)' } : {}}>
                  <div className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                    {card.game && card.game !== 'riftbound' ? 'Card Text' : 'Flavor Text'}
                  </div>
                  <div className={`text-sm sm:text-base leading-relaxed ${card.game && card.game !== 'riftbound' ? 'whitespace-pre-line' : 'italic'}`} style={{ color: (card.game && card.game !== 'riftbound') ? 'var(--text-primary)' : 'var(--text-secondary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.text) }} />
                </div>
              )}
            </div>
          )}
          </div>

          <div className="min-w-0">
          {/* What it's worth: market reference, what's for sale here, and the estimate from both */}
          {!isInventory && <CardValuePanel card={card} />}

          {/* Collection Tracking Section (Catalog / Personal Collection only, hidden in Store) */}
          {!isInventory && (
            <div 
              className="rounded-2xl p-4 sm:p-5 mb-4 border"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="text-sm font-black uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                  </svg>
                  <span>{activeNamed ? activeNamed.name : 'My Collection Tracker'}</span>
                  {activeNamed?.always_list && (
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}>
                      Always listed
                    </span>
                  )}
                </div>
                {(((collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)) > 0) && (
                  <span 
                    className="text-xs font-bold px-3 py-1 rounded-full border shrink-0"
                    style={{
                      background: 'var(--accent-muted)',
                      borderColor: 'var(--accent-border)',
                      color: 'var(--text-accent)'
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
                      {(collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)} Total Copies
                    </span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Normal Copy Stepper */}
                <div 
                  className="border rounded-xl p-3 flex items-center justify-between transition-colors"
                  style={{
                    background: 'var(--bg-input)',
                    borderColor: (collection[card.id] > 0) ? 'var(--accent)' : 'var(--border-subtle)'
                  }}
                >
                  <div>
                    <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Normal</div>
                    <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Regular Copy</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleUpdateCount(card.id, false, -1)}
                      disabled={!(collection[card.id] > 0)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
                      style={{
                        background: 'var(--bg-surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)'
                      }}
                      title="-1"
                    >
                      −
                    </button>
                    <span 
                      className="min-w-[20px] text-center text-base font-black font-mono"
                      style={{ color: (collection[card.id] > 0) ? 'var(--text-accent)' : 'var(--text-muted)' }}
                    >
                      {collection[card.id] || 0}
                    </span>
                    <button
                      onClick={() => handleUpdateCount(card.id, false, 1)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer transition border"
                      style={{
                        background: 'var(--bg-surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)'
                      }}
                      title="+1"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Foil Copy Stepper */}
                {hasFoilVariant(card) && (
                  <div 
                    className="border rounded-xl p-3 flex items-center justify-between transition-colors"
                    style={{
                      background: 'var(--bg-input)',
                      borderColor: (collection[`${card.id}_foil`] > 0) ? 'var(--accent)' : 'var(--border-subtle)'
                    }}
                  >
                    <div>
                      <div className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--text-accent)' }}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        <span>Foil</span>
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Foil Finish</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateCount(card.id, true, -1)}
                        disabled={!(collection[`${card.id}_foil`] > 0)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
                        style={{
                          background: 'var(--bg-surface)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)'
                        }}
                        title="-1"
                      >
                        −
                      </button>
                      <span 
                        className="min-w-[20px] text-center text-base font-black font-mono"
                        style={{ color: (collection[`${card.id}_foil`] > 0) ? 'var(--text-accent)' : 'var(--text-muted)' }}
                      >
                        {collection[`${card.id}_foil`] || 0}
                      </span>
                      <button
                        onClick={() => handleUpdateCount(card.id, true, 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer transition border"
                        style={{
                          background: 'var(--bg-surface)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)'
                        }}
                        title="+1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Move Copies Button */}
              {collectionsStore.collections.length > 0 && (((collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)) > 0) && (
                <button
                  type="button"
                  onClick={() => setShowMoveModal(true)}
                  className="mt-3 w-full py-2 px-3 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition hover:brightness-110 active:scale-95 shadow-sm"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title="Move copies of this card between collections"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3l4 4-4 4" />
                    <path d="M3 7h18" />
                    <path d="M7 21l-4-4 4-4" />
                    <path d="M21 17H3" />
                  </svg>
                  <span>Move copies</span>
                </button>
              )}
            </div>
          )}

          {/* Wishlists (catalog view): how many copies each of your lists wants */}
          <WishlistControls
            cardId={card.id}
            game={card.game || 'riftbound'}
            hasFoil={hasFoilVariant(card)}
            signedIn={Boolean(profile)}
            onRequireSignIn={() => setShowAuthModal(true)}
          />

          <div className="flex items-center gap-3 flex-wrap pt-2">
            <button
              type="button"
              onClick={() => {
                if (profile) {
                  setIsListModalOpen(true);
                } else {
                  setShowAuthModal(true);
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold shadow transition transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer border text-[var(--positive)] hover:brightness-110" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)' }}
              title={'List your copy of this card for sale'}
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V5a2 2 0 012-2z" />
              </svg>
              <span>Sell on Marketplace</span>
            </button>
            <PriceChartingButton card={card}  />
          </div>
          </div>
        </>
      )}
        </div>
      </div>

      {/* ListCardModal and SellerReviewsModal each hold themselves open for their own exit
          transition (isOpen) - wrapping them in `{flag && (...)}` here would unmount them the
          instant the flag goes false, before that transition gets to play. */}
      <ListCardModal
        isOpen={isListModalOpen}
        onClose={() => setIsListModalOpen(false)}
        initialCard={card}
      />

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            getCurrentProfile().then(p => {
              setProfile(p);
              setIsListModalOpen(true);
            });
          }}
        />
      )}

      {reviewsModalSellerIdRef.current && (
        <SellerReviewsModal
          isOpen={!!reviewsModalSellerId}
          onClose={() => setReviewsModalSellerId(null)}
          sellerId={reviewsModalSellerIdRef.current}
          sellerSummary={sellerSummary}
        />
      )}

      <ReportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        type="listing"
        targetId={String(data?.id || inventoryId || card.id)}
        targetName={`${card.name} (${data?.condition || 'Card'}) · ${sellerSummary?.display_name || data?.seller_name || 'Listing'}`}
        targetLink={typeof window !== 'undefined' ? window.location.href : ''}
      />

      <MoveCardModal
        open={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        card={card ? { id: card.id, name: card.name } : null}
        hasFoil={card ? hasFoilVariant(card) : false}
        initialFoil={(collection[card.id] || 0) === 0 && (collection[`${card.id}_foil`] || 0) > 0}
        sourceId={activeNamed ? activeNamed.id : PERSONAL_COLLECTION_ID}
        personalCards={personalCollection}
        applyPersonal={(next) => { setCollection(next); saveLocalCollection(next); }}
        pricesFor={(coll, defaults, cardsMap) => {
          const prices: Record<string, number> = {};
          for (const key of Object.keys(cardsMap)) {
            const isFoil = key.endsWith('_foil');
            const cId = isFoil ? key.replace(/_foil$/, '') : key;
            const p = listPriceForCard(defaults, card?.id === cId ? card : undefined, isFoil, cardValuesForListing);
            prices[key] = p;
          }
          return prices;
        }}
        onToast={(msg, type) => showLocalToast(msg, type || 'info')}
      />

      {moveToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl border text-xs font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2"
          style={
            moveToast.type === 'error'
              ? { background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }
              : moveToast.type === 'success'
              ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
              : { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }
          }
        >
          <span>{moveToast.msg}</span>
        </div>
      )}
    </div>
  );
}

function PriceChartingButton({ card }: { card: CatalogCard; isFoil?: boolean }) {
  const game = (card.game || 'riftbound').toLowerCase();
  const cmSlug =
    game === 'mtg' ? 'Magic' :
    game === 'onepiece' ? 'OnePiece' :
    game === 'lorcana' ? 'Lorcana' :
    game === 'starwars' ? 'StarWarsUnlimited' :
    game === 'fab' ? 'FleshAndBlood' :
    'Riftbound';
  const url = `https://www.cardmarket.com/en/${cmSlug}/Products/Search?searchString=${encodeURIComponent(card.name)}`;

  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm sm:text-base font-bold transition shadow-sm border hover:brightness-110"
      style={{
        background: 'var(--bg-surface-2)',
        borderColor: 'var(--border)',
        color: 'var(--text-primary)'
      }}
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
        <polyline points="17 6 23 6 23 12"/>
      </svg>
      <span>Check on Cardmarket</span>
    </a>
  );
}

function BackLink({ onClose }: { onClose?: () => void,}) {
  if (onClose) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); onClose(); }}
        className="absolute top-3 right-3 sm:top-5 sm:right-5 z-30 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer active:scale-95 border"
        style={{
          background: 'var(--bg-surface-2)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)'
        }}
        title={"Close"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault();
          window.history.back();
        } else {
          window.location.href = "/";
        }
      }}
      className="inline-flex items-center gap-2 text-xs font-bold mb-4 px-3 py-1.5 rounded-lg border transition cursor-pointer"
      style={{
        background: 'var(--bg-surface-2)',
        borderColor: 'var(--border)',
        color: 'var(--text-secondary)'
      }}
    >
      ← Back to catalog
    </button>
  );
}
