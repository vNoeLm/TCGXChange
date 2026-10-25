import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText, sanitizeUrl, verifyImageMagicBytes } from '../../../lib/sanitize';
import { COUNTRY_MAP } from '../../../lib/countries';

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

function parseBlur(bannerUrl?: string | null): number {
  if (!bannerUrl) return 0;
  const hashIdx = bannerUrl.indexOf('#blur=');
  if (hashIdx === -1) return 0;
  const num = parseInt(bannerUrl.slice(hashIdx + 6), 10);
  return isNaN(num) ? 0 : Math.max(0, Math.min(100, num));
}

// GET /api/profile?id=<userId>
export const GET: APIRoute = async ({ url }) => {
  const userId = url.searchParams.get('id')?.trim();
  if (!userId) return jsonResponse({ success: false, error: 'Missing id' }, 400);

  let { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, avatar_url, role, is_admin, country')
    .eq('id', userId)
    .maybeSingle();

  // Before the country migration is applied the select above fails; everything else on the
  // profile still needs to load, so retry without that column.
  if (!profile) {
    const fallback = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_url, role, is_admin')
      .eq('id', userId)
      .maybeSingle();
    profile = fallback.data as typeof profile;
  }

  const [banners, badgesMap, socialMap] = await Promise.all([
    loadBannersMap(),
    loadDisplayedBadgesMap(),
    loadSocialProfilesMap(),
  ]);

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

  return jsonResponse({
    success: true,
    id: userId,
    display_name: profile?.display_name || null,
    avatar_url: profile?.avatar_url || null,
    country: (profile as any)?.country || 'HU',
    banner_url: rawBanner,
    banner_blur: parseBlur(rawBanner),
    displayed_badges: displayedBadges,
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
    const name = sanitizePlainText(body.display_name, 50);
    if (!name) return jsonResponse({ success: false, error: 'Display name cannot be empty.' }, 400);
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
  const match = dataUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return jsonResponse({ success: false, error: 'Invalid image format. Please upload a PNG, JPG, or WebP image.' }, 400);
  }

  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');

  // Strict 80 KB server cap so avatars never bloat storage
  if (buffer.byteLength > 80 * 1024) {
    return jsonResponse({ success: false, error: 'Compressed avatar is too large (max 80 KB).' }, 400);
  }

  // Inspect real binary magic bytes to block disguised SVG/HTML scripts
  const verified = verifyImageMagicBytes(buffer);
  if (!verified.valid) {
    return jsonResponse({ success: false, error: 'Invalid file format. Only genuine WebP, JPEG, or PNG images are allowed.' }, 400);
  }

  const filePath = `avatars/${caller.user.id}.${verified.ext}`;

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
  const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`;

  const metaPatch = {
    ...(caller.user.user_metadata || {}),
    avatar_url: avatarUrl,
  };

  await Promise.all([
    supabaseAdmin.from('profiles').upsert({ id: caller.user.id, avatar_url: avatarUrl }, { onConflict: 'id' }),
    supabaseAdmin.auth.admin.updateUserById(caller.user.id, { user_metadata: metaPatch }),
  ]);

  return jsonResponse({ success: true, avatar_url: avatarUrl });
};
