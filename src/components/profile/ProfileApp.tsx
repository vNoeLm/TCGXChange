import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase, cardThumbProps, getCardImageUrl } from '../../lib/supabase';
import { useExitTransition } from '../../lib/useExitTransition';
import { getCurrentProfile, updateProfile, signOut, fetchUserOrders, onSignedInUserChange } from '../../lib/auth';
import { cancelOrder, deleteOrder, deleteOrders, purgeAllOrders } from '../../lib/orders';
import { fetchReviewsWrittenBy, fetchReputation } from '../../lib/reviews';
import { RateTradeModal } from '../reviews/RateTradeModal';
import { BuyerHolds } from './BuyerHolds';
import { AvatarBannerModal, BannerContainerBackground } from './AvatarBannerModal';
import { ProfileQrModal } from './ProfileQrModal';
import { Stars } from '../reviews/ReviewParts';
import type { UserProfile, Order, TradeReview, UserSocialProfiles } from '../../types';
import { AuthModal } from '../auth/AuthModal';
import {
  useSiteTheme,
  getCustomTheme,
  saveCustomTheme,
  CUSTOM_PRESETS,
  DEFAULT_CUSTOM_THEME,
  type ThemeMode,
  type CustomThemeConfig,
} from '../../lib/theme';

/** The color, hex codes and name each theme option shows itself by — nothing else. */
const THEME_SWATCHES: { mode: ThemeMode; name: string; hex: string[] }[] = [
  { mode: 'auto', name: 'Auto (System)', hex: ['#3b82f6', '#fb7185'] },
  { mode: 'dark', name: 'Midnight Slate', hex: ['#3b82f6'] },
  { mode: 'light', name: 'Ivory Parchment', hex: ['#f3ede2', '#fb7185'] },
  { mode: 'custom', name: 'Custom Studio', hex: ['#a855f7', '#06b6d4'] },
];
import { getSellerTier, BadgeIconSvg, SiteOwnerTag } from '../../lib/badges';
import { SocialProfileButtons } from './SocialProfileButtons';
import { GAMES } from '../../lib/constants';
import { COUNTRIES, getCountry } from '../../lib/countries';
import { CountryFlag } from '../CountryFlag';
import { useCurrency, type Currency } from '../../lib/currency';
import { fetchMyDecks, setDeckVisibility, deletePublishedDeck, type PublicDeckSummary } from '../../lib/publicDecks';

const ORDER_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  Pending: { label: 'Pending (Függőben)', bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: 'rgba(234, 179, 8, 0.35)' },
  Processing: { label: 'Processing (Feldolgozás alatt)', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.35)' },
  Shipped: { label: 'Shipped (Feladva)', bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: 'rgba(168, 85, 247, 0.35)' },
  Delivered: { label: 'Delivered (Kézbesítve)', bg: 'var(--positive-muted)', color: 'var(--positive)', border: 'var(--positive-border)' },
  Cancelled: { label: 'Cancelled (Törölve)', bg: 'var(--negative-muted)', color: 'var(--negative)', border: 'var(--negative-border)' },
};

