import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText, sanitizeUrl, verifyImageMagicBytes, escapeSqlLike } from '../../../lib/sanitize';
import { validateDisplayName } from '../../../lib/profileValidation';
import { COUNTRY_MAP } from '../../../lib/countries';
import { parseProfileParam } from '../../../lib/profileUrl';
import { computeCustomerTierFromOrders, type CustomerStats, type SellerStats } from '../../../lib/badges';
import { isStoreOrder } from '../../../lib/orderClassification';
import { MODERATOR_ROLES_KEY } from '../../../lib/moderatorRolesServer';
import { getEffectiveRole, normalizeModeratorGames } from '../../../lib/roles';

export const prerender = false;

const BANNERS_KEY = 'user_banners';
const DISPLAYED_BADGES_KEY = 'user_displayed_badges';
const SOCIAL_PROFILES_KEY = 'user_social_profiles';
const ALLOWED_BADGE_GAMES = new Set(['riftbound', 'mtg', 'onepiece', 'lorcana', 'starwars', 'fab']);

async function loadBannersMap(): Promise<Record<string, string>> {
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', BANNERS_KEY)
      .maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

async function saveBannersMap(map: Record<string, string>): Promise<void> {
  await supabaseAdmin
    .from('settings')
    .upsert({ key: BANNERS_KEY, value: JSON.stringify(map) });
}

async function loadDisplayedBadgesMap(): Promise<Record<string, string[]>> {
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', DISPLAYED_BADGES_KEY)
      .maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

async function saveDisplayedBadgesMap(map: Record<string, string[]>): Promise<void> {
  await supabaseAdmin
    .from('settings')
    .upsert({ key: DISPLAYED_BADGES_KEY, value: JSON.stringify(map) });
}

async function loadSocialProfilesMap(): Promise<Record<string, any>> {
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SOCIAL_PROFILES_KEY)
      .maybeSingle();
    if (data?.value) {
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

async function saveSocialProfilesMap(map: Record<string, any>): Promise<void> {
  await supabaseAdmin
    .from('settings')
    .upsert({ key: SOCIAL_PROFILES_KEY, value: JSON.stringify(map) });
}

function generateVerificationCode(userId: string, name?: string | null): string {
  const shortId = userId.replace(/-/g, '').substring(0, 6).toUpperCase();
  const cleanName = (name || 'USER').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
  return `TCGXCHANGE:${cleanName}#${shortId}`;
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  try {
    if (!raw) return fallback;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (parsed && typeof parsed === 'object') ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function computeUserCustomerStatsFromData(userId: string, storeOrdersRaw: unknown, dbRows: any[] | null): CustomerStats {
  const byNumber = new Map<string, any>();

  try {
    const parsed = typeof storeOrdersRaw === 'string' ? JSON.parse(storeOrdersRaw) : storeOrdersRaw;
    if (Array.isArray(parsed)) {
      for (const o of parsed) {
        if (o?.order_number && o?.user_id === userId && isStoreOrder(o)) {
          byNumber.set(String(o.order_number), o);
        }
      }
    }
  } catch {}

  if (Array.isArray(dbRows)) {
    for (const row of dbRows) {
      if (row?.order_number && isStoreOrder(row as any)) {
        const existing = byNumber.get(String(row.order_number));
        byNumber.set(String(row.order_number), existing ? { ...row, ...existing } : row);
      }
    }
  }

  return computeCustomerTierFromOrders([...byNumber.values()]);
}

interface ProfileReviewItem {
  id: string;
  order_number: string;
  direction: 'buyer_to_seller' | 'seller_to_buyer';
  rating: number;
  scores: Record<string, number> | null;
  comment: string | null;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
  created_at: string;
}

async function fetchUserTradeReputation(userId: string): Promise<{
  sellerStats: SellerStats;
  reviews: ProfileReviewItem[];
  activeListingsCount: number;
}> {
  const [salesRes, purchasesRes, reviewsRes, listingsCountRes] = await Promise.all([
    supabaseAdmin
      .from('hold_requests')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', userId)
      .eq('status', 'completed')
      .then((r) => r, () => ({ count: 0, error: true } as any)),
    supabaseAdmin
      .from('hold_requests')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', userId)
      .eq('status', 'completed')
      .then((r) => r, () => ({ count: 0, error: true } as any)),
    supabaseAdmin
      .from('user_reviews')
      .select('id, order_number, direction, rating, scores, comment, reviewer_name, reviewer_avatar, created_at')
      .eq('reviewee_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then((r) => r, () => ({ data: [], error: true } as any)),
    supabaseAdmin
      .from('marketplace_listings')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', userId)
      .eq('status', 'In Stock')
      .gt('quantity', 0)
      .is('deleted_at', null)
      .then((r) => r, () => ({ count: 0, error: true } as any)),
  ]);

  const rawReviews = Array.isArray(reviewsRes?.data) ? reviewsRes.data : [];
  let sellerSum = 0;
  let sellerCount = 0;
  let buyerSum = 0;
  let buyerCount = 0;

  const reviews: ProfileReviewItem[] = [];
  for (const r of rawReviews) {
    const val = Number(r.rating);
    if (!Number.isFinite(val)) continue;
    const dir = r.direction === 'seller_to_buyer' ? 'seller_to_buyer' : 'buyer_to_seller';
    if (dir === 'buyer_to_seller') {
      sellerSum += val;
      sellerCount += 1;
    } else {
      buyerSum += val;
      buyerCount += 1;
    }
    reviews.push({
      id: r.id,
      order_number: r.order_number || '',
      direction: dir,
      rating: val,
      scores: r.scores && typeof r.scores === 'object' ? r.scores : null,
      comment: r.comment || null,
      reviewer_name: r.reviewer_name || null,
      reviewer_avatar: r.reviewer_avatar || null,
      created_at: r.created_at,
    });
  }

  return {
    sellerStats: {
      completed_sales: Math.max(Number(salesRes?.count) || 0, sellerCount),
      completed_purchases: Math.max(Number(purchasesRes?.count) || 0, buyerCount),
      seller_rating_avg: sellerCount > 0 ? Math.round((sellerSum / sellerCount) * 10) / 10 : null,
      seller_rating_count: sellerCount,
      buyer_rating_avg: buyerCount > 0 ? Math.round((buyerSum / buyerCount) * 10) / 10 : null,
      buyer_rating_count: buyerCount,
    },
    reviews,
    activeListingsCount: Number(listingsCountRes?.count) || 0,
  };
}

function parseBlur(bannerUrl?: string | null): number {
  if (!bannerUrl) return 0;
  const hashIdx = bannerUrl.indexOf('#blur=');
  if (hashIdx === -1) return 0;
  const num = parseInt(bannerUrl.slice(hashIdx + 6), 10);
  return isNaN(num) ? 0 : Math.max(0, Math.min(100, num));
}

// GET /api/profile?id=<userIdOrSlug>
export const GET: APIRoute = async ({ url }) => {
  const queryParam = url.searchParams.get('id')?.trim();
  if (!queryParam) return jsonResponse({ success: false, error: 'Missing id' }, 400);

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(queryParam);
  let profile: any = null;

  if (isUuid) {
    const res = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_url, role, is_admin, country')
      .eq('id', queryParam)
      .maybeSingle();
    profile = res.data;
    if (!profile) {
      const fallback = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url, role, is_admin')
        .eq('id', queryParam)
        .maybeSingle();
      profile = fallback.data;
    }
  } else {
    // 1. Try case-insensitive display_name match (e.g. "TCGXChange" or "samuel")
    const safeNamePattern = escapeSqlLike(queryParam, 60);
    if (safeNamePattern && !/[%_]/.test(queryParam)) {
      const res = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, avatar_url, role, is_admin, country')
        .ilike('display_name', safeNamePattern)
        .limit(1)
        .maybeSingle();
      profile = res.data;
      if (!profile) {
        const fallback = await supabaseAdmin
          .from('profiles')
          .select('id, display_name, avatar_url, role, is_admin')
          .ilike('display_name', safeNamePattern)
          .limit(1)
          .maybeSingle();
        profile = fallback.data;
      }
    }

    // 2. If not found, check if it's name-shortid (e.g. "samuel-661484") or short hex id
    if (!profile && queryParam.length >= 6) {
      const parsed = parseProfileParam(queryParam);
      const candidate = parsed.shortId || (queryParam.includes('-') ? (queryParam.split('-').pop() || '') : queryParam);
      if (candidate && /^[0-9a-f]{6,8}$/i.test(candidate)) {
        const shortTarget = candidate.toLowerCase();
        const { data: allProfiles } = await supabaseAdmin
          .from('profiles')
          .select('id, display_name, avatar_url, role, is_admin, country')
          .limit(1000);
        profile = (allProfiles || []).find((p: any) =>
          p.id.replace(/-/g, '').toLowerCase().startsWith(shortTarget)
        ) || null;
      }
    }
  }

  if (!profile) {
    return jsonResponse({ success: false, error: 'Profile not found' }, 404);
  }

  const userId = profile.id;

  const [settingsRes, ordersRes, reputation] = await Promise.all([
    supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', [BANNERS_KEY, DISPLAYED_BADGES_KEY, SOCIAL_PROFILES_KEY, MODERATOR_ROLES_KEY, 'store_orders']),
    supabaseAdmin
      .from('orders')
      .select('order_number, user_id, status, total_huf, subtotal_huf, items, order_type')
      .eq('user_id', userId)
      .then((r) => r, () => ({ data: [] } as any)),
    fetchUserTradeReputation(userId),
  ]);

  const settingsByKey = new Map<string, unknown>();
  for (const row of settingsRes.data || []) {
    settingsByKey.set(row.key, row.value);
  }

  const banners = safeParseJson<Record<string, string>>(settingsByKey.get(BANNERS_KEY), {});
  const badgesMap = safeParseJson<Record<string, string[]>>(settingsByKey.get(DISPLAYED_BADGES_KEY), {});
  const socialMap = safeParseJson<Record<string, any>>(settingsByKey.get(SOCIAL_PROFILES_KEY), {});
  const modRolesRaw = safeParseJson<Record<string, unknown>>(settingsByKey.get(MODERATOR_ROLES_KEY), {});
  const customerStats = computeUserCustomerStatsFromData(userId, settingsByKey.get('store_orders'), ordersRes?.data || null);

  let rawBanner: string | null = banners[userId] || null;
  if (!rawBanner) {
    // Banners set before the shared map existed (or whose map write failed) only live in the
    // account metadata - fall back to it so the banner follows the account to every device.
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      const metaBanner = authUser?.user?.user_metadata?.banner_url;
      if (typeof metaBanner === 'string' && metaBanner.trim()) rawBanner = metaBanner.trim();
    } catch {}
  }
  const displayedBadges = Array.isArray(badgesMap[userId])
    ? badgesMap[userId].filter((g) => ALLOWED_BADGE_GAMES.has(g))
    : ['riftbound'];

  const userSocial = socialMap[userId] || {};
  const vCode = userSocial.verification_code || generateVerificationCode(userId, profile?.display_name);

  const modGames = normalizeModeratorGames(modRolesRaw[userId]);
  const isMod = !profile?.is_admin && profile?.role !== 'owner' && profile?.role !== 'admin' && modGames.length > 0;
  const effectiveRole = getEffectiveRole({
    role: profile?.role,
    is_admin: profile?.is_admin,
    is_owner: Boolean(profile?.is_owner || profile?.role === 'owner'),
    is_moderator: isMod,
    moderator_games: modGames,
  });

  return jsonResponse({
    success: true,
    id: userId,
    profile: {
      id: userId,
      display_name: profile?.display_name || null,
      avatar_url: profile?.avatar_url || null,
      country: profile?.country || 'HU',
      role: effectiveRole,
      is_admin: Boolean(profile?.is_admin || effectiveRole === 'admin' || effectiveRole === 'owner'),
      is_owner: effectiveRole === 'owner',
      is_moderator: effectiveRole === 'moderator',
      moderator_games: effectiveRole === 'moderator' ? modGames : [],
    },
    display_name: profile?.display_name || null,
    avatar_url: profile?.avatar_url || null,
    country: (profile as any)?.country || 'HU',
    banner_url: rawBanner,
    banner_blur: parseBlur(rawBanner),
    displayed_badges: displayedBadges,
    customer_stats: customerStats,
    seller_stats: reputation.sellerStats,
    reviews: reputation.reviews,
    active_listings_count: reputation.activeListingsCount,
    social_profiles: {
      ...userSocial,
      facebook_url: userSocial.facebook_url || null,
      discord_tag: userSocial.discord_tag || null,
      instagram_url: userSocial.instagram_url || null,
    },
  });
};

// PATCH /api/profile { display_name?, avatar_url?, banner_url?, displayed_badges? }
export const PATCH: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonResponse({ success: false, error: 'Invalid request body' }, 400);
  }

  const userId = caller.user.id;
  const profilePatch: Record<string, any> = {};
  const metaPatch: Record<string, any> = { ...(caller.user.user_metadata || {}) };

  if (body.display_name !== undefined) {
    const val = validateDisplayName(body.display_name);
    if (!val.valid || !val.name) {
      return jsonResponse({ success: false, error: val.error || 'Invalid display name.' }, 400);
    }
    const name = val.name;
    profilePatch.display_name = name;
    metaPatch.display_name = name;
    metaPatch.full_name = name;
    metaPatch.name = name;
  }

  if (body.avatar_url !== undefined) {
    const avatarUrl = body.avatar_url ? sanitizeUrl(body.avatar_url) : null;
    profilePatch.avatar_url = avatarUrl;
    metaPatch.avatar_url = avatarUrl;
  }

  if (body.country !== undefined) {
    const country = String(body.country || '').trim().toUpperCase();
    if (!COUNTRY_MAP.has(country)) {
      return jsonResponse({ success: false, error: 'Choose a valid country.' }, 400);
    }
    profilePatch.country = country;
    metaPatch.country = country;
  }

  if (body.banner_url !== undefined) {
    const bannerUrl = body.banner_url ? sanitizeUrl(body.banner_url) : null;
    metaPatch.banner_url = bannerUrl;
    const banners = await loadBannersMap();
    if (bannerUrl) {
      banners[userId] = bannerUrl;
    } else {
      delete banners[userId];
    }
    await saveBannersMap(banners);
  }

  if (Array.isArray(body.displayed_badges)) {
    const cleaned: string[] = Array.from(
      new Set<string>(
        body.displayed_badges
          .map((g: unknown) => String(g || '').toLowerCase())
          .filter((g: string) => ALLOWED_BADGE_GAMES.has(g))
      )
    );
    metaPatch.displayed_badges = cleaned;
    const badgesMap = await loadDisplayedBadgesMap();
    badgesMap[userId] = cleaned;
    await saveDisplayedBadgesMap(badgesMap);
  }

  let updatedSocial: any = undefined;
  if (body.social_profiles !== undefined) {
    const sp = body.social_profiles && typeof body.social_profiles === 'object' ? body.social_profiles : {};
    const socialMap = await loadSocialProfilesMap();
    const existing = socialMap[userId] || {};

    const newFb = sp.facebook_url ? sanitizePlainText(sp.facebook_url, 250).trim() : null;
    const newDiscord = sp.discord_tag ? sanitizePlainText(sp.discord_tag, 100).trim() : null;
    const newInstagram = sp.instagram_url ? sanitizePlainText(sp.instagram_url, 150).trim() : null;
    const newCm = sp.cardmarket_username ? sanitizePlainText(sp.cardmarket_username, 60).trim() : (existing.cardmarket_username || null);

    updatedSocial = {
      ...existing,
      facebook_url: newFb,
      discord_tag: newDiscord,
      instagram_url: newInstagram,
      cardmarket_username: newCm,
      cardmarket_url: newCm ? `https://www.cardmarket.com/en/Magic/Users/${encodeURIComponent(newCm)}` : (existing.cardmarket_url || null),
      cardmarket_sales: sp.cardmarket_sales !== undefined ? (sp.cardmarket_sales ? Math.max(0, parseInt(String(sp.cardmarket_sales), 10) || 0) : null) : (existing.cardmarket_sales || null),
      updated_at: new Date().toISOString(),
    };
    socialMap[userId] = updatedSocial;
    await saveSocialProfilesMap(socialMap);
  }

  if (body.sync_email === true && caller.user.email) {
    profilePatch.email = caller.user.email;
  }

  if (Object.keys(profilePatch).length > 0) {
    await supabaseAdmin
      .from('profiles')
      .upsert({ id: userId, ...profilePatch }, { onConflict: 'id' });
  }

  await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: metaPatch,
  });

  return jsonResponse({
    success: true,
    email: profilePatch.email ?? caller.user.email ?? null,
    display_name: profilePatch.display_name ?? metaPatch.display_name ?? null,
    avatar_url: profilePatch.avatar_url !== undefined ? profilePatch.avatar_url : (metaPatch.avatar_url ?? null),
    country: profilePatch.country ?? metaPatch.country ?? null,
    banner_url: metaPatch.banner_url ?? null,
    displayed_badges: metaPatch.displayed_badges ?? undefined,
    social_profiles: updatedSocial,
  });
};

// POST /api/profile { dataUrl } -> uploads a tiny client-compressed 160x160 WebP avatar (~8 KB)
export const POST: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : '';
  const uploadType = body?.type === 'banner' ? 'banner' : 'avatar';
  const match = dataUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return jsonResponse({ success: false, error: 'Invalid image format. Please upload a PNG, JPG, or WebP image.' }, 400);
  }

  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');

  // Max size: 80 KB for avatar, 350 KB for wide banner
  const maxBytes = uploadType === 'banner' ? 350 * 1024 : 80 * 1024;
  if (buffer.byteLength > maxBytes) {
    return jsonResponse({
      success: false,
      error: uploadType === 'banner' ? 'Compressed banner is too large (max 350 KB).' : 'Compressed avatar is too large (max 80 KB).',
    }, 400);
  }

  // Inspect real binary magic bytes to block disguised SVG/HTML scripts
  const verified = verifyImageMagicBytes(buffer);
  if (!verified.valid) {
    return jsonResponse({ success: false, error: 'Invalid file format. Only genuine WebP, JPEG, or PNG images are allowed.' }, 400);
  }

  const folder = uploadType === 'banner' ? 'banners' : 'avatars';
  const filePath = `${folder}/${caller.user.id}.${verified.ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('card-images')
    .upload(filePath, buffer, {
      contentType: verified.mime,
      upsert: true,
      cacheControl: '3600',
    });

  if (uploadErr) {
    return jsonResponse({ success: false, error: uploadErr.message || 'Storage upload failed.' }, 500);
  }

  const { data: pub } = supabaseAdmin.storage.from('card-images').getPublicUrl(filePath);
  const uploadedUrl = `${pub.publicUrl}?v=${Date.now()}`;

  if (uploadType === 'banner') {
    const metaPatch = {
      ...(caller.user.user_metadata || {}),
      banner_url: uploadedUrl,
    };
    const banners = await loadBannersMap();
    banners[caller.user.id] = uploadedUrl;
    await Promise.all([
      saveBannersMap(banners),
      supabaseAdmin.auth.admin.updateUserById(caller.user.id, { user_metadata: metaPatch }),
    ]);
    return jsonResponse({ success: true, banner_url: uploadedUrl });
  }

  const metaPatch = {
    ...(caller.user.user_metadata || {}),
    avatar_url: uploadedUrl,
  };

  await Promise.all([
    supabaseAdmin.from('profiles').upsert({ id: caller.user.id, avatar_url: uploadedUrl }, { onConflict: 'id' }),
    supabaseAdmin.auth.admin.updateUserById(caller.user.id, { user_metadata: metaPatch }),
  ]);

  return jsonResponse({ success: true, avatar_url: uploadedUrl });
};
