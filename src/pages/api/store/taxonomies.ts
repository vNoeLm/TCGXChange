import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { STORE_BRANDS, STORE_CATEGORIES, STORE_GAMES } from '../../../lib/storeConstants';
import { STORE_CATEGORY_LABELS_HU } from '../../../lib/i18n';

export interface StoreCategoryItem {
  id: string;
  label: string;
  label_hu?: string;
  description?: string;
}

export interface StoreGameItem {
  id: string;
  name: string;
}

export interface StoreTaxonomies {
  brands?: string[];
  customBrands?: string[];
  categories?: StoreCategoryItem[];
  games?: StoreGameItem[];
  customCategories?: { id: string; label: string; label_hu?: string }[];
  customGames?: { id: string; name: string }[];
}

function getDefaultCategories(): StoreCategoryItem[] {
  return STORE_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    label_hu: c.label_hu || STORE_CATEGORY_LABELS_HU[c.id] || c.label,
    description: c.description || '',
  }));
}

function getDefaultGames(): StoreGameItem[] {
  return STORE_GAMES.map((g) => ({
    id: g.id,
    name: g.name,
  }));
}

export const GET: APIRoute = async () => {
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'store_taxonomies')
      .maybeSingle();

    let taxonomies: StoreTaxonomies = { brands: [], customBrands: [], categories: [], games: [] };
    if (data?.value) {
      try {
        taxonomies = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      } catch {
        // use default
      }
    }

    if (!Array.isArray(taxonomies.brands) || taxonomies.brands.length === 0) {
      taxonomies.brands = Array.from(new Set([...STORE_BRANDS, ...(taxonomies.customBrands || [])])).sort();
    }

    if (!Array.isArray(taxonomies.categories) || taxonomies.categories.length === 0) {
      const merged = getDefaultCategories();
      if (Array.isArray(taxonomies.customCategories)) {
        for (const cc of taxonomies.customCategories) {
          if (!merged.some((m) => m.id === cc.id)) {
            merged.push({ id: cc.id, label: cc.label, label_hu: cc.label_hu || cc.label });
          }
        }
      }
      taxonomies.categories = merged;
    }

    if (!Array.isArray(taxonomies.games) || taxonomies.games.length === 0) {
      const merged = getDefaultGames();
      if (Array.isArray(taxonomies.customGames)) {
        for (const cg of taxonomies.customGames) {
          if (!merged.some((m) => m.id === cg.id)) {
            merged.push({ id: cg.id, name: cg.name });
          }
        }
      }
      taxonomies.games = merged;
    }

    return jsonResponse(taxonomies);
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await getRequestUser(request);
    if (!auth?.isAdmin) return jsonResponse({ error: 'Unauthorized: Admin access required' }, 403);

    const body = await request.json();

    // 1. Dedicated action: delete a brand and reassign any products that were using it to 'None'
    if (body.action === 'delete_brand') {
      const brandToDelete = typeof body.brand === 'string' ? body.brand.trim() : '';
      if (!brandToDelete) return jsonResponse({ error: 'No brand specified' }, 400);

      const { data: reassigned, error: reassignErr } = await supabaseAdmin
        .from('store_products')
        .update({ brand: 'None' })
        .eq('brand', brandToDelete)
        .select('id');

      if (reassignErr) {
        console.error('Failed to reassign products for deleted brand:', reassignErr);
      }

      const { data: settingData } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'store_taxonomies')
        .maybeSingle();

      let currentTax: StoreTaxonomies = { brands: [], customBrands: [], categories: [], games: [] };
      if (settingData?.value) {
        try {
          currentTax = typeof settingData.value === 'string' ? JSON.parse(settingData.value) : settingData.value;
        } catch {}
      }

      const existingBrands = Array.isArray(currentTax.brands) && currentTax.brands.length > 0
        ? currentTax.brands
        : Array.from(new Set([...STORE_BRANDS, ...(currentTax.customBrands || [])]));

      const nextBrands = existingBrands.filter((b) => b !== brandToDelete).sort();
      currentTax.brands = nextBrands;
      currentTax.customBrands = nextBrands;

      await supabaseAdmin.from('settings').upsert({
        key: 'store_taxonomies',
        value: JSON.stringify(currentTax),
      }, { onConflict: 'key' });

      return jsonResponse({
        ok: true,
        deletedBrand: brandToDelete,
        reassignedCount: reassigned?.length || 0,
        taxonomies: currentTax,
      });
    }

    // 2. Dedicated action: delete a category and reassign any products that were using it to 'other'
    if (body.action === 'delete_category') {
      const catToDelete = typeof body.category === 'string' ? body.category.trim().toLowerCase() : '';
      if (!catToDelete) return jsonResponse({ error: 'No category specified' }, 400);
      if (catToDelete === 'other') return jsonResponse({ error: 'Cannot delete default category "other".' }, 400);

      const { data: reassigned, error: reassignErr } = await supabaseAdmin
        .from('store_products')
        .update({ category: 'other' })
        .eq('category', catToDelete)
        .select('id');

      if (reassignErr) {
        console.error('Failed to reassign products for deleted category:', reassignErr);
      }

      const { data: settingData } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'store_taxonomies')
        .maybeSingle();

      let currentTax: StoreTaxonomies = { brands: [], customBrands: [], categories: [], games: [] };
      if (settingData?.value) {
        try {
          currentTax = typeof settingData.value === 'string' ? JSON.parse(settingData.value) : settingData.value;
        } catch {}
      }

      const existingCats = Array.isArray(currentTax.categories) && currentTax.categories.length > 0
        ? currentTax.categories
        : getDefaultCategories();

      const nextCats = existingCats.filter((c) => c.id !== catToDelete);
      currentTax.categories = nextCats;
      currentTax.customCategories = nextCats;

      await supabaseAdmin.from('settings').upsert({
        key: 'store_taxonomies',
        value: JSON.stringify(currentTax),
      }, { onConflict: 'key' });

      return jsonResponse({
        ok: true,
        deletedCategory: catToDelete,
        reassignedCount: reassigned?.length || 0,
        taxonomies: currentTax,
      });
    }

    // 3. Dedicated action: delete a game and reassign any products that were using it to null (Universal)
    if (body.action === 'delete_game') {
      const gameToDelete = typeof body.game === 'string' ? body.game.trim().toLowerCase() : '';
      if (!gameToDelete) return jsonResponse({ error: 'No game specified' }, 400);

      const { data: reassigned, error: reassignErr } = await supabaseAdmin
        .from('store_products')
        .update({ game: null })
        .eq('game', gameToDelete)
        .select('id');

      if (reassignErr) {
        console.error('Failed to reassign products for deleted game:', reassignErr);
      }

      const { data: settingData } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'store_taxonomies')
        .maybeSingle();

      let currentTax: StoreTaxonomies = { brands: [], customBrands: [], categories: [], games: [] };
      if (settingData?.value) {
        try {
          currentTax = typeof settingData.value === 'string' ? JSON.parse(settingData.value) : settingData.value;
        } catch {}
      }

      const existingGames = Array.isArray(currentTax.games) && currentTax.games.length > 0
        ? currentTax.games
        : getDefaultGames();

      const nextGames = existingGames.filter((g) => g.id !== gameToDelete);
      currentTax.games = nextGames;
      currentTax.customGames = nextGames;

      await supabaseAdmin.from('settings').upsert({
        key: 'store_taxonomies',
        value: JSON.stringify(currentTax),
      }, { onConflict: 'key' });

      return jsonResponse({
        ok: true,
        deletedGame: gameToDelete,
        reassignedCount: reassigned?.length || 0,
        taxonomies: currentTax,
      });
    }

    // 4. Saving taxonomies
    const brands: string[] = Array.isArray(body.brands)
      ? Array.from(new Set<string>(body.brands.filter((b: any) => typeof b === 'string' && b.trim()).map((b: string) => b.trim()))).sort()
      : Array.isArray(body.customBrands)
      ? Array.from(new Set<string>(body.customBrands.filter((b: any) => typeof b === 'string' && b.trim()).map((b: string) => b.trim()))).sort()
      : Array.from(new Set<string>([...STORE_BRANDS])).sort();

    const categories: StoreCategoryItem[] = Array.isArray(body.categories)
      ? body.categories
          .filter((c: any) => c && typeof c.id === 'string' && typeof c.label === 'string' && c.id.trim() && c.label.trim())
          .map((c: any) => ({
            id: c.id.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, ''),
            label: c.label.trim(),
            label_hu: (c.label_hu && typeof c.label_hu === 'string') ? c.label_hu.trim() : c.label.trim(),
            description: typeof c.description === 'string' ? c.description.trim() : '',
          }))
      : getDefaultCategories();

    const games: StoreGameItem[] = Array.isArray(body.games)
      ? body.games
          .filter((g: any) => g && typeof g.id === 'string' && typeof g.name === 'string' && g.id.trim() && g.name.trim())
          .map((g: any) => ({
            id: g.id.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, ''),
            name: g.name.trim(),
          }))
      : getDefaultGames();

    const payload: StoreTaxonomies = {
      brands,
      customBrands: brands,
      categories,
      games,
      customCategories: categories,
      customGames: games,
    };

    const { error } = await supabaseAdmin.from('settings').upsert({
      key: 'store_taxonomies',
      value: JSON.stringify(payload),
    }, { onConflict: 'key' });

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true, taxonomies: payload });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
};
