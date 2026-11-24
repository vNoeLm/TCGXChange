import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { getCardImageUrl, isOwnHostedImageUrl, stripOwnCdnPrefix, supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';
import { isPromoCard } from '../../lib/cardVariants';
import { getGameCardEditorSchema } from '../../lib/cardEditorSchema';
import { CardTextPreview } from '../cards/CardTextPreview';
import { CardMarkupHelp } from '../cards/CardMarkupHelp';
import {
  DOMAINS,
  FAB_CLASSES,
  FAB_RARITIES,
  FAB_TYPES,
  LORCANA_INKS,
  LORCANA_RARITIES,
  LORCANA_TYPES,
  MTG_RARITIES,
  MTG_TYPES,
  ONEPIECE_COLORS,
  ONEPIECE_RARITIES,
  ONEPIECE_TYPES,
  RARITIES,
  STARWARS_ASPECTS,
  STARWARS_RARITIES,
  STARWARS_TYPES,
  TYPES,
} from '../../lib/constants';
import { CARDMARKET_GAME_IDS } from '../../lib/cardmarketPrices';

export interface CardEditorModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  card?: any | null;
  defaultGame?: string;
  allowedGames: Array<{ id: string; label: string }>;
  onSaved?: (savedCard: any) => void;
}

interface SetRow {
  id: string;
  code: string;
  name: string;
  release_date: string | null;
  total_cards: number;
  game: string;
}

interface CardmarketHit {
  idProduct: number;
  name: string;
  idExpansion: number | null;
  dateAdded: string | null;
  trend: number | null;
  trendFoil: number | null;
  low: number | null;
}

function getRarityOptions(game: string): string[] {
  switch (game) {
    case 'onepiece':
      return ONEPIECE_RARITIES;
    case 'lorcana':
      return LORCANA_RARITIES;
    case 'starwars':
      return STARWARS_RARITIES;
    case 'fab':
      return FAB_RARITIES;
    case 'mtg':
      return MTG_RARITIES;
    default:
      return RARITIES;
  }
}

function getTypeOptions(game: string): string[] {
  switch (game) {
    case 'onepiece':
      return ONEPIECE_TYPES;
    case 'lorcana':
      return LORCANA_TYPES;
    case 'starwars':
      return STARWARS_TYPES;
    case 'fab':
      return FAB_TYPES;
    case 'mtg':
      return MTG_TYPES;
    default:
      return TYPES;
  }
}

function getDomainOptions(game: string): string[] {
  switch (game) {
    case 'onepiece':
      return ONEPIECE_COLORS;
    case 'lorcana':
      return LORCANA_INKS;
    case 'starwars':
      return STARWARS_ASPECTS;
    case 'fab':
      return FAB_CLASSES;
    default:
      return DOMAINS;
  }
}

