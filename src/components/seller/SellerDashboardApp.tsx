import React, { useState, useEffect, useMemo, useRef } from 'react';
import { allowedHoldActions, sellerCanCompleteFrom, OPEN_HOLD_STATUSES, BUYER_CONFIRM_DAYS, type HoldAction } from '../../lib/holdFlow';
import { useExitTransition } from '../../lib/useExitTransition';
import { supabase, cardThumbProps } from '../../lib/supabase';
import { getCurrentProfile, getCurrentUser } from '../../lib/auth';
import { getCardImageUrl } from '../../lib/supabase';
import { useSiteTheme } from '../../lib/theme';
import { useLanguage } from '../../lib/i18n';
import { useCurrency } from '../../lib/currency';
import { ListCardModal } from '../marketplace/ListCardModal';
import { CreateTradeModal } from '../marketplace/CreateTradeModal';
import { CreateBulkModal } from '../marketplace/CreateBulkModal';
import { CreateAuctionModal } from '../marketplace/CreateAuctionModal';
import { BulkDetailModal } from '../marketplace/BulkDetailModal';
import { AuctionDetailModal } from '../marketplace/AuctionDetailModal';
import { formatAuctionCountdown } from '../marketplace/AuctionCard';
import { ShippingSettingsPanel } from './ShippingSettingsPanel';
import { CollectionSettingsPanel } from './CollectionSettingsPanel';
import { InfoTip, TipTerm } from './InfoTip';
import { SelectBox } from './SelectBox';
import { AuthModal } from '../auth/AuthModal';
import { getSellerTier, BadgeIconSvg, SiteOwnerTag, type SellerTier } from '../../lib/badges';
import { fetchReputation, fetchReviewsWrittenBy } from '../../lib/reviews';
import { BuyerTrustLine, ReviewCard, Stars } from '../reviews/ReviewParts';
import { RateTradeModal } from '../reviews/RateTradeModal';
import { adjustLocalCollection } from '../../lib/collectionClient';
import { listingCollectionLinks } from '../../lib/sellerNotes';
import { EditListingModal } from './EditListingModal';
import { useCollectionsStore, refreshCollections } from '../../lib/collectionsStore';
import type { UserProfile, Order, TradeReview, MarketplaceTrade, MarketplaceBulkListing, MarketplaceAuction } from '../../types';
import { StatBox } from '../StatBox';
import { Pagination, usePagination } from '../Pagination';

