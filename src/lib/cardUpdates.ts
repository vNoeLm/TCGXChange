export interface CardErrataEntry {
  id: string;
  text: string;
  date?: string;
  updated_at: string;
  updated_by_id?: string;
  updated_by_name?: string;
}

export type CardUpdateType = 'errata' | 'legality' | 'card_data';
export type CardUpdateRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CardUpdateRequest {
  id: string;
  card_id: string;
  card_name: string;
  card_number: string;
  set_name?: string | null;
  game: string;
  card_image_path?: string | null;
  update_type: CardUpdateType;
  description: string;
  proposed_errata?: string | null;
  proposed_legality?: Record<string, string> | null;
  source_url?: string | null;
  requester_id: string;
  requester_name: string;
  status: CardUpdateRequestStatus;
  created_at: string;
  reviewed_at?: string;
  reviewed_by_id?: string;
  reviewed_by_name?: string;
  reviewer_note?: string;
}

export const LEGALITY_STATUS_OPTIONS = [
  'Legal',
  'Restricted',
  'Limited',
  'Suspended',
  'Banned',
  'Not legal',
] as const;

export type LegalityStatus = (typeof LEGALITY_STATUS_OPTIONS)[number];

export const FORMATS_BY_GAME: Record<string, string[]> = {
  riftbound: ['Standard', '1v1', '2v2', 'Free-for-All'],
  onepiece: ['Standard', 'Block Rotation'],
  lorcana: ['Core Constructed', 'Infinity'],
  starwars: ['Premier', 'Twin Suns', 'Trilogy'],
  fab: [
    'Classic Constructed',
    'Blitz',
    'Silver Age',
    'Commoner',
    'Living Legend',
    'Ultimate Pit Fight',
  ],
  mtg: ['Standard', 'Pioneer', 'Modern', 'Legacy', 'Vintage', 'Commander', 'Pauper'],
};

export function getFormatsForGame(gameId: string | null | undefined, existingMap?: Record<string, string>): string[] {
  const key = (gameId || 'riftbound').trim().toLowerCase();
  const base = FORMATS_BY_GAME[key] || ['Standard'];
  if (!existingMap) return [...base];
  const extras = Object.keys(existingMap).filter((k) => !base.includes(k));
  return [...base, ...extras];
}

export function getLegalityBadgeStyle(status: string): { bg: string; border: string; text: string } {
  const s = (status || '').trim().toLowerCase();
  if (s === 'legal') {
    return {
      bg: 'rgba(16, 185, 129, 0.14)',
      border: 'rgba(16, 185, 129, 0.4)',
      text: '#34d399',
    };
  }
  if (s === 'restricted' || s === 'limited' || s === 'suspended') {
    return {
      bg: 'rgba(245, 158, 11, 0.14)',
      border: 'rgba(245, 158, 11, 0.42)',
      text: '#fbbf24',
    };
  }
  if (s === 'living legend') {
    return {
      bg: 'rgba(168, 85, 247, 0.14)',
      border: 'rgba(168, 85, 247, 0.4)',
      text: '#c084fc',
    };
  }
  return {
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.35)',
    text: '#fca5a5',
  };
}

export function getCardErrataEntries(card: { metadata?: Record<string, any> | null } | null | undefined): CardErrataEntry[] {
  const meta = card?.metadata;
  if (!meta || typeof meta !== 'object') return [];
  const entries: CardErrataEntry[] = [];
  if (Array.isArray(meta.errata_entries)) {
    for (const item of meta.errata_entries) {
      if (item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim()) {
        entries.push({
          id: String(item.id || `err_${entries.length}`),
          text: item.text.trim(),
          date: typeof item.date === 'string' ? item.date : undefined,
          updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
          updated_by_id: typeof item.updated_by_id === 'string' ? item.updated_by_id : undefined,
          updated_by_name: typeof item.updated_by_name === 'string' ? item.updated_by_name : undefined,
        });
      }
    }
  }
  if (entries.length === 0 && typeof meta.errata === 'string' && meta.errata.trim()) {
    entries.push({
      id: 'legacy_errata',
      text: meta.errata.trim(),
      updated_at: '',
    });
  }
  return entries;
}

export function getCardLegalityMap(card: { game?: string | null; metadata?: Record<string, any> | null } | null | undefined): Record<string, string> {
  const meta = card?.metadata;
  if (!meta || typeof meta !== 'object') return {};
  const map: Record<string, string> = {};
  if (meta.legality && typeof meta.legality === 'object' && !Array.isArray(meta.legality)) {
    for (const [k, v] of Object.entries(meta.legality)) {
      if (k && typeof v === 'string' && v.trim()) {
        map[k] = v.trim();
      }
    }
  }
  if ((card?.game || '').toLowerCase() === 'lorcana' && Array.isArray(meta.legal_formats)) {
    for (const fmt of meta.legal_formats) {
      if (typeof fmt === 'string' && fmt.trim() && !map[fmt.trim()]) {
        map[fmt.trim()] = 'Legal';
      }
    }
  }
  return map;
}
