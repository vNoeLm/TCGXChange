import React, { useState, useEffect, useMemo, useRef } from 'react';
import { cardThumbProps, supabase } from '../../lib/supabase';
import { fetchSellerRatingSummary, fetchReputation } from '../../lib/reviews';
import { ReputationBreakdown, ReviewCard, Stars } from '../reviews/ReviewParts';
import { getSellerTier, BadgeIconSvg, SiteOwnerTag } from '../../lib/badges';
import { BannerContainerBackground } from './AvatarBannerModal';
import { SocialProfileButtons } from './SocialProfileButtons';
import { useSiteTheme } from '../../lib/theme';
import { fetchPublicDecksForUser, type PublicDeckSummary } from '../../lib/publicDecks';
import { STORAGE_KEYS, EVENTS } from '../../lib/constants';
import { getCurrentUser, getCurrentProfile, isProfileAdmin } from '../../lib/auth';
import { ReportModal } from '../common/ReportModal';
import { ProfileQrModal } from './ProfileQrModal';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { useLanguage } from '../../lib/i18n';
import type { SellerProfileSummary, UserReputation, UserSocialProfiles } from '../../types';

const DOMAIN_COLORS: Record<string, string> = {
  fury: '#ef4444', calm: '#22c55e', mind: '#3b82f6',
  body: '#f97316', chaos: '#a855f7', order: '#eab308', colorless: '#94a3b8',
};