export function SellerDashboardApp() {
  const { theme: effectiveTheme } = useSiteTheme();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { formatPrice, isHuf } = useCurrency();

  // Listings State
  const [listings, setListings] = useState<any[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<any | null>(null);
  const [updatingListingId, setUpdatingListingId] = useState<string | null>(null);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const [matchingLowestId, setMatchingLowestId] = useState<string | null>(null);
  const [matchingAllBusy, setMatchingAllBusy] = useState(false);
  const [showBulkPriceModal, setShowBulkPriceModal] = useState(false);
  // Named collections: to name the one a listing belongs to.
  const collectionsStore = useCollectionsStore();
  const collectionName = (id: string | null) => collectionsStore.collections.find(c => c.id === id)?.name || t('a collection', 'egy gyűjtemény');
  const bulkPriceModalAnim = useExitTransition(showBulkPriceModal, 250);
  const [bulkPriceHuf, setBulkPriceHuf] = useState<number>(500);
  // Lowest active price per card (across every seller on the platform), keyed by
  // `${card_id}::${'foil'|'normal'}` — powers the "Platform Price Health" KPI and
  // the per-listing undercut badge in the Stats table.
  const [platformLowestByCard, setPlatformLowestByCard] = useState<Map<string, number>>(new Map());
  // Search-demand count (last 7 days) per card_id, platform-wide.
  const [demandByCard, setDemandByCard] = useState<Record<string, number>>({});

  // Collector badge: unique Riftbound cards owned out of all cards in the catalog.
  const [totalCardCount, setTotalCardCount] = useState(1);
  const [ownedCardCount, setOwnedCardCount] = useState(0);

  // Seller Sales & Rating State
  const [sellerOrders, setSellerOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [sellerReviews, setSellerReviews] = useState<TradeReview[]>([]);
  // Ratings I've given buyers, by order, and the sale being rated right now.
  const [buyerRatingsByOrder, setBuyerRatingsByOrder] = useState<Record<string, TradeReview>>({});
  const [ratingOrder, setRatingOrder] = useState<Order | null>(null);
  const [activeTab, setActiveTab] = useState<'listings' | 'holds' | 'analytics' | 'sales' | 'reviews' | 'shipping' | 'collections'>('listings');
  const [listingsSubTab, setListingsSubTab] = useState<'individual' | 'trades' | 'bulk' | 'auctions'>('individual');

  // Trades, Bulk & Auctions State inside Seller Hub
  const [sellerTrades, setSellerTrades] = useState<MarketplaceTrade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [isCreateTradeOpen, setIsCreateTradeOpen] = useState(false);

  const [sellerBulk, setSellerBulk] = useState<MarketplaceBulkListing[]>([]);
  const [loadingBulk, setLoadingBulk] = useState(false);
  const [isCreateBulkOpen, setIsCreateBulkOpen] = useState(false);
  const [selectedBulkModal, setSelectedBulkModal] = useState<MarketplaceBulkListing | null>(null);

  const [sellerAuctions, setSellerAuctions] = useState<MarketplaceAuction[]>([]);
  const [loadingAuctions, setLoadingAuctions] = useState(false);
  const [isCreateAuctionOpen, setIsCreateAuctionOpen] = useState(false);
  const [selectedAuctionModal, setSelectedAuctionModal] = useState<MarketplaceAuction | null>(null);
  const [cancellingAuctionTarget, setCancellingAuctionTarget] = useState<MarketplaceAuction | null>(null);
  const [cancellingAuctionBusy, setCancellingAuctionBusy] = useState(false);

  // Hold Requests State (P2P classifieds model)
  const [holdRequests, setHoldRequests] = useState<any[]>([]);
  const [loadingHolds, setLoadingHolds] = useState(false);
  const [processingHoldId, setProcessingHoldId] = useState<string | null>(null);
  // Auto-hide nulls the message immediately, but the toast needs it for the length of its own
  // exit transition - freeze the last shown message instead of reading the live one.
  const toastMessageRef = useRef<string | null>(null);
  if (toastMessage) toastMessageRef.current = toastMessage;
  const toastAnim = useExitTransition(!!toastMessage, 400);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Load User Collection and Card Catalog Game Distribution
  const loadCollectionStats = async () => {
    try {
      // 1. Get user collection from localStorage
      let collectionDict: Record<string, number> = {};
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem('tcg_user_collection') || localStorage.getItem('tcg_collection');
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              parsed.forEach((id: string) => { if (typeof id === 'string') collectionDict[id] = 1; });
            } else if (parsed && typeof parsed === 'object') {
              collectionDict = parsed;
            }
          } catch (e) {}
        }
      }

      // 2. Fetch cards mapping (id, game)
      const { data: cards, error } = await supabase.from('cards').select('id, game');
      if (!error && cards) {
        let total = 0;
        let owned = 0;

        const ownedCardIds = new Set<string>();
        Object.entries(collectionDict).forEach(([key, count]) => {
          if (count > 0) {
            const cleanId = key.replace('_foil', '');
            ownedCardIds.add(cleanId);
          }
        });

        cards.forEach(c => {
          total++;
          if (ownedCardIds.has(c.id)) owned++;
        });

        setTotalCardCount(Math.max(1, total));
        setOwnedCardCount(owned);
      }
    } catch (err) {
      console.warn('Error computing collection stats:', err);
    }
  };

  // Load Seller Listings
  const loadSellerListings = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    setLoadingListings(true);
    try {
      // pageSize: the endpoint's default is 50, which silently cut off any listings past that.
      const res = await fetch(`/api/marketplace/listings?seller_id=${targetUid}&pageSize=500`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setListings(json.data || []);
        }
      }
    } catch (e) {
      console.warn('Failed to load seller listings:', e);
    } finally {
      setLoadingListings(false);
    }
  };

  // Load Seller Sales History (strictly P2P marketplace sales, never retail store orders)
  const loadSellerSales = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    setLoadingOrders(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/orders?scope=marketplace&seller_id=${targetUid}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = await res.json();
        const allOrders: Order[] = json.orders || [];
        // Only actual P2P marketplace sales belonging to this seller
        const mySales = allOrders.filter(o => o.seller_id === targetUid);
        setSellerOrders(mySales);
      }
    } catch (e) {
      console.warn('Failed to load seller orders:', e);
    } finally {
      setLoadingOrders(false);
    }
  };

  // Load Seller Reviews
  const loadSellerReviews = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    try {
      const [rep, written] = await Promise.all([fetchReputation(targetUid, true), fetchReviewsWrittenBy(targetUid)]);
      setSellerReviews(rep.reviews.filter(r => r.direction === 'buyer_to_seller'));
      const byOrder: Record<string, TradeReview> = {};
      written.filter(r => r.direction === 'seller_to_buyer').forEach(r => { byOrder[r.order_number] = r; });
      setBuyerRatingsByOrder(byOrder);
    } catch (e) {
      console.warn('Failed to load seller reviews:', e);
    }
  };

  // Load Hold Requests
  const loadHoldRequests = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    setLoadingHolds(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/marketplace/hold-request?seller_id=${targetUid}`, { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setHoldRequests(json.data || []);
        }
      }
    } catch (e) {
      console.warn('Failed to load hold requests:', e);
    } finally {
      setLoadingHolds(false);
    }
  };

  const loadSellerTrades = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    setLoadingTrades(true);
    try {
      const res = await fetch(`/api/marketplace/trades?trader_id=${targetUid}&status=all`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setSellerTrades(json.data || []);
      }
    } catch (e) {
      console.warn('Failed to load seller trades:', e);
    } finally {
      setLoadingTrades(false);
    }
  };

  const loadSellerBulk = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    setLoadingBulk(true);
    try {
      const res = await fetch(`/api/marketplace/bulk?seller_id=${targetUid}&status=all`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setSellerBulk(json.data || []);
      }
    } catch (e) {
      console.warn('Failed to load seller bulk listings:', e);
    } finally {
      setLoadingBulk(false);
    }
  };

  const loadSellerAuctions = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    setLoadingAuctions(true);
    try {
      const res = await fetch(`/api/marketplace/auctions?seller_id=${targetUid}&status=all`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setSellerAuctions(json.data || []);
      }
    } catch (e) {
      console.warn('Failed to load seller auctions:', e);
    } finally {
      setLoadingAuctions(false);
    }
  };

  const handleTradeStatusUpdate = async (tradeId: string, newStatus: 'open' | 'completed') => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch('/api/marketplace/trades', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: tradeId, status: newStatus }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(newStatus === 'open' ? t('Trade returned to open marketplace', 'Csere visszatöltve a piacra') : t('Trade marked completed', 'Csere megjelölve teljesítettként'));
        loadSellerTrades();
        loadHoldRequests();
      }
    } catch (e: any) {
      showToast(e?.message || t('Error updating trade status', 'Hiba a csere állapotának frissítésekor'));
    }
  };

  const handleDeleteTrade = async (tradeId: string) => {
    if (!confirm(t('Remove this trade listing?', 'Eltávolítod ezt a cserehirdetést?'))) return;
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch(`/api/marketplace/trades?id=${tradeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        showToast(t('Trade removed', 'Csere eltávolítva'));
        loadSellerTrades();
      }
    } catch (e: any) {
      showToast(e?.message || t('Error deleting trade', 'Hiba a csere törlésekor'));
    }
  };

  const handleBulkStatusUpdate = async (bulkId: string, newStatus: 'in_stock' | 'on_hold' | 'sold') => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch('/api/marketplace/bulk', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: bulkId, status: newStatus }),
      });
      if (res.ok) {
        showToast(t('Bulk listing status updated', 'Bulk tétel állapota frissítve'));
        loadSellerBulk();
        loadHoldRequests();
      }
    } catch (e: any) {
      showToast(e?.message || t('Error updating bulk status', 'Hiba a bulk tétel frissítésekor'));
    }
  };

  const handleDeleteBulk = async (bulkId: string) => {
    if (!confirm(t('Remove this bulk listing?', 'Eltávolítod ezt a bulk tételt?'))) return;
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch(`/api/marketplace/bulk?id=${bulkId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        showToast(t('Bulk listing removed', 'Bulk tétel eltávolítva'));
        loadSellerBulk();
      }
    } catch (e: any) {
      showToast(e?.message || t('Error deleting bulk listing', 'Hiba a bulk tétel törlésekor'));
    }
  };

  const handleConfirmCancelAuction = async () => {
    if (!cancellingAuctionTarget) return;
    setCancellingAuctionBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch('/api/marketplace/auctions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'cancel',
          auction_id: cancellingAuctionTarget.id,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(
          json.penalty_applied
            ? t('Auction cancelled. 1-star system review recorded on your profile.', 'Aukció törölve. 1 csillagos rendszerértékelés került a profilodra.')
            : t('Auction cancelled.', 'Aukció törölve.')
        );
        setCancellingAuctionTarget(null);
        loadSellerAuctions();
        loadSellerReviews();
        loadHoldRequests();
      } else {
        showToast(json.error || t('Could not cancel auction', 'Nem sikerült törölni az aukciót'));
      }
    } catch (e: any) {
      showToast(e?.message || t('Error cancelling auction', 'Hiba az aukció törlésekor'));
    } finally {
      setCancellingAuctionBusy(false);
    }
  };

  useEffect(() => {

    getCurrentProfile().then(p => {
      setProfile(p);
      setLoading(false);
      if (p) {
        loadSellerListings(p.id);
        loadSellerTrades(p.id);
        loadSellerBulk(p.id);
        loadSellerAuctions(p.id);
        loadSellerSales(p.id);
        loadSellerReviews(p.id);
        loadHoldRequests(p.id);
      }
    });

    loadCollectionStats();

    const handleMarketplaceEvt = () => {
      loadSellerListings();
      loadSellerTrades();
      loadSellerBulk();
      loadSellerAuctions();
      loadHoldRequests();
      loadCollectionStats();
    };
    window.addEventListener('tcg-marketplace-changed', handleMarketplaceEvt);
    window.addEventListener('tcg-collection-change', loadCollectionStats);

    return () => {
      window.removeEventListener('tcg-marketplace-changed', handleMarketplaceEvt);
      window.removeEventListener('tcg-collection-change', loadCollectionStats);
    };
  }, []);

  // Actions: Unlist & Edit
  const handleUnlistCard = async (listingId: string) => {
    const listing = listings.find(item => item.inventory_id === listingId);
    const links = listingCollectionLinks(listing?.notes);
    const question = links.alwaysListId
      ? t(
          `Remove this listing? Its ${listing?.quantity || 0} cop${Number(listing?.quantity) === 1 ? 'y comes' : 'ies come'} out of "${collectionName(links.alwaysListId)}" too, since that collection lists everything in it.`,
          `Eltávolítod ezt a hirdetést? A(z) ${listing?.quantity || 0} példány kikerül a(z) "${collectionName(links.alwaysListId)}" gyűjteményből is, mivel az automatikusan hirdeti a benne lévő lapokat.`
        )
      : t('Are you sure you want to remove this listing?', 'Biztosan el szeretnéd távolítani ezt a hirdetést?');
    if (!confirm(question)) return;
    setUpdatingListingId(listingId);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error(t('No active user session. Please sign in again.', 'Nincs aktív bejelentkezés. Kérjük, jelentkezz be újra.'));
      }
      const res = await fetch(`/api/marketplace/listings?id=${listingId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        setListings(prev => prev.filter(item => item.inventory_id !== listingId));
        showToast(t('Listing removed successfully', 'Hirdetés sikeresen eltávolítva'));
        // Copies that came out of a collection when listed go back into it; the server says how many.
        if (listing) afterListingChange(listing, json);
      } else {
        const json = await res.json().catch(() => null);
        showToast(json?.error || t(`Failed to remove listing (${res.status})`, `Nem sikerült eltávolítani a hirdetést (${res.status})`));
      }
    } catch (e: any) {
      showToast(e?.message || t('Error removing listing', 'Hiba a hirdetés törlésekor'));
    } finally {
      setUpdatingListingId(null);
    }
  };

  /** After a listing changed on the server: mirror what moved in or out of a collection. */
  const afterListingChange = (item: any, json: any) => {
    // Personal lives in this browser too, so its change is mirrored here; named ones are re-read.
    if (Number(json?.collection_delta)) {
      adjustLocalCollection(item.card_id, Boolean(item.is_foil), Number(json.collection_delta));
    }
    if (json?.named_collection_id && Number(json?.named_collection_delta)) void refreshCollections();
    window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
  };

  const handleListingSaved = (json: any) => {
    showToast(t('Listing updated', 'Hirdetés frissítve'));
    const item = editingListing || listings.find(l => l.inventory_id === json?.listing?.id) || {};
    afterListingChange({ card_id: json?.listing?.card_id ?? item.card_id, is_foil: json?.listing?.is_foil ?? item.is_foil }, json);
    loadSellerListings();
  };

  /** +1 / -1 copy in stock, right from the listing row. Going below 1 unlists it. */
  const adjustStock = async (item: any, delta: number) => {
    const next = (Number(item.quantity) || 0) + delta;
    if (next < 1) {
      await handleUnlistCard(item.inventory_id);
      return;
    }
    setUpdatingListingId(item.inventory_id);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) throw new Error(t('No active user session. Please sign in again.', 'Nincs aktív bejelentkezés. Kérjük, jelentkezz be újra.'));
      const res = await fetch('/api/marketplace/listings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: item.inventory_id, quantity: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('Could not change the stock.', 'Nem sikerült módosítani a készletet.'));
      setListings(prev => prev.map(l => (l.inventory_id === item.inventory_id ? { ...l, quantity: next } : l)));
      afterListingChange(item, json);
    } catch (e: any) {
      showToast(e?.message || t('Could not change the stock.', 'Nem sikerült módosítani a készletet.'));
    } finally {
      setUpdatingListingId(null);
    }
  };

  const toggleListingSelected = (id: string) => {
    setSelectedListingIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedListingIds(prev => {
      const allVisible = filteredListings.every(item => prev.has(item.inventory_id));
      if (allVisible) return new Set();
      return new Set(filteredListings.map(item => item.inventory_id));
    });
  };

  const handleBulkUnlist = async () => {
    const ids = Array.from(selectedListingIds);
    if (ids.length === 0) return;
    if (!confirm(t(`Remove ${ids.length} selected listing${ids.length === 1 ? '' : 's'}? This cannot be undone.`, `Biztosan törölsz ${ids.length} kijelölt hirdetést? Ez nem vonható vissza.`))) return;

    setBulkActionBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error(t('No active user session. Please sign in again.', 'Nincs aktív bejelentkezés. Kérjük, jelentkezz be újra.'));
      }
      const targets = listings.filter(item => selectedListingIds.has(item.inventory_id));
      const results = await Promise.all(ids.map(id =>
        fetch(`/api/marketplace/listings?id=${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).then(async res => {
          const json = await res.json().catch(() => null);
          return { id, ok: res.ok, error: res.ok ? null : json?.error, returned: Number(json?.collection_delta) || 0 };
        })
      ));
      const removedIds = new Set(results.filter(r => r.ok).map(r => r.id));
      setListings(prev => prev.filter(item => !removedIds.has(item.inventory_id)));
      targets.forEach(listing => {
        const returned = results.find(r => r.id === listing.inventory_id)?.returned || 0;
        if (removedIds.has(listing.inventory_id) && returned > 0) {
          adjustLocalCollection(listing.card_id, Boolean(listing.is_foil), returned);
        }
      });
      setSelectedListingIds(new Set());
      window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      const failedCount = ids.length - removedIds.size;
      const firstError = results.find(r => !r.ok)?.error;
      showToast(failedCount > 0
        ? t(
            `Removed ${removedIds.size} listings, ${failedCount} failed${firstError ? `: ${firstError}` : ''}`,
            `${removedIds.size} hirdetés eltávolítva, ${failedCount} sikertelen${firstError ? `: ${firstError}` : ''}`
          )
        : t(
            `Removed ${removedIds.size} listing${removedIds.size === 1 ? '' : 's'}`,
            `${removedIds.size} hirdetés sikeresen eltávolítva`
          ));
    } catch (e: any) {
      showToast(e?.message || t('Error removing listings', 'Hiba a hirdetések eltávolításakor'));
    } finally {
      setBulkActionBusy(false);
    }
  };

  const handleBulkPriceChange = async () => {
    const ids = Array.from(selectedListingIds);
    if (ids.length === 0) return;
    const safePrice = Math.max(1, bulkPriceHuf);

    setBulkActionBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error(t('No active user session. Please sign in again.', 'Nincs aktív bejelentkezés. Kérjük, jelentkezz be újra.'));
      }
      const results = await Promise.all(ids.map(id =>
        fetch('/api/marketplace/listings', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ id, price_huf: safePrice }),
        }).then(async res => ({ id, ok: res.ok, error: res.ok ? null : (await res.json().catch(() => null))?.error }))
      ));
      const succeededIds = new Set(results.filter(r => r.ok).map(r => r.id));
      const succeededCount = succeededIds.size;
      setListings(prev => prev.map(item =>
        succeededIds.has(item.inventory_id) ? { ...item, price_huf: safePrice } : item
      ));
      setShowBulkPriceModal(false);
      setSelectedListingIds(new Set());
      window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      const failedCount = ids.length - succeededCount;
      const firstError = results.find(r => !r.ok)?.error;
      showToast(failedCount > 0
        ? t(
            `Updated ${succeededCount} listings, ${failedCount} failed${firstError ? `: ${firstError}` : ''}`,
            `${succeededCount} hirdetés frissítve, ${failedCount} sikertelen${firstError ? `: ${firstError}` : ''}`
          )
        : t(
            `Updated ${succeededCount} listing${succeededCount === 1 ? '' : 's'} to ${safePrice.toLocaleString()} Ft`,
            `${succeededCount} hirdetés ára frissítve erre: ${safePrice.toLocaleString()} Ft`
          ));
    } catch (e: any) {
      showToast(e?.message || t('Error updating listings', 'Hiba a hirdetések frissítésekor'));
    } finally {
      setBulkActionBusy(false);
    }
  };

  const handleMatchLowest = async (item: any, lowestPrice: number) => {
    if (matchingLowestId || matchingAllBusy) return;
    setMatchingLowestId(item.inventory_id);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) throw new Error(t('Please sign in to update listings.', 'Kérjük, jelentkezz be a hirdetések frissítéséhez.'));
      const res = await fetch('/api/marketplace/listings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: item.inventory_id, price_huf: lowestPrice }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('Failed to update price.', 'Nem sikerült az ár frissítése.'));
      setListings(prev => prev.map(l => (l.inventory_id === item.inventory_id ? { ...l, price_huf: lowestPrice } : l)));
      showToast(t(`Updated "${item.name}" to ${lowestPrice.toLocaleString()} Ft.`, `"${item.name}" ára frissítve: ${lowestPrice.toLocaleString()} Ft.`));
      window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
    } catch (e: any) {
      showToast(e?.message || t('Error updating price', 'Hiba az ár frissítésekor'));
    } finally {
      setMatchingLowestId(null);
    }
  };

  const handleMatchAllUndercut = async () => {
    if (undercutListings.length === 0 || matchingAllBusy) return;
    if (!confirm(t(
      `Update ${undercutListings.length} undercut listing${undercutListings.length === 1 ? '' : 's'} to match the lowest active prices on the platform?`,
      `Frissíted mind a(z) ${undercutListings.length} alulígért hirdetést a platform legalacsonyabb aktív áraihoz?`
    ))) return;
    setMatchingAllBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) throw new Error(t('Please sign in to update listings.', 'Kérjük, jelentkezz be a hirdetések frissítéséhez.'));

      const updates = undercutListings
        .map(item => {
          const lowest = getPlatformLowest(item);
          return lowest !== null ? { id: item.inventory_id, price: lowest } : null;
        })
        .filter((u): u is { id: string; price: number } => u !== null);

      const results = await Promise.all(updates.map(u =>
        fetch('/api/marketplace/listings', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ id: u.id, price_huf: u.price }),
        }).then(async res => ({ id: u.id, price: u.price, ok: res.ok }))
      ));

      const succeeded = results.filter(r => r.ok);
      const priceMap = new Map(succeeded.map(r => [r.id, r.price]));
      setListings(prev => prev.map(l => (priceMap.has(l.inventory_id) ? { ...l, price_huf: priceMap.get(l.inventory_id)! } : l)));
      window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      showToast(t(
        `Updated ${succeeded.length} listing${succeeded.length === 1 ? '' : 's'} to match lowest platform prices.`,
        `${succeeded.length} hirdetés ára a legolcsóbb platform árakhoz igazítva.`
      ));
    } catch (e: any) {
      showToast(e?.message || t('Error updating listings', 'Hiba a hirdetések frissítésekor'));
    } finally {
      setMatchingAllBusy(false);
    }
  };

  const handleExportSalesCsv = () => {
    if (sellerOrders.length === 0) return;
    const headers = [
      t('Order Number', 'Rendelésszám'),
      t('Date', 'Dátum'),
      t('Status', 'Állapot'),
      t('Items', 'Tételek'),
      t('Total HUF', 'Összesen (Ft)'),
      t('Customer Name', 'Vásárló neve'),
      t('Customer Email', 'Vásárló email címe'),
      t('Shipping Method', 'Szállítási mód')
    ];
    const rows = sellerOrders.map(o => [
      o.order_number,
      new Date(o.created_at).toISOString().slice(0, 10),
      o.status,
      `"${(o.items || []).map(i => `${i.quantity}x ${i.card_name} (${i.condition || 'NM'})`).join('; ')}"`,
      o.total_price_huf ?? o.total_huf ?? 0,
      `"${o.customer_info?.name || o.shipping_name || ''}"`,
      `"${o.customer_info?.email || ''}"`,
      `"${o.shipping_method || ''}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcg-sales-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('Sales history exported as CSV.', 'Eladási előzmények exportálva CSV formátumban.'));
  };

  const handleExportSalesJson = () => {
    if (sellerOrders.length === 0) return;
    const jsonContent = JSON.stringify(sellerOrders, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcg-sales-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('Sales history exported as JSON.', 'Eladási előzmények exportálva JSON formátumban.'));
  };

  // Hold Request Management Actions
  const handleHoldAction = async (requestId: string, action: HoldAction, trackingNumberParam?: string) => {
    let trackingNumber = trackingNumberParam;
    if (action === 'mark_handed_over' && trackingNumber === undefined) {
      const entered = window.prompt(t('Enter tracking number (optional, leave blank for in-person / untracked):', 'Add meg a nyomkövetési számot (opcionális, hagyd üresen személyes átadásnál / nem nyomon követettnél):'));
      if (entered === null) return;
      if (entered.trim()) trackingNumber = entered.trim();
    }
    const targetReq = holdRequests.find(r => r.id === requestId);
    const confirmPrompt =
      action === 'confirm_sale'
        ? (targetReq?.status === 'buyer_received'
            ? t('The buyer confirmed they received the card. OK and complete the sale now?', 'A vevő megerősítette a kártya átvételét. Befejezed és lezárod most az eladást?')
            : t(`3 days have passed since handover without a response. Complete the sale now?`, '3 nap telt el az átadás óta válasz nélkül. Lezárod most az eladást?'))
        : action === 'deny'
        ? t('Deny handover or receipt? The hold will be cancelled and the card returned to In Stock.', 'Megtagadod az átadást vagy átvételt? A foglalás törlődik és a kártya visszakerül a készletre.')
        : action === 'mark_handed_over'
        ? t('Mark as handed over / sent? The buyer will have 3 days to confirm receipt before it auto-completes.', 'Megjelölöd átadottként / feladottként? A vevőnek 3 napja van megerősíteni az átvételt az automatikus lezárás előtt.')
        : action === 'hold'
        ? t('Approve holding this card for the buyer?', 'Jóváhagyod a kártya foglalását a vevő részére?')
        : action === 'release'
        ? t('Release this hold? The card will become In Stock again.', 'Feloldod a foglalást? A kártya újra Készleten állapotba kerül.')
        : t('Reject this hold request?', 'Elutasítod ezt a foglalási kérést?');

    if (!confirm(confirmPrompt)) return;

    setProcessingHoldId(requestId);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch('/api/marketplace/hold-request', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          id: requestId,
          action,
          ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(
          action === 'update_tracking'
            ? t('Tracking number updated.', 'Nyomkövetési szám frissítve.')
            : action === 'confirm_sale'
            ? t('Sale completed and recorded.', 'Eladás befejezve és rögzítve.')
            : action === 'deny'
            ? t('Hold denied and cancelled. Card returned to In Stock.', 'Foglalás megtagadva és törölve. A kártya visszakerült a készletre.')
            : action === 'mark_handed_over'
            ? t('Marked as handed over - waiting for buyer confirmation (auto-completes in 3 days).', 'Átadottként jelölve - várakozás a vevő megerősítésére (3 nap múlva automatikusan lezárul).')
            : action === 'hold'
            ? t('Card marked as on hold.', 'A kártya lefoglalva.')
            : action === 'release'
            ? t('Hold released, card back in stock.', 'Foglalás feloldva, a kártya újra készleten.')
            : t('Hold request rejected.', 'Foglalási kérés elutasítva.')
        );
        loadHoldRequests();
        loadSellerListings();
        loadSellerSales();
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      } else {
        showToast(json.error || t('Action failed', 'A művelet sikertelen'));
      }
    } catch (e: any) {
      showToast(e?.message || t('Error processing request', 'Hiba a kérés feldolgozásakor'));
    } finally {
      setProcessingHoldId(null);
    }
  };

  // Direct Listing Status Change (In Stock, On Hold, Sold)
  const handleListingStatusChange = async (inventoryId: string, newStatus: 'In Stock' | 'On Hold' | 'Sold') => {
    setUpdatingListingId(inventoryId);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch('/api/marketplace/listings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          id: inventoryId,
          status: newStatus,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const statusLabels: Record<string, string> = {
          'In Stock': t('In Stock', 'Készleten'),
          'On Hold': t('On Hold', 'Foglalva'),
          'Sold': t('Sold', 'Eladva'),
        };
        showToast(t(`Status updated to ${newStatus}`, `Állapot frissítve erre: ${statusLabels[newStatus] || newStatus}`));
        loadSellerListings();
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      } else {
        showToast(json.error || t('Failed to update status', 'Nem sikerült az állapot frissítése'));
      }
    } catch (e: any) {
      showToast(e?.message || t('Error updating status', 'Hiba az állapot frissítésekor'));
    } finally {
      setUpdatingListingId(null);
    }
  };

  // Calculated Statistics
  const isOwner = Boolean(profile?.role === 'owner' || profile?.email === 'vnoel05@gmail.com' || profile?.email === 'support@tcgxchange.net');
  // Only holds still awaiting action belong on the Holds tab — once a request is
  // completed the card is sold and the record lives in Sales History instead.
  const activeHoldRequests = useMemo(() => {
    return holdRequests.filter(h => OPEN_HOLD_STATUSES.includes(h.status));
  }, [holdRequests]);
  const pendingHoldCount = activeHoldRequests.length;
  // Total units/cards sold across all completed orders (purely informational stat).
  const itemsSold = useMemo(() => {
    return sellerOrders.reduce((sum, ord) => {
      if (ord.status === 'Cancelled') return sum;
      const count = Array.isArray(ord.items)
        ? ord.items.reduce((s, it) => s + (it.quantity || 1), 0)
        : 1;
      return sum + count;
    }, 0);
  }, [sellerOrders]);

  // Number of distinct completed sales (transactions) — this gates seller tier, so a single
  // buyer purchasing many cards in one order doesn't by itself vault a seller to the top tier.
  const completedSalesCount = useMemo(() => {
    return sellerOrders.filter(ord => ord.status !== 'Cancelled').length;
  }, [sellerOrders]);

  const totalRevenueHuf = useMemo(() => {
    return sellerOrders.reduce((sum, ord) => {
      if (ord.status === 'Cancelled') return sum;
      return sum + (ord.total_price_huf ?? ord.total_huf ?? 0);
    }, 0);
  }, [sellerOrders]);

  const activeListings = useMemo(() => {
    return listings.filter(it => it.status !== 'Sold');
  }, [listings]);

  const totalListedValueHuf = useMemo(() => {
    return activeListings.reduce((sum, item) => sum + ((item.price_huf || 0) * (item.quantity ?? 1)), 0);
  }, [activeListings]);

  // Fetch the lowest active marketplace price per (card, foil/normal) across the whole
  // platform for every card this seller currently has listed.
  useEffect(() => {
    const cardIds = [...new Set(activeListings.map(item => item.card_id).filter(Boolean))];
    if (cardIds.length === 0) {
      setPlatformLowestByCard(new Map());
      return;
    }
    let cancelled = false;
    supabase
      .from('marketplace_listings')
      .select('card_id, is_foil, price_huf')
      .in('card_id', cardIds)
      .eq('status', 'In Stock')
      .gt('quantity', 0).then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const map = new Map<string, number>();
        data.forEach((row: any) => {
          const key = `${row.card_id}::${row.is_foil ? 'foil' : 'normal'}`;
          const cur = map.get(key);
          if (cur === undefined || row.price_huf < cur) map.set(key, row.price_huf);
        });
        setPlatformLowestByCard(map);
      });
    return () => { cancelled = true; };
  }, [activeListings]);

  // Fetch 7-day search-demand counts for every card this seller has actively listed.
  useEffect(() => {
    const cardIds = [...new Set(activeListings.map(item => item.card_id).filter(Boolean))];
    if (cardIds.length === 0) {
      setDemandByCard({});
      return;
    }
    let cancelled = false;
    fetch(`/api/analytics/card-demand?card_ids=${cardIds.join(',')}&days=7`)
      .then(res => res.json())
      .then(json => {
        if (!cancelled && json?.success) setDemandByCard(json.data || {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeListings]);

  const getPlatformLowest = (item: any): number | null => {
    const key = `${item.card_id}::${item.is_foil ? 'foil' : 'normal'}`;
    return platformLowestByCard.get(key) ?? null;
  };

  // A listing is "undercut" when another seller has the same card active for less.
  const undercutListings = useMemo(() => {
    return activeListings.filter(item => {
      const lowest = getPlatformLowest(item);
      return lowest !== null && item.price_huf > lowest;
    });
  }, [activeListings, platformLowestByCard]);

  const priceHealthPct = useMemo(() => {
    if (activeListings.length === 0) return 100;
    const competitive = activeListings.length - undercutListings.length;
    return Math.round((competitive / activeListings.length) * 100);
  }, [activeListings.length, undercutListings.length]);

  const avgOrderValueHuf = completedSalesCount > 0 ? Math.round(totalRevenueHuf / completedSalesCount) : 0;
  const pendingOnlyCount = useMemo(() => holdRequests.filter(h => h.status === 'pending').length, [holdRequests]);
  const heldOnlyCount = useMemo(() => holdRequests.filter(h => h.status === 'held' || h.status === 'handed_over').length, [holdRequests]);

  const averageRating = useMemo<number | null>(() => {
    if (sellerReviews.length === 0) return null;
    const total = sellerReviews.reduce((sum, r) => sum + r.rating, 0);
    return total / sellerReviews.length;
  }, [sellerReviews]);

  const isLightTheme = effectiveTheme === 'light';

  // Seller Tier Calculation — based on distinct completed sales, not total cards sold.
  const sellerTier: SellerTier = useMemo(() => {
    return getSellerTier(completedSalesCount, averageRating, isOwner, isLightTheme);
  }, [completedSalesCount, averageRating, isOwner, isLightTheme]);


  const filteredListings = useMemo(() => {
    if (!searchQuery.trim()) return activeListings;
    const q = searchQuery.toLowerCase().trim();
    return activeListings.filter(it =>
      (it.name || '').toLowerCase().includes(q) ||
      (it.card_number || '').toLowerCase().includes(q) ||
      (it.rarity || '').toLowerCase().includes(q) ||
      (it.set_name || '').toLowerCase().includes(q)
    );
  }, [activeListings, searchQuery]);

  // Both tabs show a page at a time instead of every listing at once.
  const listingsPage = usePagination(filteredListings, 24, searchQuery);
  const [statsFilter, setStatsFilter] = useState<'all' | 'undercut' | 'demand' | 'stale'>('all');
  const [statsSort, setStatsSort] = useState<'views' | 'clicks' | 'price' | 'undercut'>('views');

  const statsSummary = useMemo(() => {
    let views = 0;
    let clicks = 0;
    let highDemand = 0;
    let stale = 0;
    for (const item of activeListings) {
      const v = item.views || 0;
      const c = item.clicks || 0;
      views += v;
      clicks += c;
      if ((demandByCard[item.card_id] || 0) >= 5) highDemand++;
      const days = item.created_at ? (Date.now() - new Date(item.created_at).getTime()) / 86400000 : 0;
      if (v === 0 && c === 0 && days > 30) stale++;
    }
    const avgCtr = views > 0 ? ((clicks / views) * 100).toFixed(1) : '0.0';
    return { views, clicks, avgCtr, highDemand, stale };
  }, [activeListings, demandByCard]);

  const statsRows = useMemo(() => {
    const filtered = activeListings.filter((item) => {
      if (statsFilter === 'undercut') {
        const lowest = getPlatformLowest(item);
        return lowest !== null && item.price_huf > lowest;
      }
      if (statsFilter === 'demand') return (demandByCard[item.card_id] || 0) >= 5;
      if (statsFilter === 'stale') {
        const days = item.created_at ? (Date.now() - new Date(item.created_at).getTime()) / 86400000 : 0;
        return (item.views || 0) === 0 && (item.clicks || 0) === 0 && days > 30;
      }
      return true;
    });
    return filtered.slice().sort((a, b) => {
      if (statsSort === 'clicks') return (b.clicks || 0) - (a.clicks || 0);
      if (statsSort === 'price') return (b.price_huf || 0) - (a.price_huf || 0);
      if (statsSort === 'undercut') {
        const diffA = getPlatformLowest(a) !== null ? a.price_huf - (getPlatformLowest(a) as number) : -1;
        const diffB = getPlatformLowest(b) !== null ? b.price_huf - (getPlatformLowest(b) as number) : -1;
        return diffB - diffA;
      }
      return (b.views || 0) - (a.views || 0);
    });
  }, [activeListings, statsFilter, statsSort, demandByCard, platformLowestByCard]);
  const statsPage = usePagination(statsRows, 20, `${statsFilter}:${statsSort}`);
  const listingsTopRef = useRef<HTMLDivElement>(null);
  const statsTopRef = useRef<HTMLDivElement>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-bold text-base animate-pulse" style={{ color: 'var(--text-accent)' }}>
          {t('Loading seller dashboard…', 'Eladói vezérlőpult betöltése…')}
        </span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: 'clamp(16px,3vw,32px) clamp(16px,3vw,24px)' }}>
        <div
          className="max-w-md mx-auto my-12 p-8 text-center rounded-2xl shadow-xl border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <div className="w-16 h-16 rounded-2xl inline-flex items-center justify-center mb-4 border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--accent)' }}>
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18M3 10h18M5 10V21M19 10V21M9 21v-4a2 2 0 012-2h2a2 2 0 012 2v4M3 10l2-6h14l2 6" />
            </svg>
          </div>
          <h2 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            {t('Seller Dashboard', 'Eladói vezérlőpult')}
          </h2>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            {t(
              'Sign in to manage your marketplace listings, view click & visitor stats, and unlock upgraded seller badges!',
              'Jelentkezz be, hogy kezeld a piactéri hirdetéseidet, lásd a kattintási és látogatottsági statisztikákat, és feloldd az eladói jelvényeket!'
            )}
          </p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-6 py-3 font-black rounded-xl text-sm transition shadow-md cursor-pointer"
            style={{
              background: 'var(--accent-strong)',
              color: 'var(--text-on-accent, #000)',
              boxShadow: '0 0 16px var(--accent-glow)',
            }}
          >
            {t('Sign In', 'Bejelentkezés')}
          </button>
          {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 'clamp(16px,3vw,32px) clamp(16px,3vw,24px)' }}>
      {/* Toast Notification */}
      {toastAnim.rendered && toastMessageRef.current && (
        <div data-state={toastAnim.state} className="tv-toast fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-emerald-500/50 text-[var(--positive)] font-bold text-xs shadow-2xl flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessageRef.current}</span>
        </div>
      )}

      {/* ─── Top Header: Identity & Badges ─────────────────────────── */}
      <div
        className="rounded-2xl p-5 sm:p-7 mb-6 border shadow-sm"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-5">
          {/* Seller Identity. On a phone it stacks - a large avatar with the name and badges
              centered under it - instead of a small avatar with everything squeezed beside it. */}
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 text-center sm:text-left min-w-0 sm:flex-1">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.display_name || 'Seller'}
                className="w-24 h-24 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 shrink-0"
                style={{ borderColor: sellerTier.color }}
              />
            ) : (
              <div
                className="w-24 h-24 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center text-4xl sm:text-3xl font-black border-2 shrink-0"
                style={{
                  background: 'var(--bg-surface-2)',
                  borderColor: sellerTier.color,
                  color: 'var(--accent)',
                }}
              >
                {(profile.display_name || profile.email || 'S')[0].toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center justify-center sm:justify-start gap-2.5 flex-wrap">
                <h1 className="text-2xl font-black break-words min-w-0" style={{ color: 'var(--text-primary)' }}>
                  {profile.display_name || 'Seller'}
                </h1>
                {isOwner && <SiteOwnerTag />}
                <span
                  className="text-[10px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider flex items-center gap-1 whitespace-nowrap"
                  style={sellerTier.badgeStyle}
                >
                  <BadgeIconSvg iconType={sellerTier.iconType} className="w-3 h-3" />
                  <span>{sellerTier.nameEn}</span>
                </span>
              </div>
              <div className="text-xs sm:text-sm font-mono mt-1 break-all" style={{ color: 'var(--text-tertiary)' }}>
                {profile.email}
              </div>
            </div>
          </div>

        </div>

        {/* Rating, sales and cards sold as three stat boxes - they used to be one dot-separated
            line under the email that wrapped awkwardly on a phone. */}
        <div className="grid grid-cols-3 gap-2 mt-5">
          <StatBox
            label={t('Rating', 'Értékelés')}
            title={averageRating !== null ? (sellerReviews.length === 1 ? t('1 review', '1 értékelés') : t(`${sellerReviews.length} reviews`, `${sellerReviews.length} értékelés`)) : t('No ratings yet', 'Még nincs értékelés')}
            valueClassName={averageRating !== null ? 'text-amber-400' : 'text-[var(--text-tertiary)]'}
            value={averageRating !== null ? (
              <>&#9733; {averageRating.toFixed(1)} <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>({sellerReviews.length})</span></>
            ) : (
              <span className="text-sm">{t('None yet', 'Még nincs')}</span>
            )}
          />
          <StatBox label={t('Sales', 'Eladások')} value={completedSalesCount} valueClassName="text-[var(--positive)]" />
          <StatBox label={t('Cards sold', 'Eladott kártyák')} value={itemsSold} valueClassName="text-amber-400" />
        </div>

        {/* ─── SELLER MERCHANT TIER BANNER ─── */}
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <div
            className="p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            style={{
              background: 'var(--bg-surface-2)',
              borderColor: sellerTier.border,
            }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center" style={{ color: sellerTier.color }}>
                  <BadgeIconSvg iconType={sellerTier.iconType} className="w-4 h-4" />
                </span>
                <span className="text-sm font-black" style={{ color: sellerTier.color }}>
                  {sellerTier.nameEn}
                </span>
                <span
                  className="text-[10px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider"
                  style={sellerTier.badgeStyle}
                >
                  {completedSalesCount >= 1 ? `${t('Tier', 'Szint')} ${sellerTier.tier}` : t('Level 0', '0. szint')}
                </span>
              </div>
              <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {completedSalesCount >= 1
                  ? t(
                      `Active community seller with ${completedSalesCount} completed ${completedSalesCount === 1 ? 'sale' : 'sales'}.`,
                      `Aktív közösségi eladó ${completedSalesCount} teljesített eladással.`
                    )
                  : t('Complete at least 1 sale to unlock the "Tier 1 Seller" badge!', 'Teljesíts legalább 1 eladást a „Tier 1 eladó” jelvény feloldásához!')}
              </p>
            </div>

            {/* Sales Progress Bar */}
            {sellerTier.nextTierSales > completedSalesCount && (
              <div className="sm:w-64 shrink-0">
                <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {t('Next merchant tier:', 'Következő eladói szint:')}
                  </span>
                  <span className="font-mono" style={{ color: sellerTier.color }}>
                    {completedSalesCount} / {sellerTier.nextTierSales} {t('sales', 'eladás')}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden bg-black/40 border border-white/5">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.round((completedSalesCount / Math.max(1, sellerTier.nextTierSales)) * 100))}%`,
                      background: sellerTier.color,
                      boxShadow: `0 0 10px ${sellerTier.color}`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Navigation Tabs: horizontally-scrollable underline bar ──── */}
      {/* Single row on every viewport width (scrolls instead of wrapping into a ragged grid). */}
      <div
        className="flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b mb-6"
        style={{ borderColor: 'var(--border-subtle)', scrollbarWidth: 'thin' }}
      >
        {([
          {
            id: 'listings' as const,
            label: t('Listings', 'Hirdetések'),
            count: activeListings.length,
            icon: <path d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V5a2 2 0 012-2z" />,
          },
          {
            id: 'holds' as const,
            label: t('Holds', 'Foglalások'),
            count: activeHoldRequests.length,
            urgentCount: pendingHoldCount,
            icon: (
              <>
                <line x1="12" y1="2" x2="12" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
              </>
            ),
          },
          {
            id: 'analytics' as const,
            label: t('Stats', 'Statisztika'),
            icon: <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
          },
          {
            id: 'sales' as const,
            label: t('Sales', 'Eladások'),
            count: sellerOrders.length,
            icon: <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
          },
          {
            id: 'reviews' as const,
            label: t('Reviews', 'Értékelések'),
            count: sellerReviews.length,
            icon: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
            iconFill: true,
          },
          {
            id: 'shipping' as const,
            label: t('Shipping', 'Szállítás'),
            icon: <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />,
          },
          {
            id: 'collections' as const,
            label: t('Collection Settings', 'Gyűjtemény beállítások'),
            icon: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
          },
        ]).map((tabDef) => {
          const isActive = activeTab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setActiveTab(tabDef.id)}
              className={`relative shrink-0 px-3.5 py-3 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border-b-2 whitespace-nowrap ${
                isActive
                  ? 'border-[var(--accent)] text-[var(--text-accent)]'
                  : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <svg
                className={`w-3.5 h-3.5 shrink-0 ${tabDef.iconFill ? 'fill-amber-400 text-amber-400' : ''}`}
                viewBox="0 0 24 24"
                fill={tabDef.iconFill ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {tabDef.icon}
              </svg>
              <span>{tabDef.label}</span>
              {tabDef.urgentCount ? (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-zinc-950 shadow-sm">
                  {tabDef.urgentCount}
                </span>
              ) : typeof tabDef.count === 'number' ? (
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>({tabDef.count})</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* ─── TAB 1: ACTIVE LISTINGS (Individual / Trades / Bulk / Auctions) ─── */}
      {activeTab === 'listings' && (
        <div ref={listingsTopRef} className="scroll-mt-24">
          {/* Sub-tabs inside Listings */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5 p-2 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                { id: 'individual' as const, label: t('Individual', 'Egyedi'), count: activeListings.length },
                { id: 'trades' as const, label: t('Trades', 'Cserék'), count: sellerTrades.length },
                { id: 'bulk' as const, label: t('Bulk', 'Bulk'), count: sellerBulk.length },
                { id: 'auctions' as const, label: t('Auctions', 'Aukciók'), count: sellerAuctions.length },
              ]).map((sub) => {
                const isSubActive = listingsSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setListingsSubTab(sub.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                      isSubActive
                        ? 'bg-[var(--accent-strong)] text-zinc-950 shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                    }`}
                  >
                    <span>{sub.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isSubActive ? 'bg-black/20 text-zinc-950' : 'bg-white/5 text-[var(--text-tertiary)]'}`}>
                      {sub.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div>
              {listingsSubTab === 'individual' && (
                <button
                  type="button"
                  onClick={() => setIsListModalOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-zinc-950 cursor-pointer transition"
                >
                  {t('+ List Individual Card', '+ Kártya hirdetése')}
                </button>
              )}
              {listingsSubTab === 'trades' && (
                <button
                  type="button"
                  onClick={() => setIsCreateTradeOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-zinc-950 cursor-pointer transition"
                >
                  {t('+ Create Trade', '+ Csere létrehozása')}
                </button>
              )}
              {listingsSubTab === 'bulk' && (
                <button
                  type="button"
                  onClick={() => setIsCreateBulkOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-indigo-500 hover:bg-indigo-400 text-white cursor-pointer transition"
                >
                  {t('+ List Bulk Lot', '+ Bulk tétel hirdetése')}
                </button>
              )}
              {listingsSubTab === 'auctions' && (
                <button
                  type="button"
                  onClick={() => setIsCreateAuctionOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer transition"
                >
                  {t('+ Create Auction', '+ Aukció indítása')}
                </button>
              )}
            </div>
          </div>

          {listingsSubTab === 'individual' && (
            <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="relative max-w-sm w-full">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('Search your listings…', 'Hirdetéseid keresése…')}
                className="w-full px-3.5 py-2 rounded-xl text-xs font-bold outline-none border transition"
                style={{
                  background: 'var(--bg-input)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                  aria-label={t('Clear search', 'Keresés törlése')}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {filteredListings.length > 0 && (() => {
              const selectedVisible = filteredListings.filter(item => selectedListingIds.has(item.inventory_id)).length;
              const allSelected = selectedVisible === filteredListings.length;
              return (
                <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none" style={{ color: 'var(--text-tertiary)' }}>
                  <SelectBox
                    checked={allSelected}
                    indeterminate={selectedVisible > 0 && !allSelected}
                    onChange={toggleSelectAllVisible}
                    label={t('Select all listings', 'Összes hirdetés kijelölése')}
                  />
                  {t('Select all', 'Összes kijelölése')}
                </label>
              );
            })()}

            <div className="text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>
              {filteredListings.length} {t('items', 'tétel')}
            </div>
          </div>

          {selectedListingIds.size > 0 && (
            <div
              className="flex flex-wrap items-center gap-2.5 mb-4 p-3 rounded-xl border"
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border, var(--border))' }}
            >
              <span className="text-xs font-black" style={{ color: 'var(--text-accent)' }}>
                {selectedListingIds.size} {t('selected', 'kijelölve')}
              </span>
              <button
                type="button"
                onClick={() => {
                  const first = listings.find(item => selectedListingIds.has(item.inventory_id));
                  setBulkPriceHuf(first?.price_huf || 500);
                  setShowBulkPriceModal(true);
                }}
                disabled={bulkActionBusy}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg border transition cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border-[var(--border)] disabled:opacity-50"
              >
                {t('Set Price…', 'Ár beállítása…')}
              </button>
              <button
                type="button"
                onClick={handleBulkUnlist}
                disabled={bulkActionBusy}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg border transition cursor-pointer bg-red-500/10 hover:bg-red-500/20 text-[var(--negative)] border-red-500/30 disabled:opacity-50"
              >
                {bulkActionBusy ? '…' : t('Unlist Selected', 'Kijelöltek lezárása')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedListingIds(new Set())}
                disabled={bulkActionBusy}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg border cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border-[var(--border)] transition disabled:opacity-50"
              >
                {t('Deselect all', 'Kijelölés megszüntetése')}
              </button>
            </div>
          )}

          {loadingListings ? (
            <div className="p-12 text-center rounded-2xl border animate-pulse" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="text-sm font-bold text-[var(--text-tertiary)]">{t('Loading listings…', 'Hirdetések betöltése…')}</div>
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border shadow-sm" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="w-12 h-12 mx-auto mb-2 flex items-center justify-center text-[var(--text-muted)]">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V5a2 2 0 012-2z" />
                </svg>
              </div>
              <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {searchQuery
                  ? t('No matching listings found', 'Nincs egyező hirdetés')
                  : t('No active marketplace listings', 'Nincs aktív piactéri hirdetésed')}
              </div>
              <p className="text-xs max-w-md mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }}>
                {t('List a card for sale to start building your seller tier!', 'Hirdess meg egy kártyát, hogy elkezdhesd növelni az eladói szintedet!')}
              </p>
              <button
                type="button"
                onClick={() => setIsListModalOpen(true)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-md"
              >
                {t('+ List Your First Card', '+ Hirdesd meg az első kártyádat')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {listingsPage.pageItems.map((item) => {
                const isSelected = selectedListingIds.has(item.inventory_id);
                // Once the user has started selecting (clicked at least one checkbox),
                // clicking anywhere on any card toggles it too — a much bigger hitbox
                // than hunting for the checkbox on every single card.
                const selectionModeActive = selectedListingIds.size > 0;
                return (
                <div
                  key={item.inventory_id}
                  onClick={() => { if (selectionModeActive) toggleListingSelected(item.inventory_id); }}
                  className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 shadow-sm transition ${selectionModeActive ? 'cursor-pointer' : 'hover:border-[var(--accent)]'}`}
                  style={{
                    background: isSelected ? 'var(--accent-muted)' : 'var(--bg-surface)',
                    borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <label
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center justify-center w-9 h-9 -m-1.5 shrink-0 cursor-pointer"
                    >
                      <SelectBox
                        checked={isSelected}
                        onChange={() => toggleListingSelected(item.inventory_id)}
                        label={t(`Select ${item.name}`, `${item.name} kijelölése`)}
                      />
                    </label>
                    <div className="w-14 h-20 rounded-xl bg-[var(--bg-raised)] shrink-0 overflow-hidden border border-[var(--border)] relative">
                      {item.image_path ? (
                        <img {...cardThumbProps(item.image_path, 'avatar')} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--text-muted)]">TCG</div>
                      )}
                      {item.is_foil && (
                        <span className="absolute bottom-0 right-0 bg-amber-500 text-black text-[9px] font-black px-1 rounded-tl shadow">F</span>
                      )}
                      {item.inventory_images && item.inventory_images.length > 0 && (
                        <span className="absolute top-0 left-0 bg-emerald-500 text-zinc-950 text-[8px] font-black px-1 rounded-br shadow flex items-center gap-0.5">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <circle cx="12" cy="13" r="3" />
                          </svg>
                          <span>{item.inventory_images.length}</span>
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.name}
                        </div>
                        {item.status === 'On Hold' ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-[var(--text-accent)] border border-amber-500/40 shrink-0">
                            {t('ON HOLD', 'FOGLALVA')}
                          </span>
                        ) : item.status === 'Sold' ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-500/20 text-[var(--negative)] border border-rose-500/40 shrink-0">
                            {t('SOLD', 'ELADVA')}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-[var(--positive)] border border-emerald-500/40 shrink-0">
                            {t('IN STOCK', 'KÉSZLETEN')}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono">{item.card_number}</span>
                        <span>•</span>
                        <span className="text-indigo-300 font-semibold">{item.rarity}</span>
                        <span>•</span>
                        <span className="text-[var(--text-secondary)] font-medium">{item.condition || 'NM'}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-[var(--positive)]">
                          {item.price_huf ? formatPrice(item.price_huf) : 'N/A'}
                        </span>
                        <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1" title={t('Change how many copies are in stock', 'Készletmennyiség módosítása')}>
                          <button
                            type="button"
                            aria-label={t(`One fewer ${item.name} in stock`, `Eggyel kevesebb ${item.name} készleten`)}
                            onClick={() => adjustStock(item, -1)}
                            disabled={updatingListingId === item.inventory_id}
                            className="w-6 h-6 rounded-md border text-xs font-bold cursor-pointer disabled:opacity-40"
                            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                          >
                            -
                          </button>
                          <span className="text-xs font-bold min-w-[4.5rem] text-center" style={{ color: 'var(--text-secondary)' }}>{item.quantity} {t('in stock', 'készleten')}</span>
                          <button
                            type="button"
                            aria-label={t(`One more ${item.name} in stock`, `Eggyel több ${item.name} készleten`)}
                            onClick={() => adjustStock(item, 1)}
                            disabled={updatingListingId === item.inventory_id}
                            className="w-6 h-6 rounded-md border text-xs font-bold cursor-pointer disabled:opacity-40"
                            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                          >
                            +
                          </button>
                        </span>
                        {(() => {
                          const links = listingCollectionLinks(item.notes);
                          if (links.alwaysListId) {
                            return (
                              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }} title={t('Stock follows this always-list collection', 'A készlet követi ezt a mindig hirdetett gyűjteményt')}>
                                {collectionName(links.alwaysListId)}
                              </span>
                            );
                          }
                          if (links.sourceId) {
                            return (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }} title={t('Listed from this collection; unlisting gives the copies back to it', 'Ebből a gyűjteményből hirdetve; lezáráskor a példányok visszakerülnek ide')}>
                                {t('From', 'Forrás:')} {collectionName(links.sourceId)}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Views / Clicks Bar */}
                  <div onClick={(e) => e.stopPropagation()} className="pt-2.5 border-t flex items-center justify-between text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-cyan-400 font-semibold text-[11px]" title={t('Views', 'Megtekintések')}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>{item.views || 0}</span>
                      </span>
                      <span className="flex items-center gap-1 text-pink-400 font-semibold text-[11px]" title={t('Clicks', 'Kattintások')}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                        </svg>
                        <span>{item.clicks || 0}</span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        {item.views > 0 ? `${(((item.clicks || 0) / item.views) * 100).toFixed(0)}% CTR` : '0% CTR'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Status quick toggle */}
                      {item.status === 'On Hold' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleListingStatusChange(item.inventory_id, 'Sold')}
                            disabled={updatingListingId === item.inventory_id}
                            className="px-2 py-1 text-[10px] font-black rounded-lg border transition cursor-pointer disabled:opacity-50"
                            style={{ background: 'var(--positive-muted)', color: 'var(--positive)', borderColor: 'var(--positive-border)' }}
                            title={t('Mark as Sold', 'Megjelölés eladottként')}
                          >
                            {t('Sold', 'Eladva')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleListingStatusChange(item.inventory_id, 'In Stock')}
                            disabled={updatingListingId === item.inventory_id}
                            className="px-2 py-1 text-[10px] font-bold rounded-lg border transition cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border-[var(--border)] disabled:opacity-50"
                            title={t('Release hold', 'Foglalás feloldása')}
                          >
                            {t('Release', 'Feloldás')}
                          </button>
                        </>
                      ) : item.status === 'Sold' ? (
                        <button
                          type="button"
                          onClick={() => handleListingStatusChange(item.inventory_id, 'In Stock')}
                          disabled={updatingListingId === item.inventory_id}
                          className="px-2 py-1 text-[10px] font-bold rounded-lg border transition cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border-[var(--border)] disabled:opacity-50"
                          title={t('Relist as in stock', 'Újrahirdetés készleten lévőként')}
                        >
                          {t('Relist', 'Újrahirdet')}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setEditingListing(item)}
                        className="px-2 py-1 text-[10px] font-bold rounded-lg border transition cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border-[var(--border)]"
                      >
                        {t('Edit', 'Szerkesztés')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUnlistCard(item.inventory_id)}
                        disabled={updatingListingId === item.inventory_id}
                        className="px-2 py-1 text-[10px] font-bold rounded-lg border transition cursor-pointer disabled:opacity-50"
                        style={{ background: 'var(--negative-muted)', color: 'var(--negative)', borderColor: 'var(--negative-border)' }}
                      >
                        {updatingListingId === item.inventory_id ? '…' : t('Unlist', 'Lezárás')}
                      </button>
                    </div>
                  </div>
                </div>
              );})}
            </div>
          )}
          {!loadingListings && <Pagination state={listingsPage} noun={t('listings', 'hirdetés')} scrollTargetRef={listingsTopRef} />}
            </>
          )}

          {/* ─── SUB-TAB: TRADES ──────────────────────────────────────── */}
          {listingsSubTab === 'trades' && (
            <div className="space-y-4">
              {loadingTrades ? (
                <div className="p-12 text-center rounded-2xl border animate-pulse" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <div className="text-sm font-bold text-[var(--text-tertiary)]">{t('Loading trade listings…', 'Cserehirdetések betöltése…')}</div>
                </div>
              ) : sellerTrades.length === 0 ? (
                <div className="p-12 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {t('No trade listings yet', 'Még nincsenek cserehirdetések')}
                  </div>
                  <p className="text-xs max-w-md mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Set up a Card-for-Card trade listing to swap cards directly with other collectors.', 'Hozz létre kártya-kártyáért cserehirdetést, hogy közvetlenül cserélhess más gyűjtőkkel.')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsCreateTradeOpen(true)}
                    className="px-5 py-2.5 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-zinc-950 cursor-pointer transition"
                  >
                    {t('+ Create Your First Trade', '+ Hozd létre az első cserédet')}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sellerTrades.map((tr) => (
                    <div
                      key={tr.id}
                      className="p-4 rounded-2xl border flex flex-col justify-between gap-3"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                            tr.status === 'on_hold'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : tr.status === 'completed'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                          }`}
                        >
                          {tr.status === 'on_hold' ? t('On Hold', 'Foglalva') : tr.status === 'completed' ? t('Completed', 'Teljesítve') : t('Open', 'Nyitott')}
                        </span>
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                          {tr.likes_count || 0} {t('likes', 'kedvelés')}
                        </span>
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-2.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                        <div className="text-center min-w-0">
                          <div className="text-[10px] font-black uppercase text-emerald-400 mb-1">{t('Offering', 'Kínál')}</div>
                          {tr.offered_card?.image_path && (
                            <img src={getCardImageUrl(tr.offered_card.image_path)} alt="" className="w-14 h-20 object-contain mx-auto mb-1 rounded" />
                          )}
                          <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {tr.offered_card?.name || t('Card', 'Kártya')}
                          </div>
                        </div>
                        <div className="text-xs font-black" style={{ color: 'var(--text-tertiary)' }}>⇄</div>
                        <div className="text-center min-w-0">
                          <div className="text-[10px] font-black uppercase text-amber-400 mb-1">{t('Wanted', 'Keres')}</div>
                          {tr.wanted_card?.image_path && (
                            <img src={getCardImageUrl(tr.wanted_card.image_path)} alt="" className="w-14 h-20 object-contain mx-auto mb-1 rounded" />
                          )}
                          <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                            {tr.wanted_card?.name || t('Card', 'Kártya')}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        {tr.status === 'on_hold' && (
                          <button
                            type="button"
                            onClick={() => handleTradeStatusUpdate(tr.id, 'open')}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                          >
                            {t('Release Hold', 'Foglalás feloldása')}
                          </button>
                        )}
                        {tr.status !== 'completed' && (
                          <button
                            type="button"
                            onClick={() => handleTradeStatusUpdate(tr.id, 'completed')}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-pointer"
                          >
                            {t('Mark Completed', 'Teljesítettnek jelöl')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteTrade(tr.id)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 cursor-pointer"
                        >
                          {t('Remove', 'Eltávolítás')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── SUB-TAB: BULK ────────────────────────────────────────── */}
          {listingsSubTab === 'bulk' && (
            <div className="space-y-4">
              {loadingBulk ? (
                <div className="p-12 text-center rounded-2xl border animate-pulse" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <div className="text-sm font-bold text-[var(--text-tertiary)]">{t('Loading bulk lots…', 'Bulk tételek betöltése…')}</div>
                </div>
              ) : sellerBulk.length === 0 ? (
                <div className="p-12 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {t('No bulk card lots listed', 'Nincsenek hirdetett bulk tételek')}
                  </div>
                  <p className="text-xs max-w-md mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Upload a photo and set an exact or approximate card count to sell bulk lots easily.', 'Tölts fel egy fotót és adj meg egy pontos vagy becsült darabszámot a tételek egyszerű eladásához.')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsCreateBulkOpen(true)}
                    className="px-5 py-2.5 rounded-xl text-xs font-black bg-indigo-500 hover:bg-indigo-400 text-white cursor-pointer transition"
                  >
                    {t('+ List Your First Bulk Lot', '+ Hirdesd meg az első bulk tételedet')}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sellerBulk.map((b) => {
                    const countText = b.exact_card_count
                      ? t(`${b.exact_card_count} Cards (Exact)`, `${b.exact_card_count} kártya (pontos)`)
                      : t(`~${b.approx_card_count || 0} Cards (Approx)`, `~${b.approx_card_count || 0} kártya (kb.)`);
                    return (
                      <div
                        key={b.id}
                        className="p-4 rounded-2xl border flex flex-col justify-between gap-3"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex gap-3">
                          {b.images?.[0] && (
                            <img src={b.images[0]} alt={b.title} className="w-20 h-20 rounded-xl object-cover shrink-0 border" style={{ borderColor: 'var(--border)' }} />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                                {countText}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                                {b.status === 'in_stock' ? t('In Stock', 'Készleten') : b.status === 'on_hold' ? t('On Hold', 'Foglalva') : b.status === 'sold' ? t('Sold', 'Eladva') : b.status.replace('_', ' ')}
                              </span>
                            </div>
                            <h4 className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>{b.title}</h4>
                            <div className="text-sm font-black text-emerald-400 mt-1">{formatPrice(b.price_huf)}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                          {b.status === 'on_hold' && (
                            <button
                              type="button"
                              onClick={() => handleBulkStatusUpdate(b.id, 'in_stock')}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                            >
                              {t('Release Hold', 'Foglalás feloldása')}
                            </button>
                          )}
                          {b.status !== 'sold' && (
                            <button
                              type="button"
                              onClick={() => handleBulkStatusUpdate(b.id, 'sold')}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-pointer"
                            >
                              {t('Mark Sold', 'Eladottnak jelöl')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteBulk(b.id)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 cursor-pointer"
                          >
                            {t('Remove', 'Eltávolítás')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── SUB-TAB: AUCTIONS ────────────────────────────────────── */}
          {listingsSubTab === 'auctions' && (
            <div className="space-y-4">
              {loadingAuctions ? (
                <div className="p-12 text-center rounded-2xl border animate-pulse" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <div className="text-sm font-bold text-[var(--text-tertiary)]">{t('Loading auctions…', 'Aukciók betöltése…')}</div>
                </div>
              ) : sellerAuctions.length === 0 ? (
                <div className="p-12 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {t('No auctions created yet', 'Még nincsenek aukciók')}
                  </div>
                  <p className="text-xs max-w-md mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Start an auction with a base price, bid steps, and automatic minute extension rules on every bid.', 'Indíts aukciót kikiáltási árral, licitlépcsővel és licitenkénti automatikus perces hosszabbítással.')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsCreateAuctionOpen(true)}
                    className="px-5 py-2.5 rounded-xl text-xs font-black bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer transition"
                  >
                    {t('+ Start Your First Auction', '+ Indítsd el az első aukciódat')}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sellerAuctions.map((auc) => {
                    const img = auc.images?.[0] || (auc.card?.image_path ? getCardImageUrl(auc.card.image_path) : '');
                    const countdown = formatAuctionCountdown(auc.ends_at, Date.now());
                    const hasWinner = Boolean(auc.highest_bidder_id && (auc.bid_count > 0 || auc.current_bid_huf));
                    return (
                      <div
                        key={auc.id}
                        className="p-4 rounded-2xl border flex flex-col justify-between gap-3"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex gap-3">
                          {img && (
                            <img src={img} alt={auc.title} className="w-16 h-22 object-contain rounded-lg bg-zinc-900 p-1 shrink-0 border" style={{ borderColor: 'var(--border)' }} />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                {auc.status === 'active' ? countdown.text : auc.status === 'ended' ? t('Ended', 'Lezárult') : auc.status === 'cancelled' ? t('Cancelled', 'Törölve') : auc.status}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold border" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                                +{auc.extension_minutes}{t('m/bid', ' perc/licit')}
                              </span>
                            </div>
                            <h4 className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>{auc.title}</h4>
                            <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                              {t('Base:', 'Induló:')} <strong>{formatPrice(auc.base_price_huf)}</strong> · {t('Step:', 'Lépcső:')} <strong>+{formatPrice(auc.bid_step_huf)}</strong>
                            </div>
                            <div className="text-xs font-black text-amber-400 mt-0.5">
                              {auc.bid_count > 0
                                ? t(
                                    `Current Bid: ${formatPrice(auc.current_bid_huf || auc.base_price_huf)} (${auc.bid_count} bids — ${auc.highest_bidder_name})`,
                                    `Jelenlegi licit: ${formatPrice(auc.current_bid_huf || auc.base_price_huf)} (${auc.bid_count} licit — ${auc.highest_bidder_name})`
                                  )
                                : t('No bids yet', 'Még nincs licit')}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t flex-wrap" style={{ borderColor: 'var(--border-subtle)' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedAuctionModal(auc)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                          >
                            {t('View Bids', 'Licitek megtekintése')}
                          </button>
                          {auc.conversation_id && (
                            <a
                              href={`/messages?conversation_id=${auc.conversation_id}`}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            >
                              {t('Message Winner', 'Üzenet a nyertesnek')}
                            </a>
                          )}
                          {(auc.status === 'active' || auc.status === 'ended') && (
                            <button
                              type="button"
                              onClick={() => setCancellingAuctionTarget(auc)}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 cursor-pointer"
                            >
                              {hasWinner ? t('Cancel (1-Star Penalty)', 'Törlés (1 csillagos büntetés)') : t('Cancel Auction', 'Aukció törlése')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: HOLDS & INQUIRIES ─────────── */}
      {activeTab === 'holds' && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
                  {t('Incoming Card Holds & Handover', 'Beérkező foglalások és átadás')}
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Buyers request cards on hold here with their preferred handover method (Foxpost, Packeta, Personal, etc.). Coordinate details, hold the card, and confirm the sale once completed.', 'A vevők itt kérhetik a kártyák foglalását a kívánt átadási móddal (Foxpost, Packeta, személyes, stb.). Egyeztesd a részleteket, foglald le a kártyát, és a teljesítés után igazold vissza az eladást.')}
                </p>
              </div>
              <div className="text-xs font-bold shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                {activeHoldRequests.length} {t('awaiting action', 'intézkedésre vár')}
              </div>
            </div>
          </div>

          {loadingHolds ? (
            <div className="p-12 text-center rounded-2xl border animate-pulse" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="text-sm font-bold text-[var(--text-tertiary)]">{t('Loading hold requests…', 'Foglalások betöltése…')}</div>
            </div>
          ) : activeHoldRequests.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border shadow-sm" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="w-12 h-12 mx-auto mb-2 flex items-center justify-center text-[var(--text-muted)]">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="2" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
                </svg>
              </div>
              <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {t('No open hold requests', 'Nincs nyitott foglalás')}
              </div>
              <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                {t('When an interested collector requests a hold on one of your cards, the inquiry and contact details will appear here.', 'Amikor egy érdeklődő gyűjtő foglalást kér valamelyik kártyádra, itt jelenik meg a kérés és az elérhetősége.')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeHoldRequests.map((req) => {
                const cartItems = Array.isArray(req.items) && req.items.length > 0 ? req.items : null;
                const isCart = Boolean(cartItems && cartItems.length > 1);
                const cardName = isCart ? t(`${cartItems!.length} cards`, `${cartItems!.length} kártya`) : (req.card_name || t('Card item', 'Kártya tétel'));
                const cardNumber = isCart ? '' : (req.card_number || '');
                const cardRarity = '';
                const cardImage = req.image_path;
                const priceHuf = isCart
                  ? cartItems!.reduce((sum: number, it: any) => sum + (it.price_huf || 0) * (it.quantity || 1), 0)
                  : req.price_huf;
                const isHeld = req.status === 'held';
                const isHandedOver = req.status === 'handed_over';
                const isBuyerReceived = req.status === 'buyer_received';
                const isPending = req.status === 'pending';
                const sellerActions = allowedHoldActions(req.status, 'seller', req.updated_at || req.created_at);
                const isConfirmed = req.status === 'confirmed' || req.status === 'completed';
                const isCancelled = req.status === 'cancelled' || req.status === 'rejected';

                const handoverBadge = (() => {
                  switch (req.preferred_handover || req.handover_method) {
                    case 'foxpost': return { label: t('Foxpost parcel locker', 'Foxpost csomagautomata'), color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
                    case 'packeta': return { label: t('Packeta pickup point', 'Packeta átvevőhely'), color: 'text-[var(--negative)] bg-red-500/10 border-red-500/30' };
                    case 'pickup':
                    case 'personal': return { label: t('Personal pickup', 'Személyes átvétel'), color: 'text-[var(--positive)] bg-emerald-500/10 border-emerald-500/30' };
                    case 'posta':
                    case 'post': return { label: t('Post', 'Posta'), color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' };
                    default: return { label: t('Other arrangement', 'Egyéb megállapodás'), color: 'text-[var(--text-tertiary)] bg-[var(--bg-raised)] border-[var(--border)]' };
                  }
                })();

                return (
                  <div
                    key={req.id}
                    className={`p-5 rounded-2xl border transition-all ${
                      isHeld || isHandedOver || isBuyerReceived
                        ? 'border-amber-500/40 bg-amber-950/10'
                        : isPending
                        ? 'border-indigo-500/30 bg-indigo-950/10'
                        : isConfirmed
                        ? 'border-emerald-500/30 bg-emerald-950/10'
                        : 'border-[var(--border)] bg-[var(--bg-surface)]/30 opacity-70'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Left: Card thumbnail + basic info */}
                      <div className="flex items-start gap-3.5">
                        <div className="w-14 h-20 rounded-xl bg-[var(--bg-raised)] shrink-0 overflow-hidden border border-[var(--border)] relative">
                          {cardImage ? (
                            <img {...cardThumbProps(cardImage, 'avatar')} alt={cardName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--text-muted)]">TCG</div>
                          )}
                          {req.inventory?.is_foil && (
                            <span className="absolute bottom-0 right-0 bg-amber-500 text-black text-[9px] font-black px-1 rounded-tl shadow">F</span>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
                              {cardName}
                            </span>
                            {/* Status badge */}
                            {isPending && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-[var(--text-accent)] border border-amber-500/40 flex items-center gap-1">
                                <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                                </svg>
                                <span>{t('Pending', 'Függőben')}</span>
                              </span>
                            )}
                            {isHeld && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center gap-1">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <line x1="12" y1="2" x2="12" y2="22" /><line x1="2" y1="12" x2="22" y2="12" />
                                </svg>
                                <span>{t('ON HOLD', 'FOGLALVA')}</span>
                              </span>
                            )}
                            {isHandedOver && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-sky-500/15 text-sky-300 border border-sky-500/40 flex items-center gap-1">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
                                </svg>
                                <span>{t('HANDED OVER', 'ÁTADVA / FELADVA')}</span>
                              </span>
                            )}
                            {isBuyerReceived && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-[var(--positive)] border border-emerald-500/40 flex items-center gap-1">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>{t('BUYER RECEIVED — AWAITING OK', 'VEVŐ ÁTVETTE — JÓVÁHAGYÁSRA VÁR')}</span>
                              </span>
                            )}
                            {isConfirmed && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-[var(--positive)] border border-emerald-500/40 flex items-center gap-1">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>{t('SOLD & CONFIRMED', 'ELADVA ÉS MEGERŐSÍTVE')}</span>
                              </span>
                            )}
                            {isCancelled && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-raised)] text-[var(--text-tertiary)] border border-[var(--border)]">
                                {t('Cancelled / Closed', 'Törölve / Lezárva')}
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-[var(--text-tertiary)] mt-1 flex items-center gap-2 flex-wrap">
                            {cardNumber && <span className="font-mono">{cardNumber}</span>}
                            {cardRarity && <span>• <span className="text-indigo-300 font-semibold">{cardRarity}</span></span>}
                            {req.inventory?.condition && <span>• <span className="text-[var(--text-secondary)]">{req.inventory.condition}</span></span>}
                            {priceHuf && (
                              <span className="text-[var(--positive)] font-black font-mono ml-1">
                                {formatPrice(priceHuf)}
                                {Number(req.shipping_huf) > 0 && (
                                  <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}> + {formatPrice(Number(req.shipping_huf))} {t('shipping', 'szállítás')}</span>
                                )}
                              </span>
                            )}
                          </div>

                          {isCart && (
                            <div className="mt-1.5 space-y-0.5">
                              {cartItems!.map((it: any) => (
                                <div key={it.inventory_id} className="text-[11px] text-[var(--text-tertiary)]">
                                  {it.quantity}× {it.card_name}{it.is_foil ? t(' (Foil)', ' (Foil)') : ''}{' '}
                                  <span className="text-[var(--text-muted)] font-mono">— {(it.price_huf * it.quantity).toLocaleString()} Ft</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {req.tracking_number && (
                            <div className="mt-1 flex items-center gap-1.5 text-xs font-mono font-semibold" style={{ color: 'var(--text-accent)' }}>
                              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <rect x="1" y="3" width="15" height="13" />
                                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                                <circle cx="5.5" cy="18.5" r="2.5" />
                                <circle cx="18.5" cy="18.5" r="2.5" />
                              </svg>
                              <span>{t('Tracking:', 'Nyomkövetés:')} {req.tracking_number}</span>
                            </div>
                          )}

                          <div className="text-[11px] text-[var(--text-muted)] mt-1">
                            {t('Requested at:', 'Kérve ekkor:')}{' '}
                            {new Date(req.created_at).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 flex-wrap self-start lg:self-center">
                        <a
                          href={`/messages?hold_request_id=${req.id}`}
                          className="px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border border-[var(--border)] flex items-center gap-1.5"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                          <span>{t('Message', 'Üzenet')}</span>
                        </a>
                        {(isHeld || isHandedOver) && (
                          <button
                            type="button"
                            onClick={() => {
                              const entered = window.prompt(t('Enter tracking number:', 'Add meg a nyomkövetési számot:'), req.tracking_number || '');
                              if (entered !== null) {
                                handleHoldAction(req.id, 'update_tracking' as any, entered.trim());
                              }
                            }}
                            disabled={processingHoldId === req.id}
                            className="px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border border-[var(--border)] flex items-center gap-1.5 disabled:opacity-50"
                            title={t('Add or edit package tracking number', 'Csomag nyomkövetési szám hozzáadása vagy szerkesztése')}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <rect x="1" y="3" width="15" height="13" />
                              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                              <circle cx="5.5" cy="18.5" r="2.5" />
                              <circle cx="18.5" cy="18.5" r="2.5" />
                            </svg>
                            <span>{req.tracking_number ? t('Edit tracking', 'Nyomkövetés szerkesztése') : t('Add tracking', 'Nyomkövetés hozzáadása')}</span>
                          </button>
                        )}
                        {isPending && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleHoldAction(req.id, 'hold')}
                              disabled={processingHoldId === req.id}
                              className="px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-md flex items-center gap-1.5 disabled:opacity-50"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <line x1="12" y1="2" x2="12" y2="22" /><line x1="2" y1="12" x2="22" y2="12" />
                              </svg>
                              <span>{t('Approve Hold', 'Foglalás jóváhagyása')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleHoldAction(req.id, 'reject')}
                              disabled={processingHoldId === req.id}
                              className="px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] border border-[var(--border)] disabled:opacity-50"
                            >
                              <span>{t('Reject', 'Elutasítás')}</span>
                            </button>
                          </>
                        )}

                        {(isHeld || isHandedOver || isBuyerReceived) && (
                          <>
                            {sellerActions.includes('mark_handed_over') && (
                              <button
                                type="button"
                                onClick={() => handleHoldAction(req.id, 'mark_handed_over')}
                                disabled={processingHoldId === req.id}
                                className="px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 disabled:opacity-50"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
                                </svg>
                                <span>{t('Mark handed over', 'Megjelölés átadottként')}</span>
                              </button>
                            )}
                            {isHandedOver && !sellerActions.includes('confirm_sale') && (
                              <span className="text-[11px] font-semibold px-3 py-2 rounded-xl border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)', background: 'var(--bg-raised)' }}>
                                {t('Waiting for buyer to confirm (auto-completes after 3 days:', 'Várakozás a vevő megerősítésére (3 nap múlva automatikusan lezárul:')} {sellerCanCompleteFrom(req.updated_at || req.created_at).toLocaleDateString()})
                              </span>
                            )}
                            {isBuyerReceived && !sellerActions.includes('confirm_sale') && (
                              <span className="text-[11px] font-semibold px-3 py-2 rounded-xl border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)', background: 'var(--bg-raised)' }}>
                                {t('Buyer marked received - please confirm or deny (auto-completes on', 'A vevő átvette - kérjük igazold vissza vagy tagadd meg (automatikusan lezárul:')} {sellerCanCompleteFrom(req.updated_at || req.created_at).toLocaleDateString()})
                              </span>
                            )}
                            {sellerActions.includes('confirm_sale') && (
                              <button
                                type="button"
                                onClick={() => handleHoldAction(req.id, 'confirm_sale')}
                                disabled={processingHoldId === req.id}
                                className="px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 disabled:opacity-50"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>{isBuyerReceived ? t('OK & Complete sale', 'Rendben és eladás lezárása') : t('Complete sale', 'Eladás lezárása')}</span>
                              </button>
                            )}
                            {sellerActions.includes('deny') && (
                              <button
                                type="button"
                                onClick={() => handleHoldAction(req.id, 'deny')}
                                disabled={processingHoldId === req.id}
                                className="px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 disabled:opacity-50 flex items-center gap-1.5"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                                <span>{t('Deny sale', 'Eladás megtagadása')}</span>
                              </button>
                            )}
                            {sellerActions.includes('release') && (
                              <button
                                type="button"
                                onClick={() => handleHoldAction(req.id, 'release')}
                                disabled={processingHoldId === req.id}
                                className="px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-amber-500/10 hover:bg-amber-500/20 text-[var(--text-accent)] border border-amber-500/30 disabled:opacity-50"
                              >
                                <span>{isHandedOver ? t('Cancel sale', 'Eladás visszavonása') : t('Release Hold', 'Foglalás feloldása')}</span>
                              </button>
                            )}
                          </>
                        )}

                        {isConfirmed && (
                          <div className="text-xs font-black text-[var(--positive)] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>{t('Sale Confirmed & Completed', 'Eladás megerősítve és befejezve')}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Middle details: Buyer info & Handover */}
                    <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-2 gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
                      {/* Buyer Contact Details */}
                      <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--text-tertiary)]">
                          {t('Buyer Contact', 'Vevő elérhetősége')}
                        </div>
                        <div className="text-xs font-bold text-[var(--text-secondary)]">
                          {req.buyer_id ? (
                            <a href={`/user?id=${req.buyer_id}`} className="hover:underline">
                              {req.buyer_name}
                            </a>
                          ) : (
                            req.buyer_name
                          )}
                        </div>
                        <BuyerTrustLine buyerId={req.buyer_id} />
                        <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-2 flex-wrap">
                          <a href={`mailto:${req.buyer_email}`} className="text-indigo-300 hover:underline flex items-center gap-1">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                            </svg>
                            <span>{req.buyer_email}</span>
                          </a>
                          {req.buyer_phone && (
                            <a href={`tel:${req.buyer_phone}`} className="text-[var(--positive)] hover:underline flex items-center gap-1">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                              </svg>
                              <span>{req.buyer_phone}</span>
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Handover Method & Note */}
                      <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-wider text-[var(--text-tertiary)]">
                          {t('Requested Handover', 'Kért átvétel')}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${handoverBadge.color}`}>
                            {handoverBadge.label}
                          </span>
                          {(req.handover_details || req.handover_location) && (
                            // Delivery details arrive one fact per line (recipient, phone, locker...).
                            <span className="basis-full text-xs text-[var(--text-secondary)] font-medium whitespace-pre-line">
                              {req.handover_details || req.handover_location}
                            </span>
                          )}
                        </div>
                        {(req.message || req.buyer_note) && (
                          <div className="text-xs text-[var(--text-tertiary)] italic pt-1">
                            "{req.message || req.buyer_note}"
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: ANALYTICS & POST CLICKS ─────────────────────────── */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* ─── KPI Row: Moved to Stats page for a focused overview ─── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Net Sales & Volume */}
            <div className="relative p-4 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <InfoTip title={t('Net Sales & Volume', 'Nettó eladás és volumen')} align="left">
                <TipTerm term={t('Net sales', 'Nettó eladás')}>{t('is the combined value of all your orders, with cancelled orders left out. Nothing else is subtracted: no fees or refunds are taken off.', 'a megrendeléseid összegzett értéke a törölt rendelések nélkül. Levonások és jutalékok nélkül.')}</TipTerm>
                <TipTerm term={t('Orders', 'Rendelések')}>{t('counts every order that is not cancelled, including ones still in progress.', 'minden nem törölt rendelés száma, beleértve a folyamatban lévőket is.')}</TipTerm>
                <TipTerm term={t('Cards sold', 'Eladott kártyák')}>{t('adds up the quantity on those orders.', 'az eladott kártyák darabszáma.')}</TipTerm>
                <TipTerm term={t('Avg order', 'Átlagos rendelés')}>{t('is net sales divided by the number of orders.', 'a nettó eladás osztva a rendelések számával.')}</TipTerm>
              </InfoTip>
              <div className="flex items-center gap-1.5 mb-1.5 pr-6">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                  </svg>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Net Sales & Volume', 'Nettó eladás és volumen')}
                </span>
              </div>
              <div className="text-lg sm:text-xl font-black text-[var(--positive)] truncate">
                {formatPrice(totalRevenueHuf)} <span className="text-xs font-normal text-[var(--text-tertiary)]">({completedSalesCount} {t('orders', 'rendelés')})</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {itemsSold} {t('cards sold', 'eladott kártya')} · {t('Avg order:', 'Átlagos rendelés:')} {formatPrice(avgOrderValueHuf)}
              </div>
            </div>

            {/* 2. Active Inventory */}
            <div className="relative p-4 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <InfoTip title={t('Active Inventory', 'Aktív készlet')} align="right">
                <TipTerm term={t('Listings', 'Hirdetések')}>{t('is how many listings you have on sale right now: everything you have listed that is not sold yet, including cards on hold.', 'hány hirdetésed van eladó jelenleg: minden nem eladott tétel, beleértve a foglalásokat is.')}</TipTerm>
                <TipTerm term={t('Listed value', 'Hirdetett érték')}>{t("is each listing's price times its quantity, added up. It is what you would take in if everything sold at your asking prices.", 'az egyes hirdetések ára szorozva a darabszámmal, összeadva.')}</TipTerm>
              </InfoTip>
              <div className="flex items-center gap-1.5 mb-1.5 pr-6">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: 'rgba(129, 140, 248, 0.15)', color: '#818cf8' }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41L11 3.83V3H3v8l.83.83L13.41 20.6a2 2 0 002.83 0l4.35-4.35a2 2 0 000-2.84z" />
                    <circle cx="6.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Active Inventory', 'Aktív készlet')}
                </span>
              </div>
              <div className="text-lg sm:text-xl font-black text-indigo-400 truncate">
                {activeListings.length} <span className="text-xs font-normal text-[var(--text-tertiary)]">{activeListings.length === 1 ? t('listing', 'hirdetés') : t('listings', 'hirdetés')}</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('Listed Value:', 'Hirdetett érték:')} {formatPrice(totalListedValueHuf)}
              </div>
            </div>

            {/* 3. Platform Price Health */}
            <div className="relative p-4 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <InfoTip title={t('Platform Price Health', 'Platform áregészség')} align="left">
                <span className="block">{t("The share of your active listings that are the cheapest, or tied for cheapest, of any seller's listing for that exact card. Foil and non-foil are compared separately.", 'Azon aktív hirdetéseid aránya, amelyek a legolcsóbbak vagy holtversenyben a legolcsóbbak a piacon ugyanarra a kártyára. A foil és normál lapok külön mérve.')}</span>
                <span className="block">{t('100% means nobody undercuts you. Lower means other sellers list the same card for less; the line below the number says how many.', 'A 100% azt jelenti, hogy senki sem hirdet olcsóbban. Alacsonyabb érték esetén más eladók olcsóbban hirdetik ugyanazt a kártyát; a szám alatti sor jelzi, hogy hány kártyánál.')}</span>
              </InfoTip>
              <div className="flex items-center gap-1.5 mb-1.5 pr-6">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: undercutListings.length > 0 ? 'rgba(251, 191, 36, 0.15)' : 'rgba(52, 211, 153, 0.15)', color: undercutListings.length > 0 ? '#fbbf24' : '#34d399' }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20V10M18 20V4M6 20v-4" />
                  </svg>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Platform Price Health', 'Platform áregészség')}
                </span>
              </div>
              <div className={`text-lg sm:text-xl font-black truncate ${undercutListings.length > 0 ? 'text-amber-400' : 'text-[var(--positive)]'}`}>
                {priceHealthPct}% <span className="text-xs font-normal text-[var(--text-tertiary)]">{t('Lowest Price', 'Legalacsonyabb ár')}</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {activeListings.length === 0
                  ? t('No active listings yet', 'Még nincs aktív hirdetés')
                  : undercutListings.length > 0
                    ? t(`${undercutListings.length} card${undercutListings.length === 1 ? '' : 's'} undercut by other sellers`, `${undercutListings.length} kártyánál más eladók olcsóbbak`)
                    : t("You're the lowest (or tied) on everything!", "Minden kártyánál a legolcsóbb (vagy holtversenyben vezető) vagy!")}
              </div>
            </div>

            {/* 4. Pipeline & Action Items */}
            <div className="relative p-4 rounded-xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <InfoTip title={t('Pipeline & Action Items', 'Folyamatban lévő ügyek')} align="right">
                <span className="block">{t('Buyer requests that are waiting on you.', 'Rád váró vásárlói kérések.')}</span>
                <TipTerm term={t('Pending', 'Függőben')}>{t('requests are buyers who asked to reserve a card and are waiting for you to accept or reject.', 'olyan vevők kérései, akik foglalást kértek és a jóváhagyásodra vagy elutasításodra várnak.')}</TipTerm>
                <TipTerm term={t('On hold', 'Foglalva')}>{t('are requests you accepted. The card stays reserved until you confirm the handover or release it.', 'jóváhagyott kérések. A kártya lefoglalva marad az átadás megerősítéséig vagy feloldásáig.')}</TipTerm>
                <span className="block">{t('Manage both on the Holds tab.', 'Kezeld mindkettőt a Foglalások fülön.')}</span>
              </InfoTip>
              <div className="flex items-center gap-1.5 mb-1.5 pr-6">
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: pendingOnlyCount > 0 ? 'rgba(244, 114, 182, 0.15)' : 'rgba(129, 140, 248, 0.15)', color: pendingOnlyCount > 0 ? '#f472b6' : '#818cf8' }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Pipeline & Action Items', 'Folyamatban lévő ügyek')}
                </span>
              </div>
              <div className={`text-lg sm:text-xl font-black truncate ${pendingOnlyCount > 0 ? 'text-pink-400' : 'text-indigo-300'}`}>
                {pendingOnlyCount} <span className="text-xs font-normal text-[var(--text-tertiary)]">{t('Pending', 'Függőben')}</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {t(`${pendingOnlyCount} request${pendingOnlyCount === 1 ? '' : 's'} to review · ${heldOnlyCount} on hold`, `${pendingOnlyCount} áttekintendő kérés · ${heldOnlyCount} foglalva`)}
              </div>
            </div>
          </div>

          {/* ─── Engagement Summary Strip ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{t('Total Views', 'Összes megtekintés')}</div>
                <div className="text-base font-black text-cyan-400 mt-0.5">{statsSummary.views.toLocaleString()}</div>
              </div>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(34, 211, 238, 0.12)', color: '#22d3ee' }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
            </div>
            <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{t('Total Clicks', 'Összes kattintás')}</div>
                <div className="text-base font-black text-pink-400 mt-0.5">{statsSummary.clicks.toLocaleString()}</div>
              </div>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(244, 114, 182, 0.12)', color: '#f472b6' }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                </svg>
              </span>
            </div>
            <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{t('Average CTR', 'Átlagos CTR')}</div>
                <div className="text-base font-black text-[var(--positive)] mt-0.5">{statsSummary.avgCtr}%</div>
              </div>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(52, 211, 153, 0.12)', color: '#34d399' }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </span>
            </div>
            <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{t('High Demand Cards', 'Keresett kártyák')}</div>
                <div className="text-base font-black text-amber-400 mt-0.5">{statsSummary.highDemand}</div>
              </div>
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(251, 191, 36, 0.12)', color: '#fbbf24' }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </span>
            </div>
          </div>

          <div className="p-6 rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-black mb-1" style={{ color: 'var(--text-primary)' }}>
                  {t('Listing Performance & Price Competitiveness', 'Hirdetési teljesítmény és árversenyképesség')}
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Engagement per listing, and how your price compares to the lowest active price for the same card elsewhere on the platform.', 'A hirdetések elérése, és hogy hogyan viszonyul az árad a platform legalacsonyabb áraihoz.')}
                </p>
              </div>
              {undercutListings.length > 0 && (
                <button
                  type="button"
                  disabled={matchingAllBusy}
                  onClick={handleMatchAllUndercut}
                  className="px-3.5 py-2 rounded-xl text-xs font-black shrink-0 transition cursor-pointer border hover:brightness-110 active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                  title={t('Update all undercut listings to match the lowest active price on the site', 'Minden alulígért hirdetés frissítése az oldal legalacsonyabb árához')}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
                  </svg>
                  <span>{matchingAllBusy ? t('Matching All...', 'Igazítás folyamatban...') : t(`Match Lowest on All (${undercutListings.length})`, `Legkisebb árra állítás mindnél (${undercutListings.length})`)}</span>
                </button>
              )}
            </div>

            {/* Filter pills & Sort bar */}
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  { id: 'all' as const, label: t('All Active', 'Összes aktív'), count: activeListings.length },
                  { id: 'undercut' as const, label: t('Undercut', 'Alulígért'), count: undercutListings.length },
                  { id: 'demand' as const, label: t('High Demand', 'Nagy kereslet'), count: statsSummary.highDemand },
                  { id: 'stale' as const, label: t('Stale (30d+)', 'Régi (30+ nap)'), count: statsSummary.stale },
                ]).map((f) => {
                  const active = statsFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setStatsFilter(f.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition inline-flex items-center gap-1.5"
                      style={{
                        background: active ? 'var(--accent-muted)' : 'var(--bg-surface-2)',
                        borderColor: active ? 'var(--accent-border)' : 'var(--border)',
                        color: active ? 'var(--text-accent)' : 'var(--text-secondary)',
                      }}
                    >
                      <span>{f.label}</span>
                      <span className="text-[10px] opacity-80">({f.count})</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>{t('Sort by:', 'Rendezés:')}</span>
                <select
                  value={statsSort}
                  onChange={(e) => setStatsSort(e.target.value as any)}
                  className="h-8 px-2.5 rounded-lg text-xs font-semibold border outline-none cursor-pointer"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <option value="views">{t('Most Views', 'Legtöbb megtekintés')}</option>
                  <option value="clicks">{t('Most Clicks', 'Legtöbb kattintás')}</option>
                  <option value="undercut">{t('Largest Undercut Gap', 'Legnagyobb alulígérés')}</option>
                  <option value="price">{t('Highest Price', 'Legmagasabb ár')}</option>
                </select>
              </div>
            </div>

            <div ref={statsTopRef} className="overflow-x-auto scroll-mt-24">
              {/* whitespace-nowrap: the table scrolls sideways on a phone anyway, so cells stay on
                  one line - "In Stock" used to break into "In / Stock". */}
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                    <th className="py-2.5 px-3">{t('Card', 'Kártya')}</th>
                    <th className="py-2.5 px-3">{t('Your Price', 'A te árad')}</th>
                    <th className="py-2.5 px-3">{t('Lowest on Site', 'Legalacsonyabb az oldalon')}</th>
                    <th className="py-2.5 px-3 text-center">
                      <span className="inline-flex items-center gap-1 justify-center">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>{t('Views', 'Megtekintés')}</span>
                      </span>
                    </th>
                    <th className="py-2.5 px-3 text-center">
                      <span className="inline-flex items-center gap-1 justify-center">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                        </svg>
                        <span>{t('Clicks', 'Kattintás')}</span>
                      </span>
                    </th>
                    <th className="py-2.5 px-3 text-center">{t('CTR', 'CTR')}</th>
                    <th className="py-2.5 px-3 text-right">{t('Status', 'Állapot')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {activeListings.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {t('No active listings yet — list a card to start tracking views and clicks.', 'Még nincsenek aktív hirdetések — adj fel egy hirdetést a megtekintések és kattintások méréséhez.')}
                      </td>
                    </tr>
                  ) : (
                    statsPage.pageItems
                      .map((item) => {
                        const views = item.views || 0;
                        const clicks = item.clicks || 0;
                        const ctr = views > 0 ? ((clicks / views) * 100).toFixed(1) : '0.0';
                        const displayStatus = item.status === 'On Hold' || item.status === 'Reserved' ? 'On Hold' : 'In Stock';
                        const lowest = getPlatformLowest(item);
                        const isUndercut = lowest !== null && item.price_huf > lowest;
                        const daysListed = item.created_at ? (Date.now() - new Date(item.created_at).getTime()) / 86400000 : 0;
                        const isStale = views === 0 && clicks === 0 && daysListed > 30;
                        const demandCount = demandByCard[item.card_id] || 0;
                        const isHighDemand = demandCount >= 5;
                        return (
                          <tr key={item.inventory_id} className="hover:bg-white/[0.02]">
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-11 rounded bg-[var(--bg-raised)] shrink-0 overflow-hidden border border-[var(--border)]">
                                  {item.image_path ? (
                                    <img {...cardThumbProps(item.image_path, 'avatar')} alt={item.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[8px] text-[var(--text-muted)]">TCG</div>
                                  )}
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold truncate max-w-xs" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                                    {isHighDemand && (
                                      <span
                                        className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full border text-[var(--text-accent)] bg-orange-950/40 border-orange-500/40"
                                        title={t(`Searched ${demandCount} times platform-wide in the last 7 days`, `Az elmúlt 7 napban ${demandCount} alkalommal keresték a platformon`)}
                                      >
                                        {t('High Demand', 'Keresett')}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-[var(--text-tertiary)] font-mono">{item.card_number} • {item.rarity}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-[var(--positive)]">
                              {item.price_huf ? formatPrice(item.price_huf) : 'N/A'}
                            </td>
                            <td className="py-3 px-3 font-mono">
                              {lowest === null ? (
                                <span className="text-[var(--text-muted)]">—</span>
                              ) : isUndercut ? (
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[var(--text-accent)]">{formatPrice(lowest)}</span>
                                  <button
                                    type="button"
                                    disabled={matchingLowestId === item.inventory_id || matchingAllBusy}
                                    onClick={() => handleMatchLowest(item, lowest)}
                                    className="px-2 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer hover:brightness-110 active:scale-95 disabled:opacity-50"
                                    style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                                    title={t(`Update your price from ${formatPrice(item.price_huf)} to ${formatPrice(lowest)}`, `Ár módosítása erről: ${formatPrice(item.price_huf)} erre: ${formatPrice(lowest)}`)}
                                  >
                                    {matchingLowestId === item.inventory_id ? t('Matching...', 'Módosítás...') : t('Match lowest', 'Legolcsóbbhoz igazít')}
                                  </button>
                                </div>
                              ) : (
                                <span className="font-bold text-[var(--text-secondary)]">
                                  {formatPrice(lowest)} <span className="text-[10px] font-normal text-[var(--positive)]">({t('Lowest', 'Legolcsóbb')})</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-mono font-bold text-cyan-400">
                              {views}
                            </td>
                            <td className="py-3 px-3 text-center font-mono font-bold text-pink-400">
                              {clicks}
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                Number(ctr) >= 10 ? 'bg-emerald-500/20 text-[var(--positive)]' : 'bg-[var(--bg-raised)] text-[var(--text-secondary)]'
                              }`}>
                                {ctr}%
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex flex-col items-end gap-1">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                    displayStatus === 'On Hold'
                                      ? 'text-[var(--text-accent)] bg-amber-950/40 border-amber-500/40'
                                      : 'text-[var(--positive)] bg-emerald-950/40 border-emerald-500/40'
                                  }`}
                                >
                                  {displayStatus === 'On Hold' ? t('On Hold', 'Foglalva') : t('In Stock', 'Készleten')}
                                </span>
                                {isUndercut ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-[var(--negative)] bg-rose-950/40 border-rose-500/40">
                                    {t('Undercut by', 'Alulígérve:')} {formatPrice(item.price_huf - (lowest as number))}
                                  </span>
                                ) : isStale ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-[var(--text-tertiary)] bg-[var(--bg-raised)]/60 border-[var(--border)]">
                                    {t('Stale', 'Inaktív')} ({Math.floor(daysListed)}{t('d', ' napja')})
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination state={statsPage} noun={t('listings', 'hirdetés')} scrollTargetRef={statsTopRef} />
          </div>
        </div>
      )}

      {/* ─── TAB 3: SALES HISTORY ───────────────────────────────────── */}
      {activeTab === 'sales' && (
        <div className="space-y-4">
          {loadingOrders ? (
            <div className="p-12 text-center rounded-2xl border animate-pulse" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="text-sm font-bold text-[var(--text-tertiary)]">{t('Loading sales…', 'Eladások betöltése…')}</div>
            </div>
          ) : sellerOrders.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border shadow-sm" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="w-12 h-12 mx-auto mb-2 flex items-center justify-center text-[var(--text-muted)]">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {t('No sales recorded yet', 'Még nincs rögzített eladás')}
              </div>
              <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                {t('When another collector purchases one of your listed cards, your order details and delivery info will appear here.', 'Amikor egy másik gyűjtő megvásárol egy általad hirdetett kártyát, itt jelennek meg a rendelés és a szállítás részletei.')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Sales Summary & Export Bar */}
              <div
                className="p-4 sm:p-5 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>{t('Sales History', 'Eladási előzmények')}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold border" style={{ background: 'var(--positive-muted)', color: 'var(--positive)', borderColor: 'var(--positive-border)' }}>
                      {sellerOrders.length} {t('orders', 'rendelés')}
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Total Sales Volume:', 'Összes eladási érték:')} <span className="font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>{formatPrice(totalRevenueHuf)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={handleExportSalesCsv}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer hover:brightness-110 active:scale-95 inline-flex items-center gap-1.5"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    title="Export all completed orders to CSV for spreadsheets"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    <span>{t('Export CSV', 'CSV exportálása')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportSalesJson}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer hover:brightness-110 active:scale-95 inline-flex items-center gap-1.5"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    title="Export complete order objects to JSON"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>{t('Export JSON', 'JSON exportálása')}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
              {sellerOrders.map((ord) => (
                <div
                  key={ord.order_number}
                  className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-mono font-black" style={{ color: 'var(--text-primary)' }}>
                        #{ord.order_number}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        ord.status === 'Delivered'
                          ? 'bg-emerald-500/20 text-[var(--positive)] border-emerald-500/40'
                          : ord.status === 'Cancelled'
                          ? 'bg-red-500/20 text-[var(--negative)] border-red-500/40'
                          : 'bg-amber-500/20 text-[var(--text-accent)] border-amber-500/40'
                      }`}>
                        {ord.status === 'Delivered' ? t('Delivered', 'Kézbesítve') : ord.status === 'Cancelled' ? t('Cancelled', 'Törölve') : ord.status}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {new Date(ord.created_at).toLocaleDateString('en-US')}
                      </span>
                    </div>

                    <div className="text-xs text-[var(--text-secondary)]">
                      {ord.items && ord.items.length > 0
                        ? ord.items.map(it => `${it.quantity}x ${it.card_name}`).join(', ')
                        : t('Card item', 'Kártya tétel')}
                    </div>

                    {ord.customer_info && (
                      <div className="text-[11px] text-[var(--text-muted)] mt-1">
                        {t('Buyer:', 'Vevő:')} {ord.user_id ? (
                          <a href={`/user?id=${ord.user_id}`} className="font-semibold hover:underline">{ord.customer_info.name || t('Customer', 'Vásárló')}</a>
                        ) : (ord.customer_info.name || ord.customer_info.email || t('Customer', 'Vásárló'))}
                      </div>
                    )}

                    {ord.status === 'Delivered' && ord.user_id && ord.user_id !== profile?.id && (
                      buyerRatingsByOrder[ord.order_number] ? (
                        <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          <Stars value={buyerRatingsByOrder[ord.order_number].rating} size={11} />
                          <span>{t('You rated this buyer', 'Értékelted ezt a vásárlót:')} {buyerRatingsByOrder[ord.order_number].rating.toFixed(1)}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRatingOrder(ord)}
                          className="mt-2 h-7 px-2.5 rounded-lg text-[11px] font-bold border cursor-pointer inline-flex items-center gap-1"
                          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                          {t('Rate buyer', 'Vásárló értékelése')}
                        </button>
                      )
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-base font-black text-[var(--positive)] font-mono">
                      {formatPrice(ord.total_price_huf ?? ord.total_huf ?? 0)}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      {ord.shipping_method || t('Standard Shipping', 'Normál szállítás')}
                    </div>
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 4: REVIEWS ─────────────────────────────────────────── */}
      {activeTab === 'reviews' && (
        <div className="space-y-4">
          {sellerReviews.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border shadow-sm" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="w-10 h-10 mx-auto mb-2 text-[var(--text-muted)]">
                <svg className="w-full h-full fill-current" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {t('No reviews received yet', 'Még nincs értékelésed')}
              </div>
              <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                {t('Once a buyer confirms they received their cards, they can rate you on communication, packaging, speed and how accurate the listing was.', 'Miután a vevő visszaigazolja, hogy megkapta a kártyákat, értékelheti a kommunikációt, a csomagolást, a gyorsaságot és a hirdetés pontosságát.')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sellerReviews.map((rev) => <ReviewCard key={rev.id} review={rev} />)}
            </div>
          )}
        </div>
      )}

      <RateTradeModal
        open={Boolean(ratingOrder)}
        onClose={() => setRatingOrder(null)}
        orderNumber={ratingOrder?.order_number || ''}
        direction="seller_to_buyer"
        counterpartName={ratingOrder?.customer_info?.name}
        onDone={(review) => {
          setBuyerRatingsByOrder(prev => ({ ...prev, [review.order_number]: review }));
          showToast(t('Buyer rated - thanks!', 'Vásárló értékelve - köszönjük!'));
        }}
      />

      {/* Quick Edit Modal */}
      <EditListingModal
        listing={editingListing}
        collectionNote={(() => {
          const links = listingCollectionLinks(editingListing?.notes);
          if (links.alwaysListId) return t(
            `Stock follows "${collectionName(links.alwaysListId)}": changing it here changes the count in that collection too.`,
            `A készlet a(z) "${collectionName(links.alwaysListId)}" gyűjteményt követi: az itteni módosítás ott is változtatja a darabszámot.`
          );
          if (links.sourceId) return t(
            `Listed from "${collectionName(links.sourceId)}". Lowering the stock gives copies back to it; raising it takes more out.`,
            `A(z) "${collectionName(links.sourceId)}" gyűjteményből hirdetve. A készlet csökkentése visszateszi a lapokat; a növelése kivesz belőle.`
          );
          return t(
            'Lowering the stock gives copies back to your Personal collection; raising it takes more out (if they are there).',
            'A készlet csökkentése visszateszi a példányokat a Személyes gyűjteményedbe; a növelése kivesz belőle (ha elérhető).'
          );
        })()}
        onClose={() => setEditingListing(null)}
        onSaved={handleListingSaved}
      />

      {/* Bulk Price Edit Modal */}
      {bulkPriceModalAnim.rendered && (
        <div data-state={bulkPriceModalAnim.state} className="tv-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            data-state={bulkPriceModalAnim.state}
            className="tv-modal-panel w-full max-w-sm rounded-2xl p-5 border shadow-2xl"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                {t(`Set Price for ${selectedListingIds.size} Listings`, `Ár beállítása ${selectedListingIds.size} hirdetéshez`)}
              </h3>
              <button
                type="button"
                onClick={() => setShowBulkPriceModal(false)}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                aria-label={t('Close', 'Bezárás')}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-5">
              <label className="block text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">
                {t('New Price (HUF), applied to all selected', 'Új ár (Ft), minden kijelölt tételre érvényesítve')}
              </label>
              <input
                type="number"
                min="1"
                value={bulkPriceHuf}
                onChange={(e) => setBulkPriceHuf(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold outline-none border"
                style={{
                  background: 'var(--bg-input)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBulkPriceModal(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer border"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {t('Cancel', 'Mégse')}
              </button>
              <button
                type="button"
                onClick={handleBulkPriceChange}
                disabled={bulkActionBusy}
                className="px-4 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-md disabled:opacity-50"
              >
                {bulkActionBusy ? '…' : t('Apply', 'Alkalmaz')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB: SHIPPING OPTIONS ──────────────────────────────────── */}
      {activeTab === 'shipping' && profile && (
        <ShippingSettingsPanel sellerId={profile.id} sellerCountry={profile.country || 'HU'} onToast={showToast} />
      )}

      {/* ─── TAB: COLLECTION SETTINGS ───────────────────────────────── */}
      {activeTab === 'collections' && (
        <CollectionSettingsPanel
          onToast={showToast}
          onChanged={() => {
            loadSellerListings();
            window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
          }}
        />
      )}

      {/* List Card Modal - it holds itself open for its own exit transition (isOpen), so it's
          rendered unconditionally rather than wrapped in `{isListModalOpen && (...)}` here, which
          would unmount it before that transition gets to play. */}
      <ListCardModal
        isOpen={isListModalOpen}
        onClose={() => setIsListModalOpen(false)}
        onSuccess={() => {
          setIsListModalOpen(false);
          loadSellerListings();
          showToast(t('Card successfully listed!', 'Kártya sikeresen meghirdetve!'));
        }}
      />

      <CreateTradeModal
        isOpen={isCreateTradeOpen}
        onClose={() => setIsCreateTradeOpen(false)}
        onSuccess={() => {
          setIsCreateTradeOpen(false);
          loadSellerTrades();
          showToast(t('Trade listing created!', 'Cserehirdetés létrehozva!'));
        }}
      />

      <CreateBulkModal
        isOpen={isCreateBulkOpen}
        onClose={() => setIsCreateBulkOpen(false)}
        onSuccess={() => {
          setIsCreateBulkOpen(false);
          loadSellerBulk();
          showToast(t('Bulk lot published!', 'Bulk tétel közzétéve!'));
        }}
      />

      <CreateAuctionModal
        isOpen={isCreateAuctionOpen}
        onClose={() => setIsCreateAuctionOpen(false)}
        onSuccess={() => {
          setIsCreateAuctionOpen(false);
          loadSellerAuctions();
          showToast(t('Auction started!', 'Aukció elindítva!'));
        }}
      />

      <BulkDetailModal
        bulk={selectedBulkModal}
        onClose={() => setSelectedBulkModal(null)}
        onChanged={() => loadSellerBulk()}
      />

      <AuctionDetailModal
        auction={selectedAuctionModal}
        onClose={() => setSelectedAuctionModal(null)}
        onChanged={() => {
          loadSellerAuctions();
          loadSellerReviews();
        }}
      />

      {/* Auction Cancel Penalty Confirmation Modal */}
      {cancellingAuctionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl p-6 border shadow-2xl space-y-4"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-rose-500/20 text-rose-400 border border-rose-500/40 shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
                  {t(`Cancel Auction "${cancellingAuctionTarget.title}"?`, `Törlöd a(z) "${cancellingAuctionTarget.title}" aukciót?`)}
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {cancellingAuctionTarget.highest_bidder_id
                    ? t(`Current winning bid: ${formatPrice(cancellingAuctionTarget.current_bid_huf || cancellingAuctionTarget.base_price_huf)}`, `Jelenlegi nyertes licit: ${formatPrice(cancellingAuctionTarget.current_bid_huf || cancellingAuctionTarget.base_price_huf)}`)
                    : t('No bids placed yet', 'Még nem érkezett licit')}
                </p>
              </div>
            </div>

            {cancellingAuctionTarget.highest_bidder_id ? (
              <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs font-bold text-rose-300 leading-relaxed">
                {t('WARNING: Because this auction has a winning bidder', 'FIGYELEM: Mivel az aukciónak van érvényes licitálója')} ({cancellingAuctionTarget.highest_bidder_name || t('Bidder', 'Licitáló')}), {t('cancelling it or refusing to honor the final price will automatically record a mandatory 1-star review from the system on your seller profile stating that you cancelled the auction and did not honor the winning bid price.', 'az aukció törlése vagy a záró ár megtagadása automatikusan egy kötelező 1 csillagos rendszerértékelést rögzít az eladói profilodon, miszerint törölted az aukciót és nem teljesítetted a nyertes licitárat.')}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {t('This auction has no bids yet and can be cancelled without penalty.', 'Erre az aukcióra még nem érkezett licit, így büntetés nélkül törölhető.')}
              </p>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCancellingAuctionTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {t('Keep Auction', 'Aukció megtartása')}
              </button>
              <button
                type="button"
                disabled={cancellingAuctionBusy}
                onClick={handleConfirmCancelAuction}
                className="px-4 py-2 rounded-xl text-xs font-black bg-rose-500 hover:bg-rose-400 text-white cursor-pointer transition disabled:opacity-50"
              >
                {cancellingAuctionBusy
                  ? t('Cancelling...', 'Törlés folyamatban...')
                  : cancellingAuctionTarget.highest_bidder_id
                  ? t('Confirm Cancel & Accept 1-Star Review', 'Törlés megerősítése és 1 csillag elfogadása')
                  : t('Cancel Auction', 'Aukció törlése')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