export function CardEditorModal({
  open,
  onClose,
  mode,
  card,
  defaultGame = 'riftbound',
  allowedGames,
  onSaved,
}: CardEditorModalProps) {
  const { t } = useLanguage();

  const initialGame =
    mode === 'edit'
      ? (card?.game || 'riftbound').toLowerCase()
      : allowedGames.some((g) => g.id === defaultGame)
      ? defaultGame
      : allowedGames[0]?.id || 'riftbound';

  const [game, setGame] = useState(initialGame);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Card fields
  const [setId, setSetId] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [name, setName] = useState('');
  const [rarity, setRarity] = useState('Common');
  const [isPromo, setIsPromo] = useState(false);
  const [cardType, setCardType] = useState('Unit');
  const [domain, setDomain] = useState('');
  const [subtype, setSubtype] = useState('');
  const [cost, setCost] = useState('');
  const [energy, setEnergy] = useState('');
  const [might, setMight] = useState('');
  const [mightBonus, setMightBonus] = useState('');
  const [artist, setArtist] = useState('');
  const [imagePath, setImagePath] = useState('');
  const [text, setText] = useState('');
  const [ability, setAbility] = useState('');
  const [effect, setEffect] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Cardmarket linking
  const [cardmarketId, setCardmarketId] = useState('');
  const [syncPriceOnSave, setSyncPriceOnSave] = useState(true);
  const [cmSearchOpen, setCmSearchOpen] = useState(false);
  const [cmQuery, setCmQuery] = useState('');
  const [cmExpansion, setCmExpansion] = useState('');
  const [cmLoading, setCmLoading] = useState(false);
  const [cmResults, setCmResults] = useState<CardmarketHit[]>([]);
  const [cmError, setCmError] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [liveSyncedPrice, setLiveSyncedPrice] = useState<{ eur: number | null; eurFoil: number | null } | null>(null);

  // Inline create set form
  const [newSetOpen, setNewSetOpen] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetCode, setNewSetCode] = useState('');
  const [newSetDate, setNewSetDate] = useState('');
  const [newSetTotal, setNewSetTotal] = useState('0');
  const [creatingSet, setCreatingSet] = useState(false);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate form values whenever modal opens or target card changes
  useEffect(() => {
    if (!open) return;
    setError(null);
    setCmError(null);
    setCmResults([]);
    setCmSearchOpen(false);
    setNewSetOpen(false);
    setLiveSyncedPrice(null);

    if (mode === 'edit' && card) {
      const g = (card.game || 'riftbound').toLowerCase();
      setGame(g);
      setSetId(card.set_id || card.sets?.id || '');
      setCardNumber(card.card_number || '');
      setName(card.name || '');
      setRarity(card.rarity || 'Common');
      setIsPromo(Boolean(card.metadata?.is_promo || isPromoCard(card)));
      setCardType(card.card_type || 'Unit');
      setDomain(card.domain || '');
      setSubtype(card.subtype || '');
      setCost(card.cost !== null && card.cost !== undefined ? String(card.cost) : '');
      setEnergy(
        card.energy !== null && card.energy !== undefined
          ? String(card.energy)
          : g === 'riftbound' && card.cost !== null && card.cost !== undefined
          ? String(card.cost)
          : ''
      );
      setMight(card.might !== null && card.might !== undefined ? String(card.might) : '');
      setMightBonus(card.might_bonus !== null && card.might_bonus !== undefined ? String(card.might_bonus) : '');
      setArtist(card.artist || '');
      setImagePath(card.image_path ? getCardImageUrl(card.image_path) : '');
      setText(card.text || '');
      setAbility(card.ability || '');
      setEffect(card.effect || (g === 'onepiece' ? card.text || '' : ''));
      setTags(Array.isArray(card.tags) ? card.tags.map(String) : []);
      setCardmarketId(card.metadata?.cardmarket_id ? String(card.metadata.cardmarket_id) : '');
      setCmQuery(card.name || '');
      setSyncPriceOnSave(Boolean(card.metadata?.cardmarket_id));
      if (card.market_price_eur !== null && card.market_price_eur !== undefined) {
        setLiveSyncedPrice({ eur: card.market_price_eur, eurFoil: card.market_price_foil_eur ?? null });
      }
    } else {
      const g = allowedGames.some((opt) => opt.id === defaultGame)
        ? defaultGame
        : allowedGames[0]?.id || 'riftbound';
      setGame(g);
      setSetId('');
      setCardNumber('');
      setName('');
      setRarity(getRarityOptions(g)[0] || 'Common');
      setIsPromo(false);
      setCardType(getTypeOptions(g)[0] || 'Unit');
      setDomain('');
      setSubtype('');
      setCost('');
      setEnergy('');
      setMight('');
      setMightBonus('');
      setArtist('');
      setImagePath('');
      setText('');
      setAbility('');
      setEffect('');
      setTags([]);
      setCardmarketId('');
      setCmQuery('');
      setCmExpansion('');
      setSyncPriceOnSave(true);
    }
    setTagInput('');
  }, [open, mode, card?.id, defaultGame]);

  // Load sets + tags for selected game
  useEffect(() => {
    if (!open || !game) return;
    let cancelled = false;
    setLoadingMeta(true);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/cards/manage?game=${encodeURIComponent(game)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => null);
        if (cancelled || !res.ok || !json?.success) return;
        const loadedSets: SetRow[] = json.sets || [];
        setSets(loadedSets);
        setAllTags(json.allTags || []);
        if (mode === 'create' && loadedSets.length > 0) {
          setSetId((prev) => (prev && loadedSets.some((s) => s.id === prev) ? prev : loadedSets[loadedSets.length - 1].id));
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, game, mode]);

  const gameSchema = useMemo(() => getGameCardEditorSchema(game), [game]);

  const rarityOptions = useMemo(() => {
    const base = getRarityOptions(game);
    return rarity && !base.includes(rarity) ? [rarity, ...base] : base;
  }, [game, rarity]);

  const typeOptions = useMemo(() => {
    const base = getTypeOptions(game);
    return cardType && !base.includes(cardType) ? [cardType, ...base] : base;
  }, [game, cardType]);

  const domainChoices = useMemo(() => getDomainOptions(game), [game]);

  const suggestedTags = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    const selectedLower = new Set(tags.map((x) => x.toLowerCase()));
    const matches = allTags.filter((tg) => !selectedLower.has(tg.toLowerCase()) && tg.toLowerCase().includes(q));
    matches.sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.localeCompare(b);
    });
    return matches.slice(0, 24);
  }, [allTags, tags, tagInput]);

  const addTag = (raw: string) => {
    const clean = raw.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    if (!tags.some((tg) => tg.toLowerCase() === clean.toLowerCase())) {
      setTags((prev) => [...prev, clean]);
    }
    if (!allTags.some((tg) => tg.toLowerCase() === clean.toLowerCase())) {
      setAllTags((prev) => [...prev, clean].sort((a, b) => a.localeCompare(b)));
    }
    setTagInput('');
  };

  const toggleDomainChip = (chip: string) => {
    const parts = domain
      .split(/[,/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = parts.some((p) => p.toLowerCase() === chip.toLowerCase());
    const next = exists
      ? parts.filter((p) => p.toLowerCase() !== chip.toLowerCase())
      : [...parts, chip];
    setDomain(next.join(', '));
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error(t('Please sign in first.', 'Kérlek jelentkezz be előbb.'));
      const fd = new FormData();
      fd.append('game', game);
      fd.append('file', file);
      const res = await fetch('/api/cards/upload-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !json?.urls?.[0]) {
        throw new Error(json?.error || t('Image upload failed.', 'A képfeltöltés nem sikerült.'));
      }
      setImagePath(json.urls[0]);
    } catch (err: any) {
      setError(err?.message || 'Image upload failed');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleCreateSetInline = async () => {
    if (!newSetName.trim() || !newSetCode.trim()) {
      setError(t('Set name and code are required.', 'A szett neve és kódja kötelező.'));
      return;
    }
    setCreatingSet(true);
    setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'create_set',
          game,
          name: newSetName.trim(),
          code: newSetCode.trim().toUpperCase(),
          release_date: newSetDate.trim() || null,
          total_cards: parseInt(newSetTotal, 10) || 0,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('Failed to create set.', 'Nem sikerült létrehozni a szettet.'));
      }
      const createdSet: SetRow = json.set;
      setSets((prev) => [...prev, createdSet]);
      setSetId(createdSet.id);
      setNewSetName('');
      setNewSetCode('');
      setNewSetDate('');
      setNewSetTotal('0');
      setNewSetOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create set');
    } finally {
      setCreatingSet(false);
    }
  };

  const searchCardmarket = async () => {
    setCmLoading(true);
    setCmError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const params = new URLSearchParams({ game });
      const q = (cmQuery || name).trim();
      if (q) params.set('q', q);
      if (cmExpansion.trim()) params.set('expansion', cmExpansion.trim());
      const res = await fetch(`/api/cards/cardmarket-lookup?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('Cardmarket lookup failed.', 'Cardmarket keresés sikertelen.'));
      }
      if (!json.supported) {
        setCmError(json.message || t('Not supported for this game.', 'Ehhez a játékhoz nincs publikus Cardmarket lista.'));
        setCmResults([]);
      } else {
        setCmResults(json.results || []);
      }
    } catch (err: any) {
      setCmError(err?.message || 'Cardmarket lookup failed');
    } finally {
      setCmLoading(false);
    }
  };

  const syncLivePriceNow = async () => {
    if (mode !== 'edit' || !card?.id) return;
    const cmidNum = parseInt(cardmarketId.trim(), 10);
    if (!Number.isInteger(cmidNum) || cmidNum <= 0) {
      setError(t('Enter a valid Cardmarket Product ID first.', 'Először adj meg egy érvényes Cardmarket Product ID-t.'));
      return;
    }
    setSyncingNow(true);
    setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Signed out');
      const res = await fetch('/api/cards/sync-cardmarket-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ card_id: card.id, cardmarket_id: cmidNum }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('Price sync failed.', 'Árszinkron nem sikerült.'));
      }
      setLiveSyncedPrice(json.syncedPrice || null);
      onSaved?.(json.card);
    } catch (err: any) {
      setError(err?.message || 'Price sync failed');
    } finally {
      setSyncingNow(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!setId) {
      setError(t('Please select or create a set.', 'Válassz ki vagy hozz létre egy szettet.'));
      return;
    }
    if (!name.trim() || !cardNumber.trim()) {
      setError(t('Card name and card number are required.', 'A kártyanév és a kártyaszám kötelező.'));
      return;
    }

    setSaving(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error(t('Please sign in first.', 'Kérlek jelentkezz be előbb.'));

      const parsedCmid = parseInt(cardmarketId.trim(), 10);
      const resolvedCostStr = gameSchema.syncEnergyToCost ? energy.trim() : cost.trim();
      const normalizedImagePath = stripOwnCdnPrefix(imagePath.trim());
      const payload = {
        action: mode === 'create' ? 'create_card' : 'update_card',
        ...(mode === 'edit' && card?.id ? { card_id: card.id } : {}),
        game,
        set_id: setId,
        card_number: cardNumber.trim(),
        name: name.trim(),
        rarity,
        is_promo: isPromo,
        card_type: cardType,
        domain: domain.trim() || null,
        subtype: subtype.trim() || null,
        cost: resolvedCostStr !== '' ? parseInt(resolvedCostStr, 10) : null,
        energy: energy.trim() || null,
        might: might.trim() || null,
        might_bonus: mightBonus.trim() !== '' ? parseInt(mightBonus, 10) : null,
        artist: artist.trim() || null,
        image_path: normalizedImagePath || null,
        text: text.trim() || null,
        ability: ability.trim() || null,
        effect: effect.trim() || null,
        tags,
        cardmarket_id: Number.isInteger(parsedCmid) && parsedCmid > 0 ? parsedCmid : null,
        sync_price: syncPriceOnSave,
      };

      const res = await fetch('/api/cards/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('Failed to save card.', 'Nem sikerült menteni a kártyát.'));
      }
      onSaved?.(json.card);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save card');
    } finally {
      setSaving(false);
    }
  };

  const previewUrl = imagePath.trim() ? getCardImageUrl(imagePath.trim()) : '';
  const isExternalImage = Boolean(imagePath.trim() && /^https?:\/\//i.test(imagePath.trim()) && !isOwnHostedImageUrl(imagePath.trim()));
  const selectedSet = useMemo(() => sets.find((s) => s.id === setId) || null, [sets, setId]);
  const promoSetPreview = useMemo(() => {
    if (!isPromo) return '';
    const baseName = selectedSet?.name?.trim() || '';
    if (!baseName || baseName.toLowerCase() === 'promo') return 'Promo';
    return /\bpromo\b/i.test(baseName) ? baseName : `${baseName} Promo`;
  }, [isPromo, selectedSet]);
  const supportsCardmarket = Boolean(CARDMARKET_GAME_IDS[game]);

  const inputCls = 'w-full min-h-9 px-3 py-1.5 rounded-xl border text-xs outline-none focus:border-[var(--accent)]';
  const inputStyle = {
    background: 'var(--bg-input)',
    borderColor: 'var(--border)',
    color: 'var(--text-primary)',
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeDisabled={saving || syncingNow}
      maxWidth="max-w-3xl"
      zIndexClass="z-[150]"
      title={
        <div className="min-w-0">
          <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
            {mode === 'create'
              ? t('Add New Catalog Card', 'Új kártya hozzáadása a katalógushoz')
              : t('Edit Catalog Card', 'Kártya szerkesztése')}
          </div>
          {mode === 'edit' && card?.name && (
            <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
              {card.name} #{card.card_number}
            </div>
          )}
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs font-bold text-red-300">
            {error}
          </div>
        )}

        {/* Top Game & Set & Identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {t('Game', 'Játék')}
            </label>
            <select
              value={game}
              disabled={mode === 'edit'}
              onChange={(e) => {
                const nextGame = e.target.value;
                setGame(nextGame);
                setRarity(getRarityOptions(nextGame)[0] || 'Common');
                setCardType(getTypeOptions(nextGame)[0] || 'Unit');
              }}
              className={inputCls}
              style={inputStyle}
            >
              {allowedGames.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {t('Set', 'Szett')} *
              </label>
              <button
                type="button"
                onClick={() => setNewSetOpen((v) => !v)}
                className="text-[11px] font-black cursor-pointer hover:underline"
                style={{ color: 'var(--text-accent)' }}
              >
                {newSetOpen ? t('Cancel', 'Mégse') : t('+ New Set', '+ Új szett')}
              </button>
            </div>
            <select
              value={setId}
              onChange={(e) => setSetId(e.target.value)}
              disabled={loadingMeta}
              className={inputCls}
              style={inputStyle}
            >
              <option value="">{loadingMeta ? t('Loading sets...', 'Szettek betöltése...') : t('Select set...', 'Válassz szettet...')}</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Inline Quick New Set Creator */}
        {newSetOpen && (
          <div className="rounded-xl border p-3.5 space-y-2.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--accent-border)' }}>
            <div className="text-xs font-black" style={{ color: 'var(--text-accent)' }}>
              {t('Create New Set / Special Edition', 'Új szett / különkiadás létrehozása')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input
                type="text"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder={t('Name (e.g. K/DA Couture Collection)', 'Név (pl. K/DA Couture Collection)')}
                className={`${inputCls} sm:col-span-2`}
                style={inputStyle}
              />
              <input
                type="text"
                value={newSetCode}
                onChange={(e) => setNewSetCode(e.target.value.toUpperCase())}
                placeholder={t('Code (e.g. KDA)', 'Kód (pl. KDA)')}
                className={inputCls}
                style={inputStyle}
              />
              <input
                type="number"
                min={0}
                value={newSetTotal}
                onChange={(e) => setNewSetTotal(e.target.value)}
                placeholder={t('Total cards', 'Kártyák száma')}
                className={inputCls}
                style={inputStyle}
              />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{t('Release date (optional):', 'Megjelenés dátuma (opcionális):')}</span>
                <input
                  type="date"
                  value={newSetDate}
                  onChange={(e) => setNewSetDate(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border text-xs"
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                disabled={creatingSet}
                onClick={handleCreateSetInline}
                className="min-h-8 px-3.5 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                {creatingSet ? t('Creating...', 'Létrehozás...') : t('Create Set', 'Szett létrehozása')}
              </button>
            </div>
          </div>
        )}

        {/* Name, Number, Rarity + Promo Toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {t('Card Name', 'Kártyanév')} *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('e.g. Ahri, Nine-Tailed Fox', 'pl. Ahri, Nine-Tailed Fox')}
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {t('Card Number', 'Kártyaszám')} *
            </label>
            <input
              type="text"
              required
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="OGN-001/298"
              className={`${inputCls} font-mono`}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {t('Rarity', 'Ritkaság')}
            </label>
            <select value={rarity} onChange={(e) => setRarity(e.target.value)} className={inputCls} style={inputStyle}>
              {rarityOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Promo Toggle Row */}
        <div
          className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border"
          style={{
            background: 'var(--bg-surface-2)',
            borderColor: isPromo ? 'var(--accent-border)' : 'var(--border-subtle)',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              {t('Promo card', 'Promó kártya')}
            </span>
            {promoSetPreview && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-md border truncate"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
              >
                {promoSetPreview}
              </span>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isPromo}
            onClick={() => setIsPromo((v) => !v)}
            className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors"
            style={{
              background: isPromo ? 'var(--accent-strong)' : 'var(--bg-input)',
              borderColor: isPromo ? 'var(--accent-border)' : 'var(--border)',
            }}
          >
            <span
              className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: isPromo ? 'translateX(16px)' : 'translateX(1px)', marginTop: '1px' }}
            />
          </button>
        </div>

        {/* Game-Specific Type, Stats & Artist Row */}
        {(() => {
          const statCount =
            2 +
            (gameSchema.cost ? 1 : 0) +
            (gameSchema.energy ? 1 : 0) +
            (gameSchema.might ? 1 : 0) +
            (gameSchema.mightBonus ? 1 : 0);
          const gridCols =
            statCount >= 6
              ? 'grid-cols-2 sm:grid-cols-6'
              : statCount === 5
              ? 'grid-cols-2 sm:grid-cols-5'
              : statCount === 4
              ? 'grid-cols-2 sm:grid-cols-4'
              : 'grid-cols-1 sm:grid-cols-3';
          return (
            <div className={`grid ${gridCols} gap-3`}>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Type', 'Típus')}
                </label>
                <select value={cardType} onChange={(e) => setCardType(e.target.value)} className={inputCls} style={inputStyle}>
                  {typeOptions.map((tp) => (
                    <option key={tp} value={tp}>{tp}</option>
                  ))}
                </select>
              </div>
              {gameSchema.cost && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    {t(gameSchema.cost.label.en, gameSchema.cost.label.hu)}
                  </label>
                  <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={gameSchema.cost.placeholder} className={inputCls} style={inputStyle} />
                </div>
              )}
              {gameSchema.energy && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    {t(gameSchema.energy.label.en, gameSchema.energy.label.hu)}
                  </label>
                  <input type="text" value={energy} onChange={(e) => setEnergy(e.target.value)} placeholder={gameSchema.energy.placeholder} className={inputCls} style={inputStyle} />
                </div>
              )}
              {gameSchema.might && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    {t(gameSchema.might.label.en, gameSchema.might.label.hu)}
                  </label>
                  <input type="text" value={might} onChange={(e) => setMight(e.target.value)} placeholder={gameSchema.might.placeholder} className={inputCls} style={inputStyle} />
                </div>
              )}
              {gameSchema.mightBonus && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    {t(gameSchema.mightBonus.label.en, gameSchema.mightBonus.label.hu)}
                  </label>
                  <input type="number" value={mightBonus} onChange={(e) => setMightBonus(e.target.value)} placeholder={gameSchema.mightBonus.placeholder} className={inputCls} style={inputStyle} />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Artist', 'Illusztrátor')}
                </label>
                <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder={t('Artist name', 'Illusztrátor neve')} className={inputCls} style={inputStyle} />
              </div>
            </div>
          );
        })()}

        {/* Game-Specific Domain / Color + Subtype */}
        {(gameSchema.domain || gameSchema.subtype) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {gameSchema.domain && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  {t(gameSchema.domain.label.en, gameSchema.domain.label.hu)}
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder={gameSchema.domain.placeholder}
                  className={inputCls}
                  style={inputStyle}
                />
                {domainChoices.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {domainChoices.map((ch) => {
                      const active = domain
                        .split(/[,/]+/)
                        .map((s) => s.trim().toLowerCase())
                        .includes(ch.toLowerCase());
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => toggleDomainChip(ch)}
                          className="px-2 py-0.5 rounded-md border text-[10px] font-bold cursor-pointer transition"
                          style={
                            active
                              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                              : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                          }
                        >
                          {ch}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {gameSchema.subtype && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  {t(gameSchema.subtype.label.en, gameSchema.subtype.label.hu)}
                </label>
                <input
                  type="text"
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                  placeholder={gameSchema.subtype.placeholder}
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
            )}
          </div>
        )}

        {/* Image Upload & Preview */}
        <div className="rounded-xl border p-3 flex flex-col sm:flex-row gap-3 items-start" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
          <div
            className="w-20 h-28 rounded-lg border shrink-0 overflow-hidden flex items-center justify-center text-[10px] text-center p-1"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{t('No image', 'Nincs kép')}</span>
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2 w-full">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {t('Card Artwork', 'Kártya képe')}
              </span>
              <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold cursor-pointer hover:brightness-110 transition" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                <input type="file" accept="image/webp,image/png,image/jpeg" className="hidden" onChange={handleUploadImage} disabled={uploadingImage} />
                <span>{uploadingImage ? t('Uploading...', 'Feltöltés...') : t('Upload Image', 'Kép feltöltése')}</span>
              </label>
            </div>
            <input
              type="text"
              value={imagePath}
              onChange={(e) => setImagePath(e.target.value)}
              placeholder="https://..."
              className={`${inputCls} font-mono`}
              style={inputStyle}
            />
            {isExternalImage && (
              <div className="text-[11px] font-medium" style={{ color: 'var(--text-accent)' }}>
                {t('External URL will be mirrored to our storage on save.', 'A külső kép mentéskor átkerül a saját tárhelyünkre.')}
              </div>
            )}
          </div>
        </div>

        {/* Game-Specific Rules Text / Ability / Flavor with Live Preview */}
        <div className="space-y-2">
          {gameSchema.textFields.some((f) => f.preview) && (
            <CardMarkupHelp
              game={game}
              onInsert={(code) => {
                const target = gameSchema.textFields.find((f) => f.preview)?.key || 'ability';
                if (target === 'ability') setAbility((prev) => (prev ? `${prev} ${code}` : code));
                else if (target === 'effect') setEffect((prev) => (prev ? `${prev} ${code}` : code));
                else setText((prev) => (prev ? `${prev} ${code}` : code));
              }}
            />
          )}
          <div className={`grid grid-cols-1 ${gameSchema.textFields.length > 1 ? 'sm:grid-cols-2' : ''} gap-3`}>
            {gameSchema.textFields.map((field) => {
              const value = field.key === 'ability' ? ability : field.key === 'effect' ? effect : text;
              const setValue = (val: string) => {
                if (field.key === 'ability') setAbility(val);
                else if (field.key === 'effect') setEffect(val);
                else setText(val);
              };
              return (
                <div key={field.key}>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    {t(field.label.en, field.label.hu)}
                  </label>
                  <textarea
                    rows={3}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={field.placeholder ? t(field.placeholder.en, field.placeholder.hu) : undefined}
                    className={inputCls}
                    style={inputStyle}
                  />
                  {field.preview && <CardTextPreview text={value} italic={field.italic} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Tags (search-as-you-type autocomplete) */}
        <div className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              {t(gameSchema.tagsLabel.en, gameSchema.tagsLabel.hu)} ({tags.length})
            </label>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tg) => (
                <span
                  key={tg}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-bold"
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                >
                  <span>{tg}</span>
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== tg))}
                    className="hover:opacity-75 cursor-pointer font-black"
                    aria-label={`Remove tag ${tg}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              placeholder={t('Search or add tag...', 'Tag keresése vagy hozzáadása...')}
              className={inputCls}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => addTag(tagInput)}
              disabled={!tagInput.trim()}
              className="min-h-9 px-3.5 rounded-xl border text-xs font-bold cursor-pointer disabled:opacity-40 shrink-0"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              {t('Add', 'Hozzáadás')}
            </button>
          </div>
          {suggestedTags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {suggestedTags.map((tg) => (
                <button
                  key={tg}
                  type="button"
                  onClick={() => addTag(tg)}
                  className="px-2 py-0.5 rounded-md border text-[10px] font-semibold cursor-pointer hover:brightness-110"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  + {tg}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cardmarket Price Guide Linker */}
        <div className="rounded-xl border p-3.5 space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
              {t('Cardmarket Price Guide Link', 'Cardmarket Price Guide összekapcsolás')}
            </div>
            {supportsCardmarket && (
              <button
                type="button"
                onClick={() => {
                  setCmSearchOpen((v) => !v);
                  if (!cmQuery && name) setCmQuery(name);
                }}
                className="min-h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
              >
                {cmSearchOpen ? t('Hide Search', 'Kereső elrejtése') : t('Find Cardmarket ID', 'Cardmarket ID keresése')}
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              type="number"
              min={1}
              value={cardmarketId}
              onChange={(e) => setCardmarketId(e.target.value)}
              placeholder={t('Cardmarket idProduct (e.g. 920105)', 'Cardmarket idProduct (pl. 920105)')}
              className={`${inputCls} font-mono sm:max-w-xs`}
              style={inputStyle}
            />
            {mode === 'edit' && card?.id && supportsCardmarket && (
              <button
                type="button"
                disabled={syncingNow || !cardmarketId.trim()}
                onClick={syncLivePriceNow}
                className="min-h-9 px-3.5 rounded-xl border text-xs font-bold cursor-pointer disabled:opacity-40"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {syncingNow ? t('Syncing...', 'Szinkron...') : t('Sync Live Price Now', 'Ár frissítése most')}
              </button>
            )}
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={syncPriceOnSave}
                onChange={(e) => setSyncPriceOnSave(e.target.checked)}
              />
              <span>{t('Sync price on save', 'Ár szinkronizálása mentéskor')}</span>
            </label>
          </div>

          {liveSyncedPrice && (
            <div className="text-[11px] font-semibold" style={{ color: 'var(--positive)' }}>
              {t('Market price:', 'Piaci ár:')}{' '}
              {liveSyncedPrice.eur !== null ? `EUR ${liveSyncedPrice.eur.toFixed(2)}` : '-'}
              {liveSyncedPrice.eurFoil !== null && liveSyncedPrice.eurFoil !== liveSyncedPrice.eur
                ? ` · Foil: EUR ${liveSyncedPrice.eurFoil.toFixed(2)}`
                : ''}
            </div>
          )}

          {cmSearchOpen && supportsCardmarket && (
            <div className="rounded-xl border p-3 space-y-2.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2">
                <input
                  type="text"
                  value={cmQuery}
                  onChange={(e) => setCmQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      searchCardmarket();
                    }
                  }}
                  placeholder={t('Card name or idProduct (e.g. Ahri, Nine-Tailed Fox)', 'Kártyanév vagy idProduct (pl. Ahri)')}
                  className={inputCls}
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={cmExpansion}
                  onChange={(e) => setCmExpansion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      searchCardmarket();
                    }
                  }}
                  placeholder={t('idExpansion (e.g. 6938)', 'idExpansion (pl. 6938)')}
                  className={`${inputCls} font-mono`}
                  style={inputStyle}
                />
                <button
                  type="button"
                  disabled={cmLoading}
                  onClick={searchCardmarket}
                  className="min-h-9 px-4 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {cmLoading ? t('Searching...', 'Keresés...') : t('Search', 'Keresés')}
                </button>
              </div>

              {cmError && <p className="text-xs text-red-400">{cmError}</p>}

              {cmResults.length > 0 && (
                <div className="max-h-56 overflow-y-auto divide-y rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                  {cmResults.map((hit) => (
                    <div
                      key={hit.idProduct}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {hit.name}
                        </div>
                        <div className="text-[11px] font-mono flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                          <span>ID: {hit.idProduct}</span>
                          {hit.idExpansion ? <span>Exp: {hit.idExpansion}</span> : null}
                          {hit.dateAdded ? <span>{hit.dateAdded.slice(0, 10)}</span> : null}
                          {hit.low ? <span>Low: EUR {hit.low.toFixed(2)}</span> : null}
                          {hit.trend ? <span>Trend: EUR {hit.trend.toFixed(2)}</span> : null}
                          {hit.trendFoil ? <span>Foil: EUR {hit.trendFoil.toFixed(2)}</span> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCardmarketId(String(hit.idProduct));
                          if (!name.trim()) setName(hit.name);
                          setCmSearchOpen(false);
                        }}
                        className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-black cursor-pointer"
                        style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)' }}
                      >
                        {t('Link ID', 'Összekapcsolás')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="min-h-9 px-4 rounded-xl border text-xs font-bold cursor-pointer"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Cancel', 'Mégse')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-9 px-5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {saving
              ? t('Saving...', 'Mentés...')
              : mode === 'create'
              ? t('Create Card', 'Kártya létrehozása')
              : t('Save Changes', 'Változások mentése')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