export function PublicProfileApp() {
  const { t, lang } = useLanguage();
  const [userId, setUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SellerProfileSummary | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [reviewTab, setReviewTab] = useState<'buyer_to_seller' | 'seller_to_buyer'>('buyer_to_seller');
  const [decks, setDecks] = useState<PublicDeckSummary[]>([]);
  const [socialProfiles, setSocialProfiles] = useState<UserSocialProfiles | null>(null);
  const [loading, setLoading] = useState(true);

  // Collections state
  const [publicCollections, setPublicCollections] = useState<Array<{ id: string; name: string; count: number; uniqueCount: number; isPersonal: boolean }>>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionCardsMap, setCollectionCardsMap] = useState<Record<string, number>>({});
  const [collectionCardDetails, setCollectionCardDetails] = useState<any[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionSwitcherOpen, setCollectionSwitcherOpen] = useState(false);
  const collectionSwitcherRef = useRef<HTMLDivElement>(null);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);

  // Collection filters
  const [collSearch, setCollSearch] = useState('');
  const [collDomain, setCollDomain] = useState<string>('all');
  const [collRarity, setCollRarity] = useState<string>('all');
  const [collCost, setCollCost] = useState<string>('all');
  const [collVariant, setCollVariant] = useState<'all' | 'normal' | 'foil'>('all');
  const [collSort, setCollSort] = useState<'default' | 'name' | 'cost_asc' | 'cost_desc' | 'copies_desc'>('default');

  const urlTab = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
  const [contentTab, setContentTab] = useState<'collection' | 'sale' | 'decks'>(
    urlTab === 'decks' ? 'decks' : urlTab === 'sale' ? 'sale' : 'collection'
  );
  const isLightTheme = useSiteTheme().theme === 'light';
  // Viewing your own profile: say so, with a way back to the editable one.
  const [isMe, setIsMe] = useState(false);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    if (!collectionSwitcherOpen) return;
    const close = (e: MouseEvent) => {
      if (!collectionSwitcherRef.current?.contains(e.target as Node)) {
        setCollectionSwitcherOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCollectionSwitcherOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [collectionSwitcherOpen]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) getCurrentUser().then(u => setIsMe(Boolean(u && u.id === id)));
    getCurrentProfile()
      .then(p => setViewerIsAdmin(isProfileAdmin(p)))
      .catch(() => {});
  }, []);

  const [displayedBadges, setDisplayedBadges] = useState<string[]>(['riftbound']);
  const [collectionStatsByGame, setCollectionStatsByGame] = useState<Record<string, { owned: number; total: number; weightedPercentage: number }>>({});

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    setUserId(id);
    if (!id) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const getJson = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
        const [sum, revs, publicDecks, listingsJson, statsJson, profileJson, collsJson] = await Promise.all([
          fetchSellerRatingSummary(id),
          fetchReputation(id),
          fetchPublicDecksForUser(id),
          getJson(`/api/marketplace/listings?seller_id=${id}`),
          getJson(`/api/profile/collection-stats?user_id=${id}`),
          getJson(`/api/profile?id=${encodeURIComponent(id)}`),
          getJson(`/api/profile/collections?user_id=${id}`),
        ]);
        setSummary(sum);
        if (profileJson?.banner_url) setBannerUrl(profileJson.banner_url);
        if (Array.isArray(profileJson?.displayed_badges)) setDisplayedBadges(profileJson.displayed_badges);
        if (profileJson?.social_profiles) setSocialProfiles(profileJson.social_profiles);
        setReputation(revs);
        // Open on whichever side they've actually been rated in.
        if (revs.as_seller.count === 0 && revs.as_buyer.count > 0) setReviewTab('seller_to_buyer');
        setDecks(publicDecks);
        if (listingsJson) setListings((listingsJson.data || []).filter((l: any) => l.status !== 'Sold'));
        if (statsJson?.success) setCollectionStatsByGame(statsJson.data);
        if (collsJson?.success) {
          setPublicCollections(collsJson.collections || []);
          setActiveCollectionId(collsJson.activeCollectionId || null);
          setCollectionCardsMap(collsJson.cardsMap || {});
          setCollectionCardDetails(collsJson.cardDetails || []);
          // If no tab was specified in URL, default to collection if it has cards, else sale if listings exist
          if (!urlTab) {
            if (collsJson.collections?.length > 0) {
              setContentTab('collection');
            } else if (listingsJson?.data?.length > 0) {
              setContentTab('sale');
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load profile:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelectCollection = async (collectionId: string) => {
    if (!userId || collectionId === activeCollectionId) {
      setCollectionSwitcherOpen(false);
      return;
    }
    setCollectionSwitcherOpen(false);
    setCollectionLoading(true);
    try {
      const res = await fetch(`/api/profile/collections?user_id=${userId}&collection_id=${collectionId}`).then(r => r.json());
      if (res?.success) {
        setActiveCollectionId(res.activeCollectionId);
        setCollectionCardsMap(res.cardsMap || {});
        setCollectionCardDetails(res.cardDetails || []);
      }
    } catch (e) {
      console.warn('Failed to switch collection:', e);
    } finally {
      setCollectionLoading(false);
    }
  };

  const totalPublicCopies = publicCollections.reduce((sum, c) => sum + (c.count || 0), 0);
  const activeCollection = publicCollections.find((c) => c.id === activeCollectionId) || publicCollections[0] || null;

  const cardsInActiveCollection = useMemo(() => {
    return collectionCardDetails.map((c) => {
      const normalCount = Number(collectionCardsMap[c.id]) || 0;
      const foilCount = Number(collectionCardsMap[`${c.id}_foil`]) || 0;
      const totalCopies = normalCount + foilCount;
      return {
        ...c,
        normalCount,
        foilCount,
        totalCopies,
      };
    }).filter((c) => c.totalCopies > 0);
  }, [collectionCardDetails, collectionCardsMap]);

  const filteredCards = useMemo(() => {
    let list = cardsInActiveCollection;

    if (collSearch.trim()) {
      const q = collSearch.trim().toLowerCase();
      list = list.filter((c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.card_number && c.card_number.toLowerCase().includes(q)) ||
        (c.set_code && c.set_code.toLowerCase().includes(q)) ||
        (c.card_type && c.card_type.toLowerCase().includes(q))
      );
    }

    if (collDomain !== 'all') {
      list = list.filter((c) => {
        if (!c.domain) return false;
        const doms = c.domain.toLowerCase().split(',').map((x: string) => x.trim());
        return doms.includes(collDomain.toLowerCase());
      });
    }

    if (collRarity !== 'all') {
      list = list.filter((c) => c.rarity && c.rarity.toLowerCase() === collRarity.toLowerCase());
    }

    if (collCost !== 'all') {
      if (collCost === '6+') {
        list = list.filter((c) => (c.cost ?? 0) >= 6);
      } else {
        list = list.filter((c) => (c.cost ?? 0) === Number(collCost));
      }
    }

    if (collVariant === 'normal') {
      list = list.filter((c) => c.normalCount > 0);
    } else if (collVariant === 'foil') {
      list = list.filter((c) => c.foilCount > 0);
    }

    if (collSort === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (collSort === 'cost_asc') {
      list = [...list].sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));
    } else if (collSort === 'cost_desc') {
      list = [...list].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
    } else if (collSort === 'copies_desc') {
      list = [...list].sort((a, b) => b.totalCopies - a.totalCopies);
    } else {
      // Default sort by set_code, then card_number
      list = [...list].sort((a, b) => {
        const setA = a.set_code || '';
        const setB = b.set_code || '';
        if (setA !== setB) return setA.localeCompare(setB);
        const numA = parseInt(a.card_number || '0', 10);
        const numB = parseInt(b.card_number || '0', 10);
        return (isNaN(numA) ? 0 : numA) - (isNaN(numB) ? 0 : numB);
      });
    }

    return list;
  }, [cardsInActiveCollection, collSearch, collDomain, collRarity, collCost, collVariant, collSort]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-bold text-base animate-pulse" style={{ color: 'var(--text-accent)' }}>
          {t('Loading profile…', 'Profil betöltése…')}
        </span>
      </div>
    );
  }

  if (!userId || !summary) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px)' }}>
        <div
          className="max-w-md mx-auto my-12 p-8 text-center rounded-2xl border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            {t('Collector not found', 'Gyűjtő nem található')}
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
            {t("This profile doesn't exist or is no longer available.", 'Ez a profil nem létezik vagy már nem elérhető.')}
          </p>
          <a
            href="/marketplace"
            className="inline-block px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {t('Browse Marketplace', 'Böngéssz a Piactéren')}
          </a>
        </div>
      </div>
    );
  }

  const isOwner = Boolean(summary.is_owner || summary.role === 'owner');
  const tier = getSellerTier(summary.sales_count || 0, summary.rating_avg, isOwner, isLightTheme);
  const displayName = summary.display_name || t('Collector', 'Gyűjtő');
  const memberSince = summary.created_at
    ? new Date(summary.created_at).toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-US', { year: 'numeric', month: 'long' })
    : null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px) clamp(16px,3vw,24px)' }}>
      {isMe && (
        <div
          className="rounded-xl border px-4 py-2.5 mb-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)' }}
        >
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {t('This is how other collectors see your profile.', 'Így látják más gyűjtők a profilodat.')}
          </span>
          <a
            href="/profile"
            className="h-8 px-3 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            {t('Edit profile', 'Profil szerkesztése')}
          </a>
        </div>
      )}

      {/* Identity */}
      <div
        className="relative rounded-2xl mb-6 border overflow-hidden"
        style={{ borderColor: 'var(--border)', boxShadow: 'var(--shadow-card)' }}
      >
        <BannerContainerBackground bannerUrl={bannerUrl} isLightTheme={isLightTheme} />
        <div className="relative z-10 p-4 sm:p-7 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 sm:gap-5 flex-wrap min-w-0">
            {summary.avatar_url ? (
              <img
                src={summary.avatar_url}
                alt={displayName}
                className="w-16 h-16 rounded-2xl object-cover border-2 shrink-0 bg-zinc-950 shadow-md"
                style={{ borderColor: tier.color }}
              />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black border-2 shrink-0 shadow-md"
                style={{ background: 'var(--bg-surface-2)', borderColor: tier.color, color: 'var(--accent)' }}
              >
                {displayName[0].toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black truncate" style={{ color: 'var(--text-primary)' }}>
                  {displayName}
                </h1>
                {isOwner && <SiteOwnerTag />}
                <span
                  className="text-[10px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider inline-flex items-center gap-1"
                  style={tier.badgeStyle}
                >
                  <BadgeIconSvg iconType={tier.iconType} className="w-3 h-3" />
                  <span>{tier.nameEn}</span>
                </span>
                              </div>

              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  {summary.rating_count > 0 && summary.rating_avg !== null ? (
                    <>
                      <Stars value={summary.rating_avg} size={11} />
                      <span style={{ color: 'var(--text-primary)' }}>{summary.rating_avg.toFixed(1)}</span>
                      <span>{lang === 'hu' ? `eladóként (${summary.rating_count})` : `as seller (${summary.rating_count})`}</span>
                    </>
                  ) : (
                    t('No seller ratings yet', 'Még nincs eladói értékelés')
                  )}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  {summary.buyer_rating_count && summary.buyer_rating_avg != null ? (
                    <>
                      <Stars value={summary.buyer_rating_avg} size={11} />
                      <span style={{ color: 'var(--text-primary)' }}>{summary.buyer_rating_avg.toFixed(1)}</span>
                      <span>{lang === 'hu' ? `vevőként (${summary.buyer_rating_count})` : `as buyer (${summary.buyer_rating_count})`}</span>
                    </>
                  ) : (
                    t('No buyer ratings yet', 'Még nincs vevői értékelés')
                  )}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border text-[var(--positive)]"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                >
                  {lang === 'hu' ? `${summary.items_sold || 0} eladott kártya (${summary.sales_count || 0} eladás)` : `Sold ${summary.items_sold || 0} card${summary.items_sold === 1 ? '' : 's'} (${summary.sales_count || 0} sale${summary.sales_count === 1 ? '' : 's'})`}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  title={t('Completed purchases from other collectors', 'Más gyűjtőktől történt sikeres vásárlások')}
                >
                  {lang === 'hu' ? `${summary.items_bought || 0} vásárolt kártya (${summary.purchases_count || 0} vásárlás)` : `Bought ${summary.items_bought || 0} card${summary.items_bought === 1 ? '' : 's'} (${summary.purchases_count || 0} purchase${summary.purchases_count === 1 ? '' : 's'})`}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border text-indigo-300"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                >
                  {lang === 'hu' ? `${listings.length} aktív hirdetés` : `${listings.length} listed now`}
                </span>
                {memberSince && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                  >
                    {lang === 'hu' ? `Tag ${memberSince} óta` : `Member since ${memberSince}`}
                  </span>
                )}
                <SocialProfileButtons socialProfiles={socialProfiles} size="sm" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="h-8 px-3 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 cursor-pointer transition"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              title={t('Show QR code for in-person trade sharing', 'QR-kód megjelenítése személyes cseréhez')}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
              </svg>
              <span>{t('Share QR', 'QR megosztása')}</span>
            </button>
            {!isMe && (
              <button
                type="button"
                onClick={() => setShowReportModal(true)}
                className="h-8 px-3 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                title={t('Report this collector to moderators', 'Felhasználó jelentése a moderátoroknak')}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
                <span>{t('Report profile', 'Profil jelentése')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Profile tabs */}
      <div className="flex items-center gap-1.5 mb-4" role="tablist" aria-label="Profile content">
        {([
          ['collection', t('Collection', 'Gyűjtemény'), totalPublicCopies],
          ['sale', t('Cards for sale', 'Eladó kártyák'), listings.length],
          ['decks', t('Decks', 'Paklik'), decks.length],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={contentTab === key}
            onClick={() => setContentTab(key)}
            className="h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2"
            style={contentTab === key
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <span>{label}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>{count}</span>
          </button>
        ))}
      </div>

      {contentTab === 'collection' && (
      <div className="mb-8">
        {publicCollections.length === 0 ? (
          <div
            className="p-10 text-center rounded-2xl border flex flex-col items-center gap-3"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="w-12 h-12 rounded-2xl bg-zinc-800/50 flex items-center justify-center text-zinc-500">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold max-w-md" style={{ color: 'var(--text-secondary)' }}>
              {isMe
                ? (lang === 'hu'
                  ? 'Még nem osztottál meg nyilvános gyűjteményt. A Katalógusban a Gyűjtemények kezelése menüpontban bármelyik gyűjteményedet nyilvánossá teheted.'
                  : "You haven't shared any public collections yet. In the Catalog under Manage Collections, you can set your collection to public to share it here.")
                : (lang === 'hu'
                  ? `${displayName} még nem tett közzé nyilvános gyűjteményt.`
                  : `${displayName} hasn't made any collections public yet.`)}
            </p>
            {isMe && (
              <a
                href="/"
                className="h-9 px-4 rounded-xl text-xs font-black inline-flex items-center gap-2 cursor-pointer transition shadow-md"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
                <span>{t('Open Catalog', 'Katalógus megnyitása')}</span>
              </a>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Top Sub-Bar: Collection Selector (if multiple) & Summary */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {publicCollections.length > 1 ? (
                <div ref={collectionSwitcherRef} className="relative inline-flex items-center gap-2">
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={collectionSwitcherOpen}
                    onClick={() => setCollectionSwitcherOpen((o) => !o)}
                    className="h-9 pl-3 pr-2.5 rounded-lg border inline-flex items-center gap-2 text-xs font-bold cursor-pointer max-w-[18rem]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    title={t('Switch public collection', 'Nyilvános gyűjtemény váltása')}
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
                      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    <span className="truncate">{activeCollection?.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      {activeCollection?.count || 0}
                    </span>
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {collectionSwitcherOpen && (
                    <div
                      role="listbox"
                      className="absolute left-0 top-full mt-1.5 z-50 w-64 rounded-xl border shadow-2xl p-1.5"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                    >
                      {publicCollections.map((c) => {
                        const isSelected = c.id === activeCollectionId;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => handleSelectCollection(c.id)}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs cursor-pointer hover:bg-[var(--bg-raised)]"
                            style={isSelected ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' } : { color: 'var(--text-secondary)' }}
                          >
                            <span className="truncate font-bold">{c.name}</span>
                            <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{c.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  <span>{activeCollection?.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    {activeCollection?.count || 0}
                  </span>
                </div>
              )}

              {/* Counter: X of Y cards */}
              <div className="text-xs font-mono font-medium ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                {lang === 'hu'
                  ? `${filteredCards.length} / ${cardsInActiveCollection.length} lap (${filteredCards.reduce((s, c) => s + c.totalCopies, 0)} példány)`
                  : `${filteredCards.length} of ${cardsInActiveCollection.length} cards (${filteredCards.reduce((s, c) => s + c.totalCopies, 0)} copies)`}
              </div>
            </div>

            {/* Riftbound Filter Bar */}
            <div
              className="p-3 rounded-2xl border flex flex-col md:flex-row items-stretch md:items-center gap-2.5 flex-wrap"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              {/* Search input */}
              <div className="relative flex-1 min-w-[12rem]">
                <input
                  type="text"
                  value={collSearch}
                  onChange={(e) => setCollSearch(e.target.value)}
                  placeholder={t('Search cards by name, ID, type…', 'Keresés név, kód, típus szerint…')}
                  className="w-full h-9 pl-8 pr-7 rounded-lg text-xs font-semibold border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <svg className="w-3.5 h-3.5 absolute left-2.5 top-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                {collSearch && (
                  <button
                    type="button"
                    onClick={() => setCollSearch('')}
                    className="absolute right-2 top-2 w-5 h-5 flex items-center justify-center text-xs font-bold rounded-full hover:bg-zinc-800 text-zinc-400 cursor-pointer"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Domain / Color filter */}
              <select
                value={collDomain}
                onChange={(e) => setCollDomain(e.target.value)}
                className="h-9 px-2.5 rounded-lg text-xs font-semibold border outline-none cursor-pointer"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                aria-label="Filter by Domain"
              >
                <option value="all">{t('Domain: All', 'Domén: Mind')}</option>
                <option value="fury">Fury</option>
                <option value="calm">Calm</option>
                <option value="mind">Mind</option>
                <option value="body">Body</option>
                <option value="chaos">Chaos</option>
                <option value="order">Order</option>
                <option value="colorless">{t('Colorless', 'Színtelen')}</option>
              </select>

              {/* Rarity filter */}
              <select
                value={collRarity}
                onChange={(e) => setCollRarity(e.target.value)}
                className="h-9 px-2.5 rounded-lg text-xs font-semibold border outline-none cursor-pointer"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                aria-label="Filter by Rarity"
              >
                <option value="all">{t('Rarity: All', 'Ritkaság: Mind')}</option>
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="epic">Epic</option>
                <option value="legendary">Legendary</option>
              </select>

              {/* Cost filter */}
              <select
                value={collCost}
                onChange={(e) => setCollCost(e.target.value)}
                className="h-9 px-2.5 rounded-lg text-xs font-semibold border outline-none cursor-pointer"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                aria-label="Filter by Cost"
              >
                <option value="all">{t('Cost: All', 'Költség: Mind')}</option>
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6+">6+</option>
              </select>

              {/* Variant filter (All / Normal / Foil) */}
              <div className="inline-flex rounded-lg border overflow-hidden p-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                {(['all', 'normal', 'foil'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setCollVariant(v)}
                    className="h-7 px-2.5 rounded-md text-[11px] font-bold cursor-pointer transition"
                    style={collVariant === v
                      ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' }
                      : { color: 'var(--text-tertiary)' }}
                  >
                    {v === 'all' ? t('All', 'Mind') : v === 'normal' ? 'Normal' : 'Foil'}
                  </button>
                ))}
              </div>

              {/* Sort selector */}
              <select
                value={collSort}
                onChange={(e) => setCollSort(e.target.value as any)}
                className="h-9 px-2.5 rounded-lg text-xs font-semibold border outline-none cursor-pointer"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                aria-label="Sort cards"
              >
                <option value="default">{t('Sort: Default', 'Rendezés: Alapértelmezett')}</option>
                <option value="name">{t('Name (A-Z)', 'Név (A-Z)')}</option>
                <option value="cost_asc">{t('Cost (Low to High)', 'Költség (Növekvő)')}</option>
                <option value="cost_desc">{t('Cost (High to Low)', 'Költség (Csökkenő)')}</option>
                <option value="copies_desc">{t('Copies (High to Low)', 'Példányszám (Csökkenő)')}</option>
              </select>

              {/* Reset button */}
              {(collSearch || collDomain !== 'all' || collRarity !== 'all' || collCost !== 'all' || collVariant !== 'all' || collSort !== 'default') && (
                <button
                  type="button"
                  onClick={() => {
                    setCollSearch('');
                    setCollDomain('all');
                    setCollRarity('all');
                    setCollCost('all');
                    setCollVariant('all');
                    setCollSort('default');
                  }}
                  className="h-9 px-3 rounded-lg border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                  title={t('Reset filters', 'Szűrők visszaállítása')}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M8 16H3v5" />
                  </svg>
                  <span>{t('Reset', 'Alaphelyzet')}</span>
                </button>
              )}
            </div>

            {/* Collection Grid */}
            {collectionLoading ? (
              <div className="flex items-center justify-center p-16">
                <span className="text-xs font-bold animate-pulse" style={{ color: 'var(--text-accent)' }}>
                  {t('Loading collection…', 'Gyűjtemény betöltése…')}
                </span>
              </div>
            ) : filteredCards.length === 0 ? (
              <div
                className="p-10 text-center rounded-2xl border flex flex-col items-center gap-2"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {t('No cards match the selected filters.', 'Nincs a szűrésnek megfelelő kártya.')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCollSearch('');
                    setCollDomain('all');
                    setCollRarity('all');
                    setCollCost('all');
                    setCollVariant('all');
                    setCollSort('default');
                  }}
                  className="mt-1 h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  {t('Reset filters', 'Szűrők visszaállítása')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {filteredCards.map((card) => {
                  const domains = card.domain ? card.domain.split(',').map((x: string) => x.trim().toLowerCase()) : [];
                  return (
                    <div
                      key={card.id}
                      onClick={() => setPreviewCardId(card.id)}
                      className="rounded-2xl border flex flex-col overflow-hidden transition hover:-translate-y-1 hover:shadow-xl cursor-pointer group"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                    >
                      {/* Card Visual / Artwork */}
                      <div className="relative aspect-[2.5/3.5] bg-zinc-950 overflow-hidden">
                        {card.image_path ? (
                          <img
                            {...cardThumbProps(card.image_path, 'gridLarge')}
                            alt={card.name}
                            className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center">
                            <span className="text-xs font-black tracking-widest text-zinc-600">TCG</span>
                            <span className="text-[10px] text-zinc-500 mt-1 line-clamp-2">{card.name}</span>
                          </div>
                        )}

                        {/* Top-left energy / cost */}
                        {card.cost !== null && card.cost !== undefined && (
                          <div className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-zinc-950/85 border border-white/20 backdrop-blur-sm flex items-center justify-center text-xs font-black text-white shadow-md">
                            {card.cost}
                          </div>
                        )}

                        {/* Top-right domain dots */}
                        {domains.length > 0 && (
                          <div className="absolute top-1.5 right-1.5 flex gap-1">
                            {domains.map((d: string) => (
                              <span
                                key={d}
                                className="w-2.5 h-2.5 rounded-full shadow-md"
                                style={{ backgroundColor: DOMAIN_COLORS[d] || '#94a3b8' }}
                                title={d}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Card Info & Signature Riftbound Ownership Split Bar */}
                      <div className="p-2.5 flex flex-col flex-1 justify-between gap-1.5">
                        <div>
                          <div className="text-xs sm:text-sm font-black truncate" style={{ color: 'var(--text-primary)' }} title={card.name}>
                            {card.name}
                          </div>
                          <div className="flex items-center justify-between text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                            <span className="font-mono text-[10px] truncate max-w-[65%]">
                              {card.set_code ? `${card.set_code}-${card.card_number || '000'}` : (card.card_number || '—')}
                              {card.rarity ? ` · ${card.rarity[0]}` : ''}
                            </span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              x{card.totalCopies}
                            </span>
                          </div>
                        </div>

                        {/* Ownership Split Bar - Riftbound Style */}
                        <div className="rounded-lg border overflow-hidden grid grid-cols-2 text-center mt-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                          <div className="py-1 px-1 border-r" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div className="text-[9px] font-mono font-bold tracking-wider" style={{ color: 'var(--text-tertiary)' }}>OWNED</div>
                            <div className="text-xs sm:text-sm font-black" style={{ color: 'var(--text-primary)' }}>{card.normalCount}</div>
                          </div>
                          <div className="py-1 px-1 bg-amber-500/5">
                            <div className="text-[9px] font-mono font-bold tracking-wider text-amber-400">FOIL</div>
                            <div className="text-xs sm:text-sm font-black text-amber-300">{card.foilCount}</div>
                          </div>
                        </div>
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

      {contentTab === 'sale' && (
      <>
      {listings.length === 0 ? (
        <div
          className="p-10 text-center rounded-2xl border mb-8"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {lang === 'hu' ? `${displayName} jelenleg nem hirdet kártyát.` : `${displayName} has no cards listed right now.`}
          </p>
        </div>
      ) : (
        <a
          href={`/marketplace?seller_id=${userId}`}
          className="rounded-2xl border p-4 mb-8 flex items-center gap-4 transition hover:-translate-y-0.5 cursor-pointer"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex -space-x-6 shrink-0">
            {listings.slice(0, 3).map((l, i) => (
              <div
                key={l.inventory_id}
                className="w-14 h-20 rounded-lg overflow-hidden border-2 bg-zinc-950 flex items-center justify-center shrink-0"
                style={{ borderColor: 'var(--bg-surface)', zIndex: 3 - i }}
              >
                {l.image_path ? (
                  <img {...cardThumbProps(l.image_path, 'avatar')} alt={l.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] font-mono text-zinc-500">TCG</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
              {lang === 'hu' ? `${listings.length} eladó kártya` : `${listings.length} card${listings.length === 1 ? '' : 's'} for sale`}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {lang === 'hu' ? `Böngéssz ${displayName} hirdetései között a Piactéren` : `Browse ${displayName}'s listings in the Marketplace`}
            </div>
          </div>
          <svg
            className="w-5 h-5 shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>
      )}
      </>
      )}

      {contentTab === 'decks' && (
      <>
      {decks.length === 0 ? (
        <div
          className="p-10 text-center rounded-2xl border mb-8"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {lang === 'hu' ? `${displayName} még nem tett közzé paklit.` : `${displayName} hasn't published any decks yet.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
          {decks.map(d => {
            const domains = d.legend_card?.domain ? d.legend_card.domain.split(',').map(x => x.trim().toLowerCase()) : [];
            return (
              <a
                key={d.id}
                href={`/decks/view?deck=${d.id}`}
                className="rounded-xl border overflow-hidden transition hover:-translate-y-0.5 cursor-pointer flex flex-col"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex w-full" style={{ aspectRatio: '3 / 4', background: '#09090b' }}>
                  <div className="flex-1 h-full min-w-0">
                    {d.legend_card?.image_path && (
                      <img {...cardThumbProps(d.legend_card.image_path, 'tile')} alt={d.legend_card.name} className="w-full h-full object-cover" />
                    )}
                  </div>
                  {d.champion_card?.image_path && (
                    <div className="flex-1 h-full min-w-0 border-l" style={{ borderColor: 'var(--border)' }}>
                      <img {...cardThumbProps(d.champion_card.image_path, 'tile')} alt={d.champion_card.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-bold truncate mb-0.5" style={{ color: 'var(--text-primary)' }}>{d.name}</div>
                  <div className="flex items-center gap-1">
                    {domains.map(dom => (
                      <div key={dom} className="w-2 h-2 rounded-full" style={{ background: DOMAIN_COLORS[dom] || '#94a3b8' }} title={dom} />
                    ))}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
      </>
      )}

      {/* Social & Community Links */}
      {(() => {
        const hasFb = Boolean(socialProfiles?.facebook_url);
        const hasDiscord = Boolean(socialProfiles?.discord_tag);
        const hasInsta = Boolean(socialProfiles?.instagram_url);
        const hasAnySocial = hasFb || hasDiscord || hasInsta;

        if (!hasAnySocial) return null;

        return (
          <div className="mb-8">
            <h2 className="text-sm font-black uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>{t('Social & Community Links', 'Közösségi és kapcsolati linkek')}</span>
            </h2>

            <div
              className="rounded-2xl border p-4 sm:p-5 flex items-center gap-3 flex-wrap"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <SocialProfileButtons socialProfiles={socialProfiles} size="md" />
            </div>
          </div>
        );
      })()}

      {/* Reviews - how sellers rated them as a buyer, and buyers rated them as a seller */}
      <h2 className="text-sm font-black uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
        {t('Reputation', 'Hírnév')}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {([
          ['buyer_to_seller', t('As a seller', 'Eladóként'), reputation?.as_seller, t('No ratings as a seller yet.', 'Még nincs eladói értékelés.')],
          ['seller_to_buyer', t('As a buyer', 'Vevőként'), reputation?.as_buyer, t('No ratings as a buyer yet.', 'Még nincs vevői értékelés.')],
        ] as const).map(([direction, title, rep, empty]) => (
          <div key={direction} className="rounded-2xl p-4 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>{title}</div>
            {rep ? <ReputationBreakdown direction={direction} rep={rep} emptyText={empty} /> : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mb-3" role="tablist" aria-label="Reviews">
        {([
          ['buyer_to_seller', t('From buyers', 'Vevőktől'), reputation?.as_seller.count || 0],
          ['seller_to_buyer', t('From sellers', 'Eladóktól'), reputation?.as_buyer.count || 0],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={reviewTab === key}
            onClick={() => setReviewTab(key)}
            className="h-8 px-3 rounded-lg text-xs font-bold border cursor-pointer transition"
            style={reviewTab === key
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {label} ({count})
          </button>
        ))}
      </div>
      {(() => {
        const list = (reputation?.reviews || []).filter(r => r.direction === reviewTab);
        if (list.length === 0) {
          return (
            <div className="p-10 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{t('No reviews yet.', 'Még nincsenek értékelések.')}</p>
            </div>
          );
        }
        const handleDeleteReview = viewerIsAdmin
          ? async (reviewId: string) => {
              if (!window.confirm(lang === 'hu' ? 'Biztosan véglegesen törlöd ezt az értékelést?' : 'Delete this review permanently?')) return;
              try {
                const token = (await supabase.auth.getSession()).data.session?.access_token;
                const res = await fetch(`/api/reviews?id=${encodeURIComponent(reviewId)}`, {
                  method: 'DELETE',
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (res.ok && userId) {
                  const [sum, revs] = await Promise.all([
                    fetchSellerRatingSummary(userId),
                    fetchReputation(userId, true),
                  ]);
                  if (sum) setSummary(sum);
                  setReputation(revs);
                }
              } catch {
                // ignore
              }
            }
          : undefined;
        return <div className="space-y-3">{list.map(rev => <ReviewCard key={rev.id} review={rev} onDelete={handleDeleteReview} />)}</div>;
      })()}

      <ReportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        type="profile"
        targetId={userId || ''}
        targetName={displayName}
        targetLink={typeof window !== 'undefined' ? window.location.href : `/user?id=${userId}`}
      />
      {showQrModal && userId && (
        <ProfileQrModal
          userId={userId}
          displayName={displayName}
          onClose={() => setShowQrModal(false)}
        />
      )}
      <CardPreviewOverlay
        cardId={previewCardId}
        onClose={() => setPreviewCardId(null)}
        zIndex={100}
      />
    </div>
  );
}
