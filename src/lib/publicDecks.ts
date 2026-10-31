import { supabase } from './supabase';
import type { DeckState } from '../components/deck-builder/useDeckBuilder';
import type { GameId } from './deckRules';

export interface PublicDeckSummary {
  id: string;
  name: string;
  game: GameId;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  owner_name: string;
  owner_avatar: string | null;
  legend_card: { id: string; name: string; image_path: string | null; domain?: string | null } | null;
  champion_card: { id: string; name: string; image_path: string | null; domain?: string | null } | null;
  deck?: DeckState;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function publishDeck(name: string, game: GameId, deck: DeckState): Promise<{ success: boolean; error?: string; deck?: PublicDeckSummary }> {
  const headers = await authHeaders();
  if (!headers.Authorization) {
    return { success: false, error: 'No active user session. Please sign in again.' };
  }
  const res = await fetch('/api/decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ name, game, deck, is_public: true }),
  });
  const json = await res.json().catch(() => ({ success: false, error: 'Invalid server response.' }));
  return json;
}

export async function updatePublishedDeck(nameOrId: string, name: string, game: GameId, deck: DeckState): Promise<{ success: boolean; error?: string; deck?: PublicDeckSummary }> {
  const headers = await authHeaders();
  if (!headers.Authorization) {
    return { success: false, error: 'No active user session. Please sign in again.' };
  }
  const res = await fetch(`/api/decks/${nameOrId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ name, game, deck }),
  });
  const json = await res.json().catch(() => ({ success: false, error: 'Invalid server response.' }));
  return json;
}

export async function fetchMyDecks(): Promise<PublicDeckSummary[]> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.user?.id) return [];
  const headers = await authHeaders();
  const res = await fetch(`/api/decks?user_id=${session.user.id}`, { headers });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function fetchPublicDecksForUser(userId: string): Promise<PublicDeckSummary[]> {
  const res = await fetch(`/api/decks?user_id=${userId}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data || []).filter((d: PublicDeckSummary) => d.is_public);
}

export async function browsePublicDecks(opts: { game?: string; search?: string; page?: number; pageSize?: number } = {}): Promise<{ data: PublicDeckSummary[]; count: number }> {
  const params = new URLSearchParams();
  if (opts.game && opts.game !== 'all') params.set('game', opts.game);
  if (opts.search) params.set('search', opts.search);
  params.set('page', String(opts.page || 1));
  params.set('pageSize', String(opts.pageSize || 24));
  const res = await fetch(`/api/decks?${params.toString()}`);
  if (!res.ok) return { data: [], count: 0 };
  const json = await res.json();
  return { data: json.data || [], count: json.count || 0 };
}

export async function fetchDeckById(id: string): Promise<PublicDeckSummary | null> {
  const headers = await authHeaders();
  const res = await fetch(`/api/decks/${id}`, { headers });
  if (!res.ok) return null;
  const json = await res.json();
  return json.deck || null;
}

export async function setDeckVisibility(id: string, isPublic: boolean): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers.Authorization) return false;
  const res = await fetch(`/api/decks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ is_public: isPublic }),
  });
  return res.ok;
}

export async function deletePublishedDeck(id: string): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers.Authorization) return false;
  const res = await fetch(`/api/decks/${id}`, { method: 'DELETE', headers });
  return res.ok;
}