export function ProfileApp() {
  const { theme: effectiveTheme, themeMode, setThemeMode } = useSiteTheme();
  const { currency, setCurrency, formatPrice } = useCurrency();
  const [customConfig, setCustomConfig] = useState<CustomThemeConfig>(() => getCustomTheme());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [showAppearanceModal, setShowAppearanceModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('HU');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [profilePanelTab, setProfilePanelTab] = useState<'theme' | 'decks'>('theme');
  const [themeExpanded, setThemeExpanded] = useState(false);

  // Social Profiles State
  const [socialProfiles, setSocialProfiles] = useState<UserSocialProfiles | null>(null);

  useEffect(() => {
    const handleCustomChange = (e: Event) => {
      const custom = e as CustomEvent<CustomThemeConfig>;
      if (custom.detail) {
        setCustomConfig(custom.detail);
      }
    };
    window.addEventListener('tcg-custom-theme-change', handleCustomChange);
    return () => window.removeEventListener('tcg-custom-theme-change', handleCustomChange);
  }, []);
  // Auto-hide nulls the message immediately, but the toast needs it for the length of its own
  // exit transition - freeze the last shown message instead of reading the live one.
  const toastMessageRef = useRef<string | null>(null);
  if (toastMessage) toastMessageRef.current = toastMessage;
  const toastAnim = useExitTransition(!!toastMessage, 400);

  // Published Decks State
  const [myDecks, setMyDecks] = useState<PublicDeckSummary[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(true);

  const refreshMyDecks = () => {
    setLoadingDecks(true);
    fetchMyDecks().then(decks => { setMyDecks(decks); setLoadingDecks(false); });
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [orderStatusFilter, setOrderStatusFilter] = useState('All');
  const [orderDateFilter, setOrderDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [cancellingOrderNumber, setCancellingOrderNumber] = useState<string | null>(null);
  const [deletingOrderNumber, setDeletingOrderNumber] = useState<string | null>(null);
  const [cleaningOrders, setCleaningOrders] = useState(false);
  // Per-order expand state. Default state is CLOSED (false) for ALL orders.
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [chattingOrderId, setChattingOrderId] = useState<string | null>(null);
  const [copiedOrderNumber, setCopiedOrderNumber] = useState<string | null>(null);

  const isOrderExpanded = (order: Order): boolean => {
    const key = order.order_number || order.id;
    return Boolean(expandedOrders[key]);
  };
  const toggleOrderExpand = (order: Order) => {
    const key = order.order_number || order.id;
    setExpandedOrders(prev => ({ ...prev, [key]: !isOrderExpanded(order) }));
  };
  const expandAllOrders = () => {
    const allOpen: Record<string, boolean> = {};
    orders.forEach((o) => {
      const key = o.order_number || o.id;
      if (key) allOpen[key] = true;
    });
    setExpandedOrders(allOpen);
  };
  const collapseAllOrders = () => {
    setExpandedOrders({});
  };

  const handleStartOrderChat = async (order: Order) => {
    const orderKey = order.order_number || order.id;
    setChattingOrderId(orderKey);
    try {
      const res = await fetch('/api/store/order-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_number: orderKey }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.conversation_id) {
        window.location.href = `/messages?conversation_id=${data.conversation_id}&order_number=${encodeURIComponent(orderKey)}`;
        return;
      }
      if (order.seller_id) {
        window.location.href = `/messages?user_id=${order.seller_id}&order_number=${encodeURIComponent(orderKey)}`;
        return;
      }
      window.location.href = `/messages?order_number=${encodeURIComponent(orderKey)}`;
    } catch {
      window.location.href = `/messages?order_number=${encodeURIComponent(orderKey)}`;
    } finally {
      setChattingOrderId(null);
    }
  };

  // Seller Rating State
  // Reviews I've written, by order - each side of a trade rates the other once.
  const [reviewsByOrder, setReviewsByOrder] = useState<Record<string, TradeReview>>({});
  const [ratingModalOrder, setRatingModalOrder] = useState<Order | null>(null);
  const [showGoogleReviewModal, setShowGoogleReviewModal] = useState(false);

  // Collection & Badge State (Per-Game)
  const [statsByGame, setStatsByGame] = useState<Record<string, { owned: number; total: number; weightedPercentage: number }>>(() => {
    const init: Record<string, { owned: number; total: number; weightedPercentage: number }> = {};
    for (const g of GAMES) {
      init[g.id] = { owned: 0, total: 0, weightedPercentage: 0 };
    }
    return init;
  });
  const [displayedBadges, setDisplayedBadges] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('tcg_displayed_badges');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return ['riftbound'];
  });
  const [sellerSalesCount, setSellerSalesCount] = useState(0);

  const loadCollectionStats = async (uid?: string) => {
    try {
      const localOwnedIds: string[] = [];
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem('tcg_user_collection') || localStorage.getItem('tcg_collection');
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              parsed.forEach((id: string) => { if (typeof id === 'string') localOwnedIds.push(id.replace(/_foil$/, '')); });
            } else if (parsed && typeof parsed === 'object') {
              Object.entries(parsed).forEach(([k, v]) => {
                if (Number(v) > 0) localOwnedIds.push(k.replace(/_foil$/, ''));
              });
            }
          } catch {}
        }
      }

      const targetUid = uid || profile?.id || null;
      const res = await fetch('/api/profile/collection-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetUid, local_ids: localOwnedIds }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.success && json.data) {
          setStatsByGame(json.data);
        }
      }
    } catch (e) {
      console.warn('Failed to calculate collection stats:', e);
    }
  };

  const saveDisplayedBadgesPreference = async (next: string[]) => {
    setDisplayedBadges(next);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tcg_displayed_badges', JSON.stringify(next));
      } catch {}
    }
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (token) {
        await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ displayed_badges: next }),
        });
      }
    } catch {}
  };

  const toggleDisplayedBadge = (gameId: string) => {
    const exists = displayedBadges.includes(gameId);
    const next = exists ? displayedBadges.filter(g => g !== gameId) : [...displayedBadges, gameId];
    saveDisplayedBadgesPreference(next);
    showToast(exists ? 'Removed badge from profile display' : 'Badge added to profile display');
  };

  const loadSellerSalesCount = async (userId?: string) => {
    const targetUid = userId || profile?.id;
    if (!targetUid) return;
    try {
      // A dedicated lightweight endpoint, not the full marketplace listings query (which joins
      // inventory to cards, sets and images) - this needs exactly one number off it.
      const res = await fetch(`/api/marketplace/seller-stats?seller_id=${targetUid}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setSellerSalesCount(json.data.salesCount);
      }
    } catch (e) {
      console.warn('Failed to load seller sales count:', e);
    }
  };

  useEffect(() => {
    if (!profile?.id) return;
    fetchReviewsWrittenBy(profile.id).then(revs => {
      const map: Record<string, TradeReview> = {};
      revs.forEach(r => { map[r.order_number] = r; });
      setReviewsByOrder(map);
    });
  }, [profile?.id]);

  const handleCancelOrder = async (orderNumber: string) => {
    const confirmMsg = `Are you sure you want to cancel order #${orderNumber}? The items will return to available stock.`;

    if (!window.confirm(confirmMsg)) return;

    setCancellingOrderNumber(orderNumber);
    try {
      const res = await cancelOrder(orderNumber);
      if (res.success) {
        setOrders(prev => prev.map(o => o.order_number === orderNumber ? { ...o, status: 'Cancelled' } : o));
        showToast('Order cancelled, items returned to stock!');
      } else {
        alert(res.error || 'Failed to cancel order.');
      }
    } catch (err: any) {
      alert(err?.message || 'Error cancelling order.');
    } finally {
      setCancellingOrderNumber(null);
    }
  };

  const handleDeleteOrder = async (orderNumber: string) => {
    if (!window.confirm(`Biztosan eltávolítod a(z) #${orderNumber} rendelést a rendelési előzményeidből? (A rendelési adatok a rendszerben megmaradnak)`)) return;
    setDeletingOrderNumber(orderNumber);
    try {
      const res = await deleteOrder(orderNumber);
      if (res.success) {
        setOrders(prev => prev.filter(o => o.order_number !== orderNumber && o.id !== orderNumber));
        showToast(`Rendelés (#${orderNumber}) eltávolítva az előzményekből.`);
      } else {
        showToast(res.error || 'Nem sikerült eltávolítani a rendelést.');
      }
    } catch (err: any) {
      showToast(err?.message || 'Hiba történt az eltávolítás során.');
    } finally {
      setDeletingOrderNumber(null);
    }
  };

  const handleCleanOrders = async (mode: 'cancelled' | 'all_mine') => {
    const targets = mode === 'all_mine'
      ? orders.map(o => o.order_number || o.id).filter(Boolean)
      : orders
          .filter(o => o.status === 'Cancelled')
          .map(o => o.order_number || o.id)
          .filter(Boolean);

    if (targets.length === 0) {
      showToast('Nincsenek törölhető lemondott rendelések.');
      return;
    }

    const msg = mode === 'all_mine'
      ? `Biztosan törölni szeretnéd mind a(z) ${targets.length} rendelést a személyes előzményeidből?`
      : `Biztosan eltávolítod a(z) ${targets.length} lemondott rendelést a személyes előzményeidből? (A rendelési adatok a rendszerben megmaradnak)`;
    if (!window.confirm(msg)) return;

    setCleaningOrders(true);
    try {
      if (mode === 'all_mine') {
        await purgeAllOrders('mine');
        setOrders([]);
        showToast('Rendelési előzmények kiürítve.');
      } else {
        const res = await deleteOrders(targets);
        if (res.success) {
          const targetSet = new Set(targets);
          setOrders(prev => prev.filter(o => !targetSet.has(o.order_number) && !targetSet.has(o.id)));
          showToast(`Sikeresen eltávolítva: ${targets.length} lemondott rendelés.`);
        } else {
          showToast(res.error || 'A rendelések eltávolítása nem sikerült.');
        }
      }
    } finally {
      setCleaningOrders(false);
    }
  };

  useEffect(() => {
    const handleOrdersChange = async () => {
      const userOrders = await fetchUserOrders();
      setOrders(userOrders as Order[]);
    };
    window.addEventListener('tcg-orders-changed', handleOrdersChange);

    async function loadData() {
      // Orders have their own loading state, so the page doesn't wait on them: they start
      // alongside the profile and fill in whenever they arrive.
      fetchUserOrders().then(userOrders => {
        setOrders(userOrders as Order[]);
        setLoadingOrders(false);
      });

      const p = await getCurrentProfile();
      if (p) {
        setProfile(p);
        setBannerUrl(p.banner_url || null);
        setDisplayName(p.display_name || '');
        loadSellerSalesCount(p.id);
        loadCollectionStats(p.id);
        refreshMyDecks();
        fetch(`/api/profile?id=${encodeURIComponent(p.id)}`)
          .then(r => (r.ok ? r.json() : null))
          .then(j => {
            if (j?.success) {
              if (j.banner_url) setBannerUrl(j.banner_url);
              if (j.avatar_url) setProfile(prev => (prev ? { ...prev, avatar_url: j.avatar_url } : prev));
              if (Array.isArray(j.displayed_badges)) {
                setDisplayedBadges(j.displayed_badges);
                try { localStorage.setItem('tcg_displayed_badges', JSON.stringify(j.displayed_badges)); } catch {}
              }
              if (j.social_profiles) {
                setSocialProfiles(j.social_profiles);
              }
            }
          })
          .catch(() => {});
      } else {
        loadCollectionStats();
        setLoadingDecks(false);
      }
      setLoading(false);
    }

    loadData();

    const handleMarketplaceEvt = () => {
      loadSellerSalesCount();
      loadCollectionStats();
    };
    const handleCollectionEvt = () => loadCollectionStats();
    window.addEventListener('tcg-marketplace-changed', handleMarketplaceEvt);
    window.addEventListener('tcg-collection-change', handleCollectionEvt);

    // Only when the signed-in user actually changes: this used to react to every auth event,
    // including the initial one (the session loadData() just loaded) and the SIGNED_IN supabase-js
    // repeats each time the tab is shown again - refetching everything on every tab switch.
    const unsubscribeAuth = onSignedInUserChange((session) => {
      if (session) {
        getCurrentProfile().then(p => {
          setProfile(p);
          setDisplayName(p?.display_name || '');
          if (p) loadSellerSalesCount(p.id);
          loadCollectionStats(p?.id);
        });
        fetchUserOrders().then(ord => setOrders(ord as Order[]));
      } else {
        setProfile(null);
        fetchUserOrders().then(ord => setOrders(ord as Order[]));
      }
    });

    return () => {
      unsubscribeAuth();
      window.removeEventListener('tcg-orders-changed', handleOrdersChange);
      window.removeEventListener('tcg-marketplace-changed', handleMarketplaceEvt);
      window.removeEventListener('tcg-collection-change', handleCollectionEvt);
    };
  }, []);

  const isOwner = Boolean(profile?.role === 'owner' || profile?.email === 'vnoel05@gmail.com' || profile?.email === 'support@tcgxchange.net');
  const isLightTheme = effectiveTheme === 'light';
  // The same rating the public profile uses, so the seller badge here matches what others see.
  const [sellerRatingAvg, setSellerRatingAvg] = useState<number | null>(null);
  useEffect(() => {
    if (profile?.id) fetchReputation(profile.id).then(rep => setSellerRatingAvg(rep.as_seller.avg));
  }, [profile?.id]);
  const sellerTier = useMemo(() => {
    return getSellerTier(sellerSalesCount, sellerRatingAvg, isOwner, isLightTheme);
  }, [sellerSalesCount, sellerRatingAvg, isOwner, isLightTheme]);

  const handleSignOut = async () => {
    await signOut();
    window.location.href = '/';
  };

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (orderStatusFilter !== 'All' && o.status !== orderStatusFilter) return false;
      if (orderDateFilter !== 'all') {
        const d = new Date(o.created_at);
        const now = new Date();
        if (orderDateFilter === 'today') {
          if (d.toDateString() !== now.toDateString()) return false;
        } else if (orderDateFilter === 'week') {
          const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 7);
          if (d < cutoff) return false;
        } else if (orderDateFilter === 'month') {
          const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 1);
          if (d < cutoff) return false;
        }
      }
      return true;
    });
  }, [orders, orderStatusFilter, orderDateFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-bold text-base animate-pulse" style={{ color: 'var(--text-accent)' }}>Loading profile…</span>
      </div>
    );
  }

  const activeSwatch = THEME_SWATCHES.find((opt) => opt.mode === themeMode) || THEME_SWATCHES[0];

  const renderThemeContent = () => (
    <div>
      {/* Compact Preview Bar — click to expand or collapse */}
      <div
        onClick={() => setThemeExpanded((prev) => !prev)}
        className="p-3.5 rounded-xl border flex items-center justify-between gap-3 flex-wrap cursor-pointer transition hover:border-[var(--border-hover)]"
        style={{ background: 'var(--bg-surface-2)', borderColor: themeExpanded ? 'var(--accent-border)' : 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {activeSwatch.hex.length > 1 ? (
            <span className="flex -space-x-1 shrink-0">
              {activeSwatch.hex.map((h) => (
                <span
                  key={h}
                  className="w-4 h-4 rounded-full border"
                  style={{ background: h, borderColor: 'var(--border-hover)' }}
                />
              ))}
            </span>
          ) : (
            <span
              className="w-4 h-4 rounded-full shrink-0"
              style={{ background: activeSwatch.hex[0], boxShadow: `0 0 6px ${activeSwatch.hex[0]}99` }}
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs sm:text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                {activeSwatch.name}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                {activeSwatch.hex.join(' / ')}
              </span>
            </div>
            <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {themeExpanded ? 'Select a theme below or customize your palette.' : 'Click to expand theme options & Custom Studio'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setThemeExpanded((prev) => !prev);
          }}
          className="h-8 px-3 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 cursor-pointer transition shrink-0"
          style={{
            background: themeExpanded ? 'var(--accent-muted)' : 'var(--bg-surface)',
            borderColor: themeExpanded ? 'var(--accent-border)' : 'var(--border)',
            color: themeExpanded ? 'var(--text-accent)' : 'var(--text-secondary)',
          }}
        >
          <span>{themeExpanded ? 'Hide Options' : 'Change Theme'}</span>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${themeExpanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {themeExpanded && (
        <div className="mt-4 space-y-5">
          {/* Theme swatches: color, hex codes and its name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {THEME_SWATCHES.map((opt) => {
              const active = themeMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => {
                    setThemeMode(opt.mode);
                    showToast(`Theme: ${opt.name}`);
                  }}
                  title={opt.hex.join(' / ')}
                  className={`px-3 py-2.5 rounded-xl text-left transition cursor-pointer border flex items-center gap-2.5 ${
                    active
                      ? 'bg-[var(--accent-muted)] border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]'
                      : 'bg-[var(--bg-input)] border-[var(--border)] hover:bg-[var(--bg-raised)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  {opt.hex.length > 1 ? (
                    <span className="flex -space-x-1 shrink-0">
                      {opt.hex.map((h) => (
                        <span
                          key={h}
                          className="w-3 h-3 rounded-full border"
                          style={{ background: h, borderColor: 'var(--border-hover)' }}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: opt.hex[0], boxShadow: `0 0 6px ${opt.hex[0]}99` }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate" style={{ color: active ? 'var(--text-accent)' : 'var(--text-primary)' }}>
                      {opt.name}
                    </div>
                    <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                      {opt.hex.join(' / ')}
                    </div>
                  </div>
                  {active && (
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </button>
              );
            })}
          </div>

          
          {/* Display Currency Preference */}
          <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Display Currency</h4>
              <p className="text-xs text-[var(--text-secondary)]">Show marketplace listings and cart prices in Hungarian Forints or Euros.</p>
            </div>
            <div className="inline-flex rounded-xl p-1 border gap-1 self-start sm:self-auto" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => { setCurrency('HUF'); showToast('Display currency set to HUF (Ft)'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${currency === 'HUF' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                HUF (Ft)
              </button>
              <button
                type="button"
                onClick={() => { setCurrency('EUR'); showToast('Display currency set to EUR (€)'); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${currency === 'EUR' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                EUR (€)
              </button>
            </div>
          </div>

          {/* Custom Theme Studio: interactive color pickers and presets */}
          {themeMode === 'custom' && (
            <div className="pt-4 border-t border-[var(--border-subtle)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-[var(--text-primary)]">Custom Palette Studio</h3>
                  <p className="text-xs text-[var(--text-secondary)]">Customize your page background, surfaces, accent highlights, and text colors.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const def = DEFAULT_CUSTOM_THEME;
                    setCustomConfig(def);
                    saveCustomTheme(def);
                    showToast('Reset custom palette to defaults');
                  }}
                  className="text-xs font-bold px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer self-start sm:self-auto"
                >
                  Reset to Defaults
                </button>
              </div>

              {/* Quick Presets */}
              <div>
                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-2">Preset Themes</span>
                <div className="flex flex-wrap gap-2">
                  {CUSTOM_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => {
                        setCustomConfig(preset.config);
                        saveCustomTheme(preset.config);
                        showToast(`Applied preset: ${preset.name}`);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] hover:bg-[var(--bg-surface-2)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer flex items-center gap-2"
                    >
                      <span className="w-2.5 h-2.5 rounded-full border border-black/20" style={{ background: preset.config.accent }} />
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Color pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { key: 'bgPage' as const, label: 'Page Background', desc: 'Main canvas & page backdrop' },
                  { key: 'bgSurface' as const, label: 'Surface / Containers', desc: 'Cards, panels, and modals' },
                  { key: 'bgSurface2' as const, label: 'Secondary Surface', desc: 'Nested cards & elevated blocks' },
                  { key: 'accent' as const, label: 'Accent & Highlights', desc: 'Buttons, badges, and glows' },
                  { key: 'textPrimary' as const, label: 'Primary Text', desc: 'Headings and main body text' },
                ].map((field) => {
                  const val = customConfig[field.key];
                  return (
                    <div
                      key={field.key}
                      className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] flex items-center gap-3"
                    >
                      <label className="relative w-9 h-9 rounded-lg border border-[var(--border-hover)] shadow-sm shrink-0 cursor-pointer overflow-hidden block">
                        <span className="absolute inset-0" style={{ background: val }} />
                        <input
                          type="color"
                          value={val.startsWith('#') && (val.length === 7 || val.length === 4) ? val : '#a855f7'}
                          onChange={(e) => {
                            const next = { ...customConfig, [field.key]: e.target.value };
                            setCustomConfig(next);
                            saveCustomTheme(next);
                          }}
                          className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-[var(--text-primary)] truncate">{field.label}</div>
                        <div className="text-[10px] text-[var(--text-muted)] truncate">{field.desc}</div>
                      </div>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => {
                          const next = { ...customConfig, [field.key]: e.target.value };
                          setCustomConfig(next);
                          saveCustomTheme(next);
                        }}
                        className="w-20 px-2 py-1 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-center focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderMyDecksContent = () => (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Decks published from the Deck Builder. Public decks show up in the <a href="/decks" className="underline">Deck Browser</a> and on your public profile.
        </p>
        <a
          href="/deck-builder"
          className="px-3.5 py-1.5 rounded-lg text-xs font-bold shrink-0 self-start sm:self-auto transition hover:brightness-110 hover:shadow-[0_0_10px_var(--accent-glow)]"
          style={{ background: 'var(--accent-muted)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
        >
          Open Deck Builder
        </a>
      </div>

      {loadingDecks ? (
        <div className="text-center py-6 text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>Loading your decks…</div>
      ) : myDecks.length === 0 ? (
        <p className="text-xs text-center py-5" style={{ color: 'var(--text-tertiary)' }}>
          You haven't published any decks yet. Build one and hit "Publish" from the Export or Browse menu.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {myDecks.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-14 rounded-lg overflow-hidden border bg-zinc-950 shrink-0" style={{ borderColor: 'var(--border)' }}>
                  {d.legend_card?.image_path && (
                    <img {...cardThumbProps(d.legend_card.image_path, 'avatar')} alt={d.legend_card.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <a href={`/decks/view?deck=${d.id}`} className="text-sm font-bold hover:underline truncate block" style={{ color: 'var(--text-primary)' }}>{d.name}</a>
                  <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {d.is_public ? 'Public' : 'Unlisted'}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => { const ok = await setDeckVisibility(d.id, !d.is_public); if (ok) refreshMyDecks(); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  {d.is_public ? 'Unlist' : 'Make Public'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Remove "${d.name}" from your published decks?`)) return;
                    const ok = await deletePublishedDeck(d.id);
                    if (ok) refreshMyDecks();
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition cursor-pointer"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderCombinedThemeAndDecksContainer = () => (
    <div
      id="profile-tabs-container"
      className="rounded-2xl p-4 sm:p-5 mb-8 shadow-sm transition-colors duration-200"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Tab bar inside the single container, matching Seller Hub tab feel */}
      <div
        className="flex items-center gap-1 overflow-x-auto border-b pt-1.5 pb-3 px-1 -mx-1 mb-4"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <button
          type="button"
          onClick={() => setProfilePanelTab('theme')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer inline-flex items-center gap-2 border ${
            profilePanelTab === 'theme'
              ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)]'
              : 'bg-transparent border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
          }`}
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
          </svg>
          <span>Appearance &amp; Theme</span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
            style={{
              background: 'var(--bg-surface-2)',
              borderColor: 'var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            {activeSwatch.name}
          </span>
        </button>

        {profile && (
          <button
            type="button"
            onClick={() => setProfilePanelTab('decks')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer inline-flex items-center gap-2 border ${
              profilePanelTab === 'decks'
                ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)]'
                : 'bg-transparent border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M7 8h10M7 12h10M7 16h6" />
            </svg>
            <span>My Decks</span>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{
                background: 'var(--bg-surface-2)',
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              {myDecks.length}
            </span>
          </button>
        )}

      </div>

      {profilePanelTab === 'theme' || !profile
        ? renderThemeContent()
        : renderMyDecksContent()}
    </div>
  );

  if (!profile) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(16px,3vw,32px) clamp(16px,3vw,24px)" }}>
        {renderCombinedThemeAndDecksContainer()}

        <div 
          className="max-w-md mx-auto my-12 p-8 text-center rounded-2xl shadow-xl border"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <div 
            className="w-14 h-14 rounded-2xl inline-flex items-center justify-center mb-4 border"
            style={{
              background: 'var(--bg-surface-2)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--accent)'
            }}
          >
            <svg className="w-7 h-7" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
          <h2 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>User Account</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
            Sign in or create an account to view your order history and manage your profile.
          </p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-6 py-3 font-black rounded-xl text-sm transition shadow-md cursor-pointer"
            style={{
              background: 'var(--accent-strong)',
              color: 'var(--text-on-accent, #000)',
              boxShadow: '0 0 16px var(--accent-glow)'
            }}
          >
            Sign In / Register
          </button>
          {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(16px,3vw,32px) clamp(16px,3vw,24px)" }}>
      {/* Account Info Header */}
      <div
        className="relative rounded-2xl mb-6 shadow-sm border overflow-hidden"
        style={{
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <BannerContainerBackground bannerUrl={bannerUrl} isLightTheme={isLightTheme} />

        <div className="relative z-10 p-3.5 sm:p-7">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-5">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 sm:gap-x-5 gap-y-1 sm:gap-y-2 text-left min-w-0 flex-1">
              {/* Avatar: row 1 on mobile, spans 2 rows on desktop */}
              <div className="col-start-1 row-start-1 sm:row-span-2 shrink-0 sm:self-center">
                <button
                  type="button"
                  onClick={() => setShowAppearanceModal(true)}
                  title="Customize Profile Picture & Banner"
                  className="group relative rounded-full shrink-0 cursor-pointer block"
                >
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.display_name || 'User'}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover shrink-0 bg-zinc-950 shadow-md"
                      style={{ border: '2px solid var(--border)' }}
                    />
                  ) : (
                    <div
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-2xl sm:text-3xl font-black border shrink-0"
                      style={{
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border)',
                        color: 'var(--accent)',
                      }}
                    >
                      {(profile.display_name || profile.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <span
                    className="absolute bottom-0 right-0 w-7 h-7 rounded-full border flex items-center justify-center shadow-md transition group-hover:scale-110"
                    style={{ background: 'var(--accent-strong)', borderColor: 'var(--bg-surface)', color: 'var(--text-on-accent, #000)' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </span>
                </button>
              </div>

              {/* Name & Email: row 1 col 2 on mobile & desktop */}
              <div className="col-start-2 row-start-1 min-w-0 self-center">
                <div className="flex items-center justify-start gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 flex-wrap justify-start">
                    <h1 className="text-xl sm:text-2xl font-black break-words min-w-0" style={{ color: 'var(--text-primary)' }}>
                      {profile.display_name || 'Valued Collector'}
                    </h1>

                    <button
                      type="button"
                      onClick={() => setShowAppearanceModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer border hover:brightness-110 active:scale-95"
                      style={{
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)',
                      }}
                      title="Profile Settings"
                    >
                      <svg className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                      <span>Settings</span>
                    </button>
                  </div>
                </div>
                <div className="text-xs sm:text-sm font-mono mt-1 break-all" style={{ color: 'var(--text-tertiary)' }}>
                  {profile.email}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  <CountryFlag countryCode={profile.country || 'HU'} className="w-3.5 h-2.5 rounded-[2px]" />
                  <span>{getCountry(profile.country).name}</span>
                </div>
              </div>

              {/* Horizontal divider line under email on phone */}
              <div className="col-span-2 border-t my-2 sm:hidden border-[var(--border-subtle)]" />

              {/* Tags: col-span-2 takes 100% width on phone, row 2 under name & email on desktop */}
              <div className="col-span-2 sm:col-start-2 sm:row-start-2 w-full flex items-center justify-start gap-1.5 sm:gap-2 flex-wrap">
                {(profile.is_admin || profile.role === 'admin') && (
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-0.5 rounded-md border shadow-sm backdrop-blur-md"
                    style={{
                      background: 'var(--accent-muted)',
                      borderColor: 'var(--accent-border)',
                      color: 'var(--text-accent)',
                    }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <span>Admin</span>
                  </span>
                )}

                {isOwner && <SiteOwnerTag className="!text-[11px] !px-2.5 backdrop-blur-md" />}

                {/* Upgraded Seller Badge */}
                <a
                  href="/seller"
                  className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-md border transition hover:opacity-90 cursor-pointer shadow-sm backdrop-blur-md"
                  style={sellerTier.badgeStyle}
                  title={`${sellerTier.nameEn} — Click for Seller Dashboard`}
                >
                  <BadgeIconSvg iconType={sellerTier.iconType} className="w-3 h-3" />
                  <span>{sellerTier.nameEn}</span>
                </a>

                {/* Social Links (Facebook, Discord, Instagram) */}
                <SocialProfileButtons socialProfiles={socialProfiles} size="sm" />

                              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 sm:flex sm:flex-row sm:items-center gap-2 sm:gap-2.5 w-full lg:w-auto">
              <a
                href={`/user?id=${profile.id}`}
                className="w-full sm:flex-1 lg:flex-none lg:w-auto px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                title="See your profile the way other collectors see it - ratings, sales, purchases and reviews"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>View public profile</span>
              </a>
              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="w-full sm:flex-1 lg:flex-none lg:w-auto px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                style={{
                  background: 'var(--bg-surface-2)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
                title="Show QR code for in-person trade binder sharing"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
                </svg>
                <span>Share QR</span>
              </button>
              <a
                href="/seller"
                className="w-full sm:flex-1 lg:flex-none lg:w-auto px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                style={{
                  background: 'var(--bg-surface-2)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18M3 10h18M5 10V21M19 10V21M9 21v-4a2 2 0 012-2h2a2 2 0 012 2v4M3 10l2-6h14l2 6" />
                </svg>
                <span>Seller Dashboard</span>
              </a>
              {(isOwner || profile.is_admin) && (
                <a
                  href="/admin"
                  className="w-full sm:flex-1 lg:flex-none lg:w-auto px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                  style={{
                    background: 'var(--accent-muted)',
                    borderColor: 'var(--accent-border)',
                    color: 'var(--text-accent)',
                  }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span>Admin Console</span>
                </a>
              )}
              <button
                onClick={handleSignOut}
                className="w-full sm:flex-1 lg:flex-none lg:w-auto px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer border inline-flex items-center justify-center gap-1.5 backdrop-blur-md hover:brightness-110 active:scale-95"
                style={{
                  background: 'var(--negative-muted)',
                  borderColor: 'var(--negative-border)',
                  color: 'var(--negative)',
                }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Combined Appearance & Theme + My Decks Tabbed Container */}
      {renderCombinedThemeAndDecksContainer()}

      {/* Open holds as a buyer - the buyer's side of Seller Hub's Holds tab */}
      {profile && <BuyerHolds userId={profile.id} />}

      {/* Orders Section */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg sm:text-xl font-black flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span>Order History</span>
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-bold border" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}>
                {orders.length}
              </span>
              {orders.some(o => o.status === 'Cancelled') && (
                <button
                  type="button"
                  onClick={() => handleCleanOrders('cancelled')}
                  disabled={cleaningOrders}
                  className="text-[11px] font-semibold transition cursor-pointer hover:underline disabled:opacity-50"
                  style={{ color: 'var(--text-tertiary)' }}
                  title="Lemondott rendelések eltávolítása a listából"
                >
                  {cleaningOrders ? 'Tisztítás…' : 'Lemondott rendelések eltávolítása'}
                </button>
              )}
            </div>
            <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Track the fulfillment and shipping status of your orders
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={expandAllOrders}
              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Expand all orders"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={collapseAllOrders}
              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Collapse all orders"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Filters: Status + Date */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center min-w-0 mb-4">
          <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5">
            {[
              { key: 'All', label: 'All' },
              { key: 'Pending', label: 'Pending' },
              { key: 'Processing', label: 'Processing' },
              { key: 'Shipped', label: 'Shipped' },
              { key: 'Delivered', label: 'Delivered' },
              { key: 'Cancelled', label: 'Cancelled' },
            ].map(st => (
              <button
                key={st.key}
                onClick={() => setOrderStatusFilter(st.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer border shrink-0 whitespace-nowrap ${
                  orderStatusFilter === st.key
                    ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)] font-bold shadow-[0_0_10px_var(--accent-glow)]'
                    : 'bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent-muted)]/40 hover:text-[var(--text-primary)] hover:border-[var(--accent-border)]'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Date range pills */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5">
            {([
              { key: 'all' as const, label: 'All Time' },
              { key: 'today' as const, label: 'Today' },
              { key: 'week' as const, label: 'This Week' },
              { key: 'month' as const, label: 'This Month' },
            ]).map(dt => (
              <button
                key={dt.key}
                onClick={() => setOrderDateFilter(dt.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer border shrink-0 whitespace-nowrap ${
                  orderDateFilter === dt.key
                    ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)] font-bold shadow-[0_0_10px_var(--accent-glow)]'
                    : 'bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent-muted)]/40 hover:text-[var(--text-primary)] hover:border-[var(--accent-border)]'
                }`}
              >
                {dt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Orders List */}
        {loadingOrders ? (
          <div className="text-center py-14 text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>
            Loading your orders…
          </div>
        ) : filteredOrders.length === 0 ? (
          <div 
            className="rounded-2xl p-10 text-center border"
            style={{
              background: 'var(--bg-surface)',
              borderColor: 'var(--border)'
            }}
          >
            <div 
              className="w-12 h-12 rounded-full inline-flex items-center justify-center text-sm mb-3 border"
              style={{
                background: 'var(--bg-surface-2)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--accent)'
              }}
            >
              <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              No orders yet.
            </h3>
            <p className="text-xs sm:text-sm mb-5 max-w-sm mx-auto" style={{ color: 'var(--text-tertiary)' }}>
              {orderStatusFilter === 'All'
                ? "You have not placed any orders yet. Browse our store to find rare cards and accessories."
                : "No orders found matching this status filter."}
            </p>
            <a
              href="/store"
              className="inline-block px-5 py-2.5 font-black rounded-xl text-xs transition shadow-md"
              style={{
                background: 'var(--accent-strong)',
                color: 'var(--text-on-accent, #000)',
                boxShadow: '0 0 16px var(--accent-glow)'
              }}
            >
              Browse Store
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map(order => {
              const orderKey = order.order_number || order.id;
              const isExpanded = isOrderExpanded(order);
              const items = order.items || [];
              const itemCount = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
              const totalHuf = order.total_price_huf ?? order.total_huf ?? 0;
              const isDelivered = order.status === 'Delivered';
              const isShipped = order.status === 'Shipped';
              const isCancelled = order.status === 'Cancelled';
              const stStyle = ORDER_STATUS_CONFIG[order.status] || {
                label: order.status,
                bg: 'rgba(234, 179, 8, 0.15)',
                color: '#eab308',
                border: 'rgba(234, 179, 8, 0.35)',
              };

              // Structured Customer Data Extraction
              const customerName = order.customer_info?.name || order.shipping_name || profile?.display_name || 'Customer';
              const customerEmail = order.customer_info?.email || profile?.email || (typeof order.notes === 'string' ? order.notes.match(/Email:\s*([^\s|]+)/i)?.[1] : null);
              const customerPhone = order.customer_info?.phone || (typeof order.notes === 'string' ? order.notes.match(/Phone:\s*([^\s|]+)/i)?.[1] : null);
              const customerNotes = order.customer_info?.user_notes || (typeof order.notes === 'string' ? (order.notes.match(/Notes:\s*(.*)/i)?.[1] || (!order.notes.includes('|') ? order.notes : null)) : null);

              // Shipping Detailed Address
              const shipPostalCode = order.customer_info?.shipping_postal_code || order.customer_info?.postal_code;
              const shipCity = order.customer_info?.shipping_city || order.customer_info?.city;
              const shipStreet = order.customer_info?.shipping_street || order.customer_info?.address;
              const shipMode = order.customer_info?.shipping_mode || (order as any).courier_name || order.shipping_method || 'Standard Delivery';
              const shipLockerCode = order.customer_info?.shipping_locker_code;

              // Billing Detailed Address
              const billName = order.customer_info?.billing_name || customerName;
              const billTaxNumber = order.customer_info?.billing_tax_number;
              const billPostalCode = order.customer_info?.billing_postal_code || order.customer_info?.postal_code;
              const billCity = order.customer_info?.billing_city || order.customer_info?.city;
              const billStreet = order.customer_info?.billing_street || order.customer_info?.address;
              const billCountry = order.customer_info?.billing_country || 'Magyarország';

              const isChatting = chattingOrderId === orderKey;

              return (
                <div
                  key={orderKey}
                  className="rounded-2xl border overflow-hidden transition shadow-xs hover:border-[var(--border-hover)]"
                  style={{
                    background: 'var(--bg-surface)',
                    borderColor: isCancelled ? 'rgba(239, 68, 68, 0.3)' : 'var(--border)',
                    opacity: isCancelled ? 0.85 : 1,
                  }}
                >
                  {/* Clickable Order Summary Header (Default Closed State) */}
                  <div
                    className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none transition hover:bg-[var(--bg-raised)]"
                    style={{ background: isExpanded ? 'var(--bg-surface-2)' : 'var(--bg-surface)' }}
                    onClick={() => toggleOrderExpand(order)}
                  >
                    <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
                      <button
                        type="button"
                        className="p-1.5 rounded-lg border text-xs shrink-0 cursor-pointer"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                        title={isExpanded ? 'Collapse order' : 'Expand order'}
                      >
                        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      {/* Order # with Copy button and highlightable text */}
                      <div
                        className="flex items-center gap-1.5 select-text shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          className="text-xs sm:text-sm font-mono font-black select-text cursor-text"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          #{order.order_number}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(order.order_number);
                            setCopiedOrderNumber(order.order_number);
                            showToast(`Rendelésszám másolva: #${order.order_number}`);
                            setTimeout(() => setCopiedOrderNumber(null), 2000);
                          }}
                          className="p-1 rounded-md border text-[11px] transition cursor-pointer hover:bg-[var(--bg-raised)] active:scale-95 shrink-0"
                          style={{
                            background: 'var(--bg-input)',
                            borderColor: copiedOrderNumber === order.order_number ? 'var(--positive-border)' : 'var(--border)',
                            color: copiedOrderNumber === order.order_number ? 'var(--positive)' : 'var(--text-tertiary)',
                          }}
                          title="Rendelésszám másolása (Copy order number)"
                          aria-label="Rendelésszám másolása"
                        >
                          {copiedOrderNumber === order.order_number ? (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>

                      {/* Customer / Recipient Full Name */}
                      <span className="text-xs sm:text-sm font-bold truncate max-w-[180px]" style={{ color: 'var(--text-primary)' }}>
                        {customerName}
                      </span>

                      {/* Date */}
                      <span className="text-[11px] font-medium hidden md:inline shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                        {new Date(order.created_at).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>

                      {/* Seller Tag if Marketplace */}
                      {order.seller_name && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border hidden sm:inline shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                          Eladó: {order.seller_name}
                        </span>
                      )}

                      {/* Item count */}
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border hidden sm:inline shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                        {itemCount} termék
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0" onClick={(e) => e.stopPropagation()}>
                      {/* Status Badge */}
                      <span
                        className="px-2.5 py-1 rounded-full text-xs font-bold border shrink-0"
                        style={{ background: stStyle.bg, color: stStyle.color, borderColor: stStyle.border }}
                      >
                        {stStyle.label || order.status}
                      </span>

                      {/* Total Price */}
                      <span className="text-xs sm:text-sm font-black px-2.5 py-1 rounded-xl border shrink-0 font-mono" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        {formatPrice(totalHuf)}
                      </span>

                      {/* Message Store / Seller Button */}
                      <button
                        type="button"
                        disabled={isChatting}
                        onClick={() => handleStartOrderChat(order)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition disabled:opacity-50 hover:border-[var(--accent)] shrink-0"
                        style={{
                          background: 'var(--accent-muted)',
                          borderColor: 'var(--accent-border, var(--border))',
                          color: 'var(--text-accent, var(--text-primary))',
                        }}
                        title="Open two-way chat about this order"
                      >
                        <svg className={`w-3.5 h-3.5 ${isChatting ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span>{isChatting ? 'Opening...' : (order.seller_id ? 'Message Seller' : 'Message Store')}</span>
                      </button>
                    </div>
                  </div>

                  {/* Rich Expandable Detail Section */}
                  {isExpanded && (
                    <div className="p-4 sm:p-6 border-t space-y-6" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                      {/* 3 Structured Detail Cards (Identical to Admin StoreOrdersTab) */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* 1. Customer Details */}
                        <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                              <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Vásárló adatai
                              </p>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                                Vevő
                              </span>
                            </div>

                            {/* Order Number Box with One-Click Copy */}
                            <div className="p-2 rounded-lg border flex items-center justify-between gap-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                  Rendelésszám
                                </p>
                                <p className="text-xs font-mono font-black select-text cursor-text truncate" style={{ color: 'var(--text-primary)' }}>
                                  #{order.order_number}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(order.order_number);
                                  setCopiedOrderNumber(order.order_number);
                                  showToast(`Rendelésszám kimásolva: #${order.order_number}`);
                                  setTimeout(() => setCopiedOrderNumber(null), 2000);
                                }}
                                className="px-2 py-1 rounded-md border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)] active:scale-95 inline-flex items-center gap-1 shrink-0"
                                style={{
                                  background: 'var(--bg-input)',
                                  borderColor: copiedOrderNumber === order.order_number ? 'var(--positive-border)' : 'var(--border)',
                                  color: copiedOrderNumber === order.order_number ? 'var(--positive)' : 'var(--text-primary)',
                                }}
                                title="Rendelésszám másolása (Copy order number)"
                              >
                                {copiedOrderNumber === order.order_number ? (
                                  <>
                                    <svg className="w-3.5 h-3.5 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                    <span>Másolva</span>
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                    <span>Másolás</span>
                                  </>
                                )}
                              </button>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Teljes név</p>
                              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{customerName}</p>
                            </div>

                            {customerEmail && (
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>E-mail cím</p>
                                <a href={`mailto:${customerEmail}`} className="text-xs font-medium hover:underline break-all" style={{ color: 'var(--text-accent)' }}>
                                  {customerEmail}
                                </a>
                              </div>
                            )}

                            {customerPhone && (
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Telefonszám</p>
                                <a href={`tel:${customerPhone}`} className="text-xs font-mono font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                                  {customerPhone}
                                </a>
                              </div>
                            )}

                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Fiók azonosító</p>
                              <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{order.user_id || profile?.id}</p>
                            </div>
                          </div>

                          {customerNotes && (
                            <div className="mt-3 pt-2.5 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Megjegyzés</p>
                              <p className="italic leading-relaxed p-2 rounded-lg border text-[11px]" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                                &ldquo;{customerNotes}&rdquo;
                              </p>
                            </div>
                          )}
                        </div>

                        {/* 2. Shipping Detailed Address */}
                        <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                              <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Szállítási cím
                              </p>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-accent)' }}>
                                {shipMode}
                              </span>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Címzett</p>
                              <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{order.shipping_name || customerName}</p>
                            </div>

                            {(shipPostalCode || shipCity) ? (
                              <div className="space-y-1">
                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Irányítószám & Település</p>
                                  <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {shipPostalCode} {shipCity}
                                  </p>
                                </div>
                                {shipStreet && (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Utca, házszám / Helyszín</p>
                                    <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                      {shipStreet}
                                    </p>
                                  </div>
                                )}
                                {shipLockerCode && (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Automata azonosító</p>
                                    <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border inline-block" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}>
                                      {shipLockerCode}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Cím adatok</p>
                                <p className="text-xs font-medium leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>
                                  {order.shipping_address || 'Nincs megadva'}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Tracking Highlight Box */}
                          {order.tracking_number ? (
                            <div
                              className="mt-3 p-2.5 rounded-xl border flex items-center justify-between gap-2"
                              style={{
                                background: 'var(--accent-muted)',
                                borderColor: 'var(--accent-border)',
                              }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                  <line x1="12" y1="22.08" x2="12" y2="12" />
                                </svg>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-accent)' }}>
                                    {order.courier_name ? `${order.courier_name} Követés` : 'Csomagkövetési szám'}
                                  </p>
                                  <p className="font-mono text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>
                                    {order.tracking_number}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(order.tracking_number || '');
                                  showToast('Csomagkövetési szám kimásolva!');
                                }}
                                className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition hover:bg-white/10 shrink-0"
                                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                                title="Copy tracking number"
                              >
                                Másolás
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3 pt-2.5 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                              {isDelivered ? 'Csomag sikeresen kézbesítve.' : isShipped ? 'Csomag feladva, szállítás alatt.' : 'A feladás után itt jelenik meg a csomagkövetési szám.'}
                            </div>
                          )}
                        </div>

                        {/* 3. Billing Detailed Address */}
                        <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                              <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Számlázási cím
                              </p>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                                Számla
                              </span>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Számlázási név</p>
                              <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{billName}</p>
                            </div>

                            {billTaxNumber && (
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Adószám (Céges)</p>
                                <p className="text-xs font-mono font-bold" style={{ color: 'var(--text-accent)' }}>{billTaxNumber}</p>
                              </div>
                            )}

                            {(billPostalCode || billCity) ? (
                              <div className="space-y-1">
                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Irányítószám & Település</p>
                                  <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {billPostalCode} {billCity}
                                  </p>
                                </div>
                                {billStreet && (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Utca, házszám</p>
                                    <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                      {billStreet}
                                    </p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Ország</p>
                                  <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                    {billCountry}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>Cím adatok</p>
                                <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                  {order.shipping_address ? 'Megegyezik a szállítási címmel' : 'Magánszemély számlázási cím'}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Payment summary */}
                          <div className="mt-3 pt-2.5 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Fizetés</p>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              Mód: <span className="font-bold">{order.payment_method === 'stripe' ? 'Bankkártya (Stripe)' : (order.payment_method === 'bank_transfer' ? 'Banki átutalás' : (order.payment_method || 'Banki átutalás'))}</span>
                            </p>
                            <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                              Állapot: <span className="font-bold">
                                {(order.payment_status === 'paid' || String(order.payment_status) === 'completed') ? 'Fizetve' : 'Fizetésre vár'}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Ordered Items Table */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                            Rendelt termékek ({itemCount})
                          </p>
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                            {order.seller_name ? `Eladó: ${order.seller_name}` : 'Hivatalos Store készletből'}
                          </span>
                        </div>

                        <div className="border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                            {items.map((item, idx) => {
                              const imgUrl = item.image_path ? (item.image_path.startsWith('http') || item.image_path.startsWith('/') ? item.image_path : getCardImageUrl(item.image_path)) : null;
                              return (
                                <div key={idx} className="p-3.5 flex items-center justify-between gap-4 text-xs" style={{ background: 'var(--bg-surface)' }}>
                                  <div className="flex items-center gap-3.5 min-w-0">
                                    {imgUrl ? (
                                      <img
                                        src={imgUrl}
                                        alt={item.card_name}
                                        className="w-12 h-12 object-contain rounded-xl border shrink-0 p-0.5"
                                        style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                                      />
                                    ) : (
                                      <div
                                        className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
                                        style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                                      >
                                        <svg className="w-5 h-5 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                        </svg>
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <p className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.card_name}</p>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                                        {item.card_number && <span>SKU: {item.card_number}</span>}
                                        {item.set_name && <span>· {item.set_name}</span>}
                                        {item.condition && <span className="px-1.5 py-0.2 rounded border text-[10px]">{item.condition}</span>}
                                        {item.is_foil && <span className="px-1.5 py-0.2 rounded border text-[10px] text-amber-400 border-amber-400/30">Foil</span>}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0">
                                    <p className="font-bold text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                                      {formatPrice((item.price_huf || 0) * (item.quantity || 1))}
                                    </p>
                                    <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                                      {item.quantity || 1} × {formatPrice(item.price_huf || 0)}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Price Breakdown Footer */}
                          <div className="p-3.5 border-t flex flex-col items-end gap-1 text-xs" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                            <div className="flex justify-between w-48 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              <span>Részösszeg:</span>
                              <span className="font-semibold text-right" style={{ color: 'var(--text-secondary)' }}>
                                {formatPrice(items.reduce((sum, i) => sum + (i.price_huf || 0) * (i.quantity || 1), 0))}
                              </span>
                            </div>
                            <div className="flex justify-between w-48 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              <span>Szállítás:</span>
                              <span className="font-semibold text-right" style={{ color: 'var(--text-secondary)' }}>
                                {order.shipping_huf !== undefined ? (order.shipping_huf === 0 ? 'Ingyenes' : formatPrice(order.shipping_huf)) : 'Belefoglalva'}
                              </span>
                            </div>
                            <div className="flex justify-between w-48 text-sm font-black pt-1 border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
                              <span>Végösszeg:</span>
                              <span className="text-[var(--positive)] font-mono">{formatPrice(totalHuf)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Action Footer: Message Store/Seller + Cancel Order + Delete Order */}
                      <div
                        className="flex items-center justify-between pt-4 border-t text-xs flex-wrap gap-3"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isChatting}
                            onClick={() => handleStartOrderChat(order)}
                            className="px-3.5 py-2 rounded-xl font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs hover:border-[var(--accent)]"
                            style={{
                              background: 'var(--accent-muted)',
                              borderColor: 'var(--accent-border)',
                              color: 'var(--text-accent)',
                            }}
                          >
                            <svg className={`w-3.5 h-3.5 ${isChatting ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            <span>{isChatting ? 'Opening Chat...' : (order.seller_id ? 'Üzenet az eladónak' : 'Üzenet a boltnak')}</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {!isShipped && !isDelivered && !isCancelled && (
                            <button
                              type="button"
                              onClick={() => handleCancelOrder(order.order_number)}
                              disabled={cancellingOrderNumber === order.order_number}
                              className="px-3 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                              <span>
                                {cancellingOrderNumber === order.order_number ? 'Lemondás…' : 'Rendelés lemondása'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteOrder(order.order_number || order.id)}
                            disabled={deletingOrderNumber === (order.order_number || order.id)}
                            className="px-3 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            <span>
                              {deletingOrderNumber === (order.order_number || order.id) ? 'Törlés…' : 'Törlés a listából'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Post-Delivery Rating Section - each side rates the other */}
                      {isDelivered && profile && (order.user_id === profile.id || order.seller_id === profile.id) && (() => {
                        const asBuyer = order.user_id === profile.id;
                        const isStoreOrder = !order.seller_id || order.seller_id === 'platform-owner' || String(order.order_number || '').startsWith('ORD-');
                        const mine = reviewsByOrder[order.order_number];

                        if (isStoreOrder) {
                          if (!asBuyer) return null;
                          return (
                            <div
                              className="pt-3 mt-3 border-t flex items-center justify-between flex-wrap gap-2 text-xs"
                              style={{ borderColor: 'var(--border-subtle)' }}
                            >
                              <span style={{ color: 'var(--text-secondary)' }}>
                                <span className="font-bold text-[var(--positive)]">Kézbesítve.</span>{' '}
                                Elégedett vagy a rendeléssel? Értékeld áruházunkat!
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowGoogleReviewModal(true)}
                                className="px-3.5 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10"
                                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                                </svg>
                                <span>Google Értékelés</span>
                              </button>
                            </div>
                          );
                        }

                        return (
                          <div
                            className="pt-3 mt-3 border-t flex items-center justify-between flex-wrap gap-2 text-xs"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            {mine ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <Stars value={mine.rating} size={14} />
                                <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>
                                  Értékelésed: {mine.rating.toFixed(1)}
                                </span>
                                {mine.comment && (
                                  <span className="italic" style={{ color: 'var(--text-tertiary)' }}>&ldquo;{mine.comment}&rdquo;</span>
                                )}
                              </div>
                            ) : (
                              <>
                                <span style={{ color: 'var(--text-secondary)' }}>
                                  <span className="font-bold text-[var(--positive)]">Kézbesítve.</span>{' '}
                                  Hogy tetszett a {asBuyer ? 'vásárlás' : 'vevő'}?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setRatingModalOrder(order)}
                                  className="px-3.5 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs"
                                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                                >
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                  </svg>
                                  <span>Értékelés ({asBuyer ? 'Eladó' : 'Vevő'})</span>
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Profile Settings Modal (Name, Country, Avatar, Banner & Socials) */}
      <AvatarBannerModal
        open={showAppearanceModal}
        onClose={() => setShowAppearanceModal(false)}
        currentAvatarUrl={profile.avatar_url}
        currentBannerUrl={bannerUrl}
        displayName={profile.display_name || profile.email || 'Collector'}
        currentCountry={profile.country || 'HU'}
        initialSocialProfiles={socialProfiles}
        onSaved={({ display_name, country, avatar_url, banner_url, social_profiles }) => {
          setProfile(prev => (prev ? { ...prev, display_name, country, avatar_url, banner_url, social_profiles } : prev));
          setBannerUrl(banner_url);
          setDisplayName(display_name);
          setCountry(country);
          if (social_profiles) setSocialProfiles(social_profiles);
          showToast('Profile settings saved successfully!');
        }}
      />

      {/* Rate the other side of a completed order */}
      <RateTradeModal
        open={Boolean(ratingModalOrder)}
        onClose={() => setRatingModalOrder(null)}
        orderNumber={ratingModalOrder?.order_number || ''}
        direction={ratingModalOrder && profile && ratingModalOrder.user_id !== profile.id ? 'seller_to_buyer' : 'buyer_to_seller'}
        counterpartName={ratingModalOrder && profile && ratingModalOrder.user_id !== profile.id ? ratingModalOrder.customer_info?.name : ratingModalOrder?.seller_name}
        onDone={(review) => {
          setReviewsByOrder(prev => ({ ...prev, [review.order_number]: review }));
          showToast('Thanks for the rating!');
        }}
      />

      {/* Google Review Modal (Placeholder until official company registration) */}
      {showGoogleReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div
            className="relative w-full max-w-md rounded-2xl p-6 border shadow-2xl space-y-4"
            style={{
              background: 'var(--bg-surface)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[var(--text-primary)]">Google Értékelés</h3>
                  <p className="text-xs text-[var(--text-tertiary)]">TCGXchange hivatalos webáruház</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGoogleReviewModal(false)}
                className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition cursor-pointer"
                aria-label="Bezárás"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 rounded-xl border bg-amber-500/10 border-amber-500/20 text-xs text-amber-200/90 leading-relaxed space-y-2">
              <p className="font-bold text-amber-100 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Cégbejegyzés és Google Cégem profil folyamatban
              </p>
              <p>
                Hamarosan elérhető lesz a hivatalos Google Cégem oldalunk! A cégbejegyzés lezárulása után a vásárlók közvetlenül a Google-ön értékelhetik a webáruházat és a szolgáltatásainkat.
              </p>
            </div>

            <div className="text-xs text-[var(--text-secondary)] space-y-2">
              <p>
                Addig is, ha észrevételed, visszajelzésed vagy segítségre van szükséged a rendeléssel kapcsolatban, fordulj hozzánk közvetlenül:
              </p>
              <a
                href="mailto:support@tcgxchange.net"
                className="inline-flex items-center gap-1.5 font-semibold text-[var(--accent-strong)] hover:underline"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                support@tcgxchange.net
              </a>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGoogleReviewModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--accent-contrast)'
                }}
              >
                Rendben, köszönöm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {showQrModal && profile && (
        <ProfileQrModal
          userId={profile.id}
          displayName={profile.display_name || 'Collector'}
          onClose={() => setShowQrModal(false)}
        />
      )}
      {toastAnim.rendered && toastMessageRef.current && (
        <div
          data-state={toastAnim.state}
          className="tv-toast fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2.5 border"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)'
          }}
        >
          <span className="w-2 h-2 rounded-full shadow-[0_0_8px_var(--accent)]" style={{ background: 'var(--accent-strong)' }} />
          <span>{toastMessageRef.current}</span>
        </div>
      )}
    </div>
  );
}
