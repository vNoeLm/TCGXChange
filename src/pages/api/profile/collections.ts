import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { normalizeCards } from '../../../lib/collectionDefaults';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const countOf = (cards: Record<string, number>) =>
  Object.values(cards).reduce((sum, n) => sum + (Number(n) || 0), 0);

export const GET: APIRoute = async ({ url }) => {
  const userId = url.searchParams.get('user_id');
  const requestedCollectionId = url.searchParams.get('collection_id');

  if (!userId || !/^[0-9a-f-]{32,40}$/i.test(userId)) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid user_id' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const [namedRes, personalCardsRes] = await Promise.all([
      supabaseAdmin
        .from('card_collections')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('user_collections')
        .select('cards')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    const allNamedRows = namedRes.data || [];
    const personalRow = allNamedRows.find((r: any) => r.list_defaults?.is_personal === true);
    const regularNamedRows = allNamedRows.filter((r: any) => !r.list_defaults?.is_personal);

    const publicCollections: Array<{
      id: string;
      name: string;
      count: number;
      uniqueCount: number;
      isPersonal: boolean;
      cards: Record<string, number>;
    }> = [];

    // Check if personal collection is public
    const personalIsPublic = Boolean(personalRow?.is_public ?? personalRow?.list_defaults?.is_public ?? false);
    const personalCards = normalizeCards(personalCardsRes.data?.cards || {});

    if (personalIsPublic) {
      const personalCopies = countOf(personalCards);
      const uniqueCount = Object.keys(personalCards).length;
      publicCollections.push({
        id: 'personal',
        name: personalRow?.name || 'Personal',
        count: personalCopies,
        uniqueCount,
        isPersonal: true,
        cards: personalCards,
      });
    }

    // Check regular named collections
    for (const row of regularNamedRows) {
      const isPublic = Boolean(row.is_public ?? row.list_defaults?.is_public ?? false);
      if (isPublic) {
        const cards = normalizeCards(row.cards || {});
        const copies = countOf(cards);
        const uniqueCount = Object.keys(cards).length;
        publicCollections.push({
          id: row.id,
          name: row.name,
          count: copies,
          uniqueCount,
          isPersonal: false,
          cards,
        });
      }
    }

    if (publicCollections.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          collections: [],
          activeCollectionId: null,
          cardsMap: {},
          cardDetails: [],
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    const activeCollection =
      publicCollections.find((c) => c.id === requestedCollectionId) || publicCollections[0];

    const activeCardsMap = activeCollection.cards;
    const cardIdSet = new Set<string>();
    for (const key of Object.keys(activeCardsMap)) {
      cardIdSet.add(key.replace(/_foil$/, ''));
    }

    const cardIds = Array.from(cardIdSet);
    let cardDetails: any[] = [];

    if (cardIds.length > 0) {
      // Fetch cards in chunks if needed
      const CHUNK_SIZE = 500;
      const chunks: string[][] = [];
      for (let i = 0; i < cardIds.length; i += CHUNK_SIZE) {
        chunks.push(cardIds.slice(i, i + CHUNK_SIZE));
      }

      const results = await Promise.all(
        chunks.map((chunk) =>
          supabaseAdmin
            .from('cards')
            .select('id, name, card_number, set_id, rarity, card_type, domain, cost, image_path, market_price_eur, market_price_foil_eur, game')
            .in('id', chunk)
        )
      );

      for (const res of results) {
        if (res.data) cardDetails.push(...res.data);
      }

      // Fetch set names and codes for these cards
      const setIds = [...new Set(cardDetails.map((c) => c.set_id).filter(Boolean))];
      if (setIds.length > 0) {
        const { data: setRows } = await supabaseAdmin
          .from('sets')
          .select('id, name, code')
          .in('id', setIds);

        const setMap = new Map((setRows || []).map((s: any) => [s.id, s]));
        cardDetails = cardDetails.map((c) => {
          const s = c.set_id ? setMap.get(c.set_id) : null;
          return {
            ...c,
            set_name: s?.name || null,
            set_code: s?.code || null,
          };
        });
      }
    }

    const collectionsSummary = publicCollections.map((c) => ({
      id: c.id,
      name: c.name,
      count: c.count,
      uniqueCount: c.uniqueCount,
      isPersonal: c.isPersonal,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        collections: collectionsSummary,
        activeCollectionId: activeCollection.id,
        cardsMap: activeCardsMap,
        cardDetails,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
