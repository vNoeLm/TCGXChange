import React, { useEffect, useState } from 'react';
import type { CatalogCard } from '../../types';
import type { DeckState } from './useDeckBuilder';
import { RUNE_ICONS } from '../../lib/riftboundIcons';
import { getCardPowerRequirement } from '../../lib/cardPowerData';
import { getCardImageUrl } from '../../lib/supabase';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { KEYWORD_LIST, keywordSolidColor } from '../../lib/formatGameText';

import { getDeckRules, hasZone, type GameId } from '../../lib/deckRules';

interface DeckStatisticsModalProps {
  deck: DeckState;
  cards: CatalogCard[];
  activeGame?: GameId;
  legendCard: CatalogCard | null;
  championCard: CatalogCard | null;
  onClose: () => void;
}

const DOMAIN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  fury:      { bg: '#ef4444', text: '#fee2e2', border: '#b91c1c' },
  calm:      { bg: '#22c55e', text: '#dcfce7', border: '#15803d' },
  mind:      { bg: '#3b82f6', text: '#dbeafe', border: '#1d4ed8' },
  body:      { bg: '#f97316', text: '#ffedd5', border: '#c2410c' },
  chaos:     { bg: '#a855f7', text: '#f3e8ff', border: '#7e22ce' },
  order:     { bg: '#eab308', text: '#fef9c3', border: '#a16207' },
  colorless: { bg: '#94a3b8', text: '#f1f5f9', border: '#475569' },
  neutral:   { bg: '#94a3b8', text: '#f1f5f9', border: '#475569' },
  Red:       { bg: '#ef4444', text: '#fee2e2', border: '#b91c1c' },
  Green:     { bg: '#22c55e', text: '#dcfce7', border: '#15803d' },
  Blue:      { bg: '#06b6d4', text: '#cffafe', border: '#0891b2' },
  Yellow:    { bg: '#eab308', text: '#fef9c3', border: '#a16207' },
};

const RARITY_COLORS: Record<string, string> = {
  Common:   '#94a3b8',
  Uncommon: '#38bdf8',
  Rare:     '#c084fc',
  Epic:     '#fb923c',
  Showcase: '#facc15',
};

/** Number input that lets you clear it while typing; an empty box only falls back to `min`
 * when you leave it, instead of snapping to a value the moment you delete the digits. */
function StatNumberInput({ value, min, max, onCommit, style }: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  style: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  React.useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onFocus={e => { setFocused(true); e.currentTarget.select(); }}
      onChange={e => {
        const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
        setDraft(digits);
        if (digits !== '') onCommit(Math.max(min, Math.min(max, parseInt(digits, 10))));
      }}
      onBlur={() => {
        setFocused(false);
        if (draft === '') { onCommit(min); setDraft(String(min)); }
      }}
      style={style}
    />
  );
}

export function DeckStatisticsModal({
  deck,
  cards,
  activeGame = 'riftbound',
  legendCard,
  championCard,
  onClose,
  
}: DeckStatisticsModalProps) {
  // No isOpen prop - the parent mounts/unmounts this directly, so there's no signal to hold it
  // for an exit transition. This still gives a real entrance instead of an instant pop-in.
  useBodyScrollLock(true);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 1. Gather all card entries across zones
  const getZoneEntries = (zoneMap: Record<string, number>) => {
    return Object.entries(zoneMap || {})
      .map(([id, qty]) => {
        const card = cards.find(c => c.id === id);
        return card ? { card, qty } : null;
      })
      .filter(Boolean) as Array<{ card: CatalogCard; qty: number }>;
  };

  const mainEntries = getZoneEntries(deck.mainDeck);
  const runeEntries = getZoneEntries(deck.runeDeck);
  const bfEntries = getZoneEntries(deck.battlefields);
  const sbEntries = getZoneEntries(deck.sideboard);

  const mainCardCount = mainEntries.reduce((sum, e) => sum + e.qty, 0) + (championCard ? 1 : 0);
  const runeCount = runeEntries.reduce((sum, e) => sum + e.qty, 0);
  const bfCount = bfEntries.reduce((sum, e) => sum + e.qty, 0);
  const sbCount = sbEntries.reduce((sum, e) => sum + e.qty, 0);
  const totalDeckCount = (legendCard ? 1 : 0) + mainCardCount + runeCount + bfCount + sbCount;

  // 2. Energy Curve (Main Deck + Champion)
  const energyCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  let totalEnergySum = 0;
  let totalEnergyCards = 0;

  const countCardEnergy = (card: CatalogCard, qty: number) => {
    if (typeof card.cost === 'number' || (card.energy && !isNaN(Number(card.energy)))) {
      const val = typeof card.cost === 'number' ? card.cost : Number(card.energy);
      const cost = Math.max(0, val);
      const bucket = cost >= 7 ? 7 : cost;
      energyCounts[bucket] = (energyCounts[bucket] || 0) + qty;
      totalEnergySum += cost * qty;
      totalEnergyCards += qty;
    }
  };

  if (championCard) countCardEnergy(championCard, 1);
  mainEntries.forEach(e => countCardEnergy(e.card, e.qty));

  const avgEnergyCost = totalEnergyCards > 0 ? (totalEnergySum / totalEnergyCards).toFixed(2) : '0.00';
  const maxEnergyBucketCount = Math.max(1, ...Object.values(energyCounts));

  // 3. Power Cost Breakdown & Domain Rune Demand (Main Deck + Champion)
  // Power Curve buckets (0 Power, 1 Power, 2 Power, 3+ Power)
  const powerCurve: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  // Domain demand: { [domain]: { total: number, strict: number, mixed: number, multiPower: number } }
  const domainDemand: Record<string, { total: number; strict: number; mixed: number; multiPower: number }> = {};
  let totalPowerCards = 0;
  let totalPowerSum = 0;

  const countCardPower = (card: CatalogCard, qty: number) => {
    const powerReq = getCardPowerRequirement(card);
    const p = powerReq.power;
    const bucket = p >= 3 ? 3 : p;
    powerCurve[bucket] = (powerCurve[bucket] || 0) + qty;

    if (p > 0) {
      totalPowerCards += qty;
      totalPowerSum += p * qty;

      if (powerReq.isMixed) {
        // Dual-domain card: can be paid with EITHER domain
        powerReq.domains.forEach(d => {
          if (!domainDemand[d]) domainDemand[d] = { total: 0, strict: 0, mixed: 0, multiPower: 0 };
          domainDemand[d].total += qty;
          domainDemand[d].mixed += qty;
        });
      } else {
        // Single-domain card: strictly requires this domain
        const d = powerReq.domains[0];
        if (d) {
          if (!domainDemand[d]) domainDemand[d] = { total: 0, strict: 0, mixed: 0, multiPower: 0 };
          domainDemand[d].total += qty;
          domainDemand[d].strict += qty;
          if (p > 1) {
            domainDemand[d].multiPower += qty;
          }
        }
      }
    }
  };

  if (championCard) countCardPower(championCard, 1);
  mainEntries.forEach(e => countCardPower(e.card, e.qty));

  const avgPowerCost = mainCardCount > 0 ? (totalPowerSum / mainCardCount).toFixed(2) : '0.00';

  // 4. Card Type Breakdown (Main Deck + Champion)
  const typeCounts: Record<string, number> = {};
  if (championCard) {
    typeCounts['Unit'] = (typeCounts['Unit'] || 0) + 1;
  }
  mainEntries.forEach(e => {
    const tName = e.card.card_type || 'Other';
    typeCounts[tName] = (typeCounts[tName] || 0) + e.qty;
  });

  // 5. Rarity Breakdown
  const rarityCounts: Record<string, number> = {};
  if (legendCard) rarityCounts[legendCard.rarity || 'Common'] = (rarityCounts[legendCard.rarity || 'Common'] || 0) + 1;
  if (championCard) rarityCounts[championCard.rarity || 'Common'] = (rarityCounts[championCard.rarity || 'Common'] || 0) + 1;
  [...mainEntries, ...runeEntries, ...bfEntries, ...sbEntries].forEach(e => {
    const r = e.card.rarity || 'Common';
    rarityCounts[r] = (rarityCounts[r] || 0) + e.qty;
  });

  const defaultRarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase'];

  // Dynamically query added cards for extra/custom rarities
  const extraRarities = Object.keys(rarityCounts).filter(
    r => !defaultRarities.includes(r)
  );
  const displayRarities = [...defaultRarities, ...extraRarities];

  // 6. Opening Hand Simulator -- samples from the Main Deck only (the Rune Deck is a
  // separate resource pool you reveal from, not a card you draw into hand). Riftbound
  // opens with a 4-card hand, allows mulliganing up to 2 of those cards once, and draws
  // exactly 1 card per turn after that.
  const rules = getDeckRules(activeGame);
  const [activeTab, setActiveTab] = useState<'overview' | 'simulator' | 'probability'>('overview');
  const [handSize, setHandSize] = useState(() => rules.handSize);
  useEffect(() => { setHandSize(rules.handSize); }, [activeGame, rules.handSize]);
  const [hand, setHand] = useState<CatalogCard[]>([]);
  const [remainingPool, setRemainingPool] = useState<CatalogCard[]>([]);
  const [simPreviewCard, setSimPreviewCard] = useState<CatalogCard | null>(null);
  const [mulliganUsed, setMulliganUsed] = useState(false);
  const [mulliganPicks, setMulliganPicks] = useState<Set<number>>(new Set());

  const buildDrawPool = (): CatalogCard[] => {
    const pool: CatalogCard[] = [];
    mainEntries.forEach(e => { for (let i = 0; i < e.qty; i++) pool.push(e.card); });
    return pool;
  };

  const shuffle = <T,>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const drawNewHand = () => {
    const pool = shuffle(buildDrawPool());
    const size = Math.min(handSize, pool.length);
    setHand(pool.slice(0, size));
    setRemainingPool(pool.slice(size));
    setMulliganUsed(false);
    setMulliganPicks(new Set());
  };

  const drawOneMore = () => {
    if (remainingPool.length === 0) return;
    const idx = Math.floor(Math.random() * remainingPool.length);
    const card = remainingPool[idx];
    setHand(prev => [...prev, card]);
    setRemainingPool(prev => prev.filter((_, i) => i !== idx));
  };

  // Mulligan: put back up to 2 chosen cards, shuffle them into the remaining deck, and draw
  // that many replacements - a one-time swap at the start, not a full hand redraw.
  const toggleMulliganPick = (idx: number) => {
    setMulliganPicks(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else if (next.size < 2) next.add(idx);
      return next;
    });
  };

  const performMulligan = () => {
    if (mulliganUsed || mulliganPicks.size === 0) return;
    const keptHand = hand.filter((_, i) => !mulliganPicks.has(i));
    const returned = hand.filter((_, i) => mulliganPicks.has(i));
    const pool = shuffle([...remainingPool, ...returned]);
    const drawn = pool.slice(0, returned.length);
    setHand([...keptHand, ...drawn]);
    setRemainingPool(pool.slice(returned.length));
    setMulliganUsed(true);
    setMulliganPicks(new Set());
  };

  const handAvgCost = hand.length > 0
    ? (hand.reduce((sum, c) => sum + Math.max(0, typeof c.cost === 'number' ? c.cost : Number(c.energy) || 0), 0) / hand.length).toFixed(2)
    : '0.00';

  // Rune needs only apply to a card's Power cost, not its Energy cost - Energy can be paid
  // with runes of any domain, so a card with 0 Power makes no domain demand at all even
  // though it's still printed with a domain.
  const handDomainNeeds: Record<string, number> = {};
  hand.forEach(c => {
    const req = getCardPowerRequirement(c);
    if (req.power <= 0) return;
    req.domains.forEach(d => { handDomainNeeds[d] = (handDomainNeeds[d] || 0) + 1; });
  });

  // 7. Keyword Frequency -- how many instances of each printed keyword are in the deck,
  // counted per bracket mention (e.g. a card that says "[Assault 2]" once contributes
  // once per copy of that card).
  const keywordRe = new RegExp(`\\[(${KEYWORD_LIST.join('|')})(?:\\s+\\d+)?\\]`, 'gi');
  const keywordCounts: Record<string, number> = {};
  const scanKeywords = (card: CatalogCard, qty: number) => {
    const raw = `${card.ability || ''} ${card.text || ''}`;
    if (!raw.trim()) return;
    let m;
    keywordRe.lastIndex = 0;
    while ((m = keywordRe.exec(raw))) {
      const kw = m[1].toLowerCase();
      keywordCounts[kw] = (keywordCounts[kw] || 0) + qty;
    }
  };
  if (championCard) scanKeywords(championCard, 1);
  mainEntries.forEach(e => scanKeywords(e.card, e.qty));
  const sortedKeywords = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]);
  const maxKeywordCount = Math.max(1, ...sortedKeywords.map(([, c]) => c));

  // 8. Draw Probability Calculator (hypergeometric): odds of having drawn at least
  // one copy of a chosen card by a given number of cards seen.
  const uniqueMainCards = mainEntries
    .map(e => e.card)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [probCardId, setProbCardId] = useState<string>('');
  const [probDrawn, setProbDrawn] = useState(10);

  const logChoose = (n: number, k: number): number => {
    if (k < 0 || k > n) return -Infinity;
    let res = 0;
    for (let i = 0; i < k; i++) res += Math.log(n - i) - Math.log(i + 1);
    return res;
  };
  const probAtLeastOne = (deckSize: number, copies: number, drawn: number): number => {
    if (copies <= 0 || drawn <= 0 || deckSize <= 0) return 0;
    if (drawn >= deckSize) return 1;
    const p0 = Math.exp(logChoose(deckSize - copies, drawn) - logChoose(deckSize, drawn));
    return Math.max(0, Math.min(1, 1 - p0));
  };

  const selectedProbCard = uniqueMainCards.find(c => c.id === probCardId) || uniqueMainCards[0] || null;
  const selectedProbCopies = selectedProbCard ? (mainEntries.find(e => e.card.id === selectedProbCard.id)?.qty || 0) : 0;
  const probMilestones = [handSize, handSize + 1, handSize + 2, handSize + 3, handSize + 4, handSize + 5, handSize + 6, handSize + 7]
    .filter(n => n <= mainCardCount);

  return (
    <div
      onClick={onClose}
      data-state={entered ? 'open' : 'closed'}
      className="tv-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        data-state={entered ? 'open' : 'closed'}
        className="tv-modal-panel"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.95), 0 0 30px var(--accent-glow)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 900,
              color: 'var(--text-accent)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              Deck Statistics
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
              {legendCard ? `${legendCard.name} · ` : ''}{mainCardCount} Main Deck cards ({totalDeckCount} total)
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--accent-muted)',
              border: '1px solid var(--accent-border, var(--border))',
              color: 'var(--text-accent)',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontWeight: 800,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--accent-glow)';
              e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--accent-muted)';
              e.currentTarget.style.borderColor = 'var(--accent-border, var(--border))';
            }}
          >
            <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab Toggle */}
        <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12 }}>
          {(['overview', 'simulator', 'probability'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                background: activeTab === tab ? 'var(--accent)' : 'transparent',
                color: activeTab === tab ? 'var(--text-on-accent, #000)' : 'var(--text-secondary)',
                transition: 'all 0.15s ease',
              }}
            >
              {tab === 'overview' ? 'Overview' : tab === 'simulator' ? 'Opening Hand Simulator' : 'Draw Odds'}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
        <>
        {/* Quick Highlights Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
              Average Cost
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-accent)' }}>
              {avgEnergyCost}
            </div>
          </div>

          {activeGame === 'riftbound' && (
            <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
                Avg Power Cost
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-accent)' }}>
                {avgPowerCost}
              </div>
            </div>
          )}

          {hasZone(activeGame, 'runeDeck') && (
            <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
                Rune Deck
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-accent)' }}>
                {runeCount} <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/ 12</span>
              </div>
            </div>
          )}

          {hasZone(activeGame, 'sideboard') && (
            <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
                Sideboard
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#10b981' }}>
                {sbCount} <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/ {activeGame === 'mtg' ? 15 : 8}</span>
              </div>
            </div>
          )}
        </div>

        {/* Section 1: Cost Curve Bar Chart */}
        <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
              {activeGame === 'riftbound' ? 'Energy Curve' : activeGame === 'mtg' ? 'Mana Curve' : 'Cost Curve'}
            </h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
              {totalEnergyCards} cards with cost
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, height: 130, paddingTop: 10, paddingBottom: 6 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map(cost => {
              const count = energyCounts[cost] || 0;
              const heightPct = maxEnergyBucketCount > 0 ? (count / maxEnergyBucketCount) * 100 : 0;
              const label = cost === 7 ? '7+' : String(cost);

              return (
                <div key={cost} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: count > 0 ? 'var(--text-accent)' : 'var(--text-muted, #64748b)' }}>
                    {count}
                  </span>
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 38,
                      height: `${Math.max(4, heightPct)}%`,
                      background: count > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                      borderRadius: '6px 6px 2px 2px',
                      transition: 'height 0.3s ease',
                      boxShadow: count > 0 ? '0 0 10px var(--accent-glow)' : 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #cbd5e1)' }}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 2: Power Cost (Riftbound only) */}
        {activeGame === 'riftbound' && (
          <div style={{ background: '#0e1c36', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#f59e0b' }}>
                Power Cost (Rune Demands)
              </h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
                {totalPowerCards} cards with power cost
              </span>
            </div>

            {/* Power Curve Bars */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, height: 110, paddingBottom: 6 }}>
              {[0, 1, 2, 3].map(p => {
                const count = powerCurve[p] || 0;
                const maxPower = Math.max(1, ...Object.values(powerCurve));
                const heightPct = (count / maxPower) * 100;
                const label = p === 3 ? '3+ Power' : `${p} Power`;

                return (
                  <div key={p} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: count > 0 ? '#fbbf24' : 'var(--text-muted, #64748b)' }}>
                      {count}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        maxWidth: 44,
                        height: `${Math.max(4, heightPct)}%`,
                        background: count > 0 ? 'linear-gradient(to top, #d97706, #fbbf24)' : 'rgba(255,255,255,0.04)',
                        borderRadius: '6px 6px 2px 2px',
                        transition: 'height 0.3s ease',
                        boxShadow: count > 0 ? '0 0 10px rgba(245,158,11,0.35)' : 'none',
                      }}
                    />
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary, #cbd5e1)', textAlign: 'center' }}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Domain Demand Bars */}
            {Object.keys(domainDemand).length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(245, 158, 11, 0.15)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' }}>
                    Domain Rune Requirements
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)', marginTop: 2, lineHeight: 1.4 }}>
                    How many cards need runes of each domain to cast. <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>Pure</span> = only that domain works, and the number in parentheses is how many of those need 2 or more runes of it. <span style={{ color: '#38bdf8' }}>Dual</span> = either domain works, counted separately.
                  </div>
                </div>
                {Object.entries(domainDemand)
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([dom, dStats]) => {
                    const style = DOMAIN_COLORS[dom.toLowerCase()] || DOMAIN_COLORS.colorless;
                    const pctOfMain = mainCardCount > 0 ? Math.round((dStats.total / mainCardCount) * 100) : 0;

                    return (
                      <div key={dom} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: style.bg }} />
                            <span style={{ fontWeight: 700, color: style.text, textTransform: 'capitalize' }}>
                              {/* Neutral power (Neeko) is paid with a rune of any domain. */}
                              {dom === 'neutral' ? 'Neutral (any rune)' : dom}
                            </span>
                            <span style={{ color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>
                              {dStats.total} card{dStats.total === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                            {dStats.strict > 0 && dom !== 'neutral' && (
                              <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>
                                {dStats.strict} pure{dStats.multiPower > 0 ? ` (${dStats.multiPower} need 2+)` : ''}
                              </span>
                            )}
                            {dStats.mixed > 0 && (
                              <span style={{ color: '#38bdf8', fontSize: 11 }}>
                                {dStats.mixed} dual
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pctOfMain}%`, height: '100%', background: style.bg, borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Section 3: Card Types & Rarities */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {/* Card Types */}
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
              Card Types
            </h3>

            {Object.keys(typeCounts).length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Empty</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(typeCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => {
                    const pct = mainCardCount > 0 ? Math.round((count / mainCardCount) * 100) : 0;
                    return (
                      <div key={type} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                          <span style={{ color: 'var(--text-primary, #f8fafc)' }}>
                            {type}
                          </span>
                          <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>
                            {count} ({pct}%)
                          </span>
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-strong)', borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Rarity Breakdown */}
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
              Rarities
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayRarities.map(r => {
                const count = rarityCounts[r] || 0;
                const color = RARITY_COLORS[r] || '#38bdf8';
                const pct = totalDeckCount > 0 ? Math.round((count / totalDeckCount) * 100) : 0;

                return (
                  <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                      <span style={{ color }}>{r}</span>
                      <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Keyword Frequency (Riftbound only) */}
          {activeGame === 'riftbound' && sortedKeywords.length > 0 && (
            <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
                Keywords
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sortedKeywords.map(([kw, count]) => {
                  const color = keywordSolidColor(kw);
                  const pct = Math.round((count / maxKeywordCount) * 100);
                  return (
                    <div key={kw} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                        <span style={{ color, textTransform: 'capitalize' }}>{kw}</span>
                        <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>{count}</span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        </>
        )}

        {activeTab === 'simulator' && (
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
                  Opening Hand Simulator
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
                  Draws randomly from your {mainCardCount}-card Main Deck. Rune Deck resources aren't drawn into hand, so they're not simulated here. Opens with {handSize} cards; click the ↺ on up to 2 of them to mulligan once, then draw 1 card per turn.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Hand Size</label>
                <StatNumberInput
                  value={handSize}
                  min={1}
                  max={20}
                  onCommit={setHandSize}
                  style={{ width: 52, padding: '6px 8px', borderRadius: 8, background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={drawNewHand}
                disabled={mainCardCount === 0}
                style={{ padding: '9px 16px', borderRadius: 10, background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)', border: 'none', fontSize: 12, fontWeight: 800, cursor: mainCardCount === 0 ? 'not-allowed' : 'pointer', opacity: mainCardCount === 0 ? 0.5 : 1 }}
              >
                Draw Opening Hand
              </button>
              <button
                onClick={performMulligan}
                disabled={mulliganUsed || mulliganPicks.size === 0}
                style={{ padding: '9px 16px', borderRadius: 10, background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,0.5)', fontSize: 12, fontWeight: 800, cursor: (mulliganUsed || mulliganPicks.size === 0) ? 'not-allowed' : 'pointer', opacity: (mulliganUsed || mulliganPicks.size === 0) ? 0.5 : 1 }}
              >
                Mulligan Selected ({mulliganPicks.size}/2)
              </button>
              <button
                onClick={drawOneMore}
                disabled={hand.length === 0 || remainingPool.length === 0}
                style={{ padding: '9px 16px', borderRadius: 10, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 800, cursor: (hand.length === 0 || remainingPool.length === 0) ? 'not-allowed' : 'pointer', opacity: (hand.length === 0 || remainingPool.length === 0) ? 0.5 : 1 }}
              >
                Draw Next Turn's Card
              </button>
            </div>

            {mainCardCount === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                Add cards to your Main Deck to simulate an opening hand.
              </p>
            ) : hand.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                Hit "Draw Opening Hand" to sample a random hand from your current deck list.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {hand.map((card, i) => {
                    const picked = mulliganPicks.has(i);
                    return (
                      <div key={`${card.id}-${i}`} style={{ width: 78, position: 'relative' }}>
                        <div
                          onClick={() => setSimPreviewCard(card)}
                          title={card.name}
                          style={{ width: 78, height: 109, borderRadius: 8, overflow: 'hidden', border: `2px solid ${picked ? '#ef4444' : 'var(--border)'}`, background: '#09090b', cursor: 'pointer' }}
                        >
                          {card.image_path && (
                            <img src={getCardImageUrl(card.image_path)} alt={card.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )}
                        </div>
                        {!mulliganUsed && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleMulliganPick(i); }}
                            title={picked ? 'Keep this card instead' : 'Mark this card to mulligan'}
                            style={{
                              position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%',
                              border: '1px solid rgba(255,255,255,0.6)',
                              background: picked ? '#ef4444' : 'rgba(0,0,0,0.6)',
                              color: '#fff', fontSize: 11, fontWeight: 900, cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                            }}
                          >
                            ↺
                          </button>
                        )}
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {card.name}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span style={{ fontWeight: 800, color: 'var(--text-accent)' }}>{hand.length}</span> cards in hand &middot; avg cost <span style={{ fontWeight: 800, color: 'var(--text-accent)' }}>{handAvgCost}</span>
                  </div>
                  {activeGame === 'riftbound' && Object.keys(handDomainNeeds).length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Rune needs:</span>
                      {Object.entries(handDomainNeeds).map(([dom, count]) => {
                        const style = DOMAIN_COLORS[dom.toLowerCase()] || DOMAIN_COLORS.colorless;
                        return (
                          <span key={dom} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: style.text, background: `${style.bg}22`, border: `1px solid ${style.border}`, padding: '2px 8px', borderRadius: 20, textTransform: 'capitalize' }}>
                            {dom} &times;{count}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'probability' && (
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
                Draw Odds
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
                Hypergeometric odds of having drawn at least one copy of a card by a given number of cards seen, out of your {mainCardCount}-card Main Deck.
              </p>
            </div>

            {uniqueMainCards.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                Add cards to your Main Deck to calculate draw odds.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    value={selectedProbCard?.id || ''}
                    onChange={e => setProbCardId(e.target.value)}
                    style={{ flex: '1 1 220px', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}
                  >
                    {uniqueMainCards.map(c => {
                      const qty = mainEntries.find(e => e.card.id === c.id)?.qty || 0;
                      return <option key={c.id} value={c.id}>{c.name} ({qty} cop{qty === 1 ? 'y' : 'ies'})</option>;
                    })}
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Cards Seen</label>
                    <StatNumberInput
                      value={probDrawn}
                      min={1}
                      max={mainCardCount}
                      onCommit={setProbDrawn}
                      style={{ width: 56, padding: '6px 8px', borderRadius: 8, background: 'var(--bg-input, var(--bg-surface))', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}
                    />
                  </div>
                </div>

                {selectedProbCard && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 12 }}>
                      <div style={{ width: 52, height: 73, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#09090b', flexShrink: 0 }}>
                        {selectedProbCard.image_path && (
                          <img src={getCardImageUrl(selectedProbCard.image_path)} alt={selectedProbCard.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          Odds of at least 1 copy of <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{selectedProbCard.name}</span> ({selectedProbCopies} in deck) after {probDrawn} cards seen
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-accent)' }}>
                          {(probAtLeastOne(mainCardCount, selectedProbCopies, probDrawn) * 100).toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                        By turn, assuming a {handSize}-card opening hand and 1 draw per turn after
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 110 }}>
                        {probMilestones.map((n, i) => {
                          const p = probAtLeastOne(mainCardCount, selectedProbCopies, n) * 100;
                          const label = i === 0 ? 'Open' : `Turn ${i}`;
                          return (
                            <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-accent)' }}>{p.toFixed(0)}%</span>
                              <div style={{ width: '100%', maxWidth: 34, height: `${Math.max(4, p)}%`, background: 'var(--accent-strong)', borderRadius: '6px 6px 2px 2px', boxShadow: '0 0 10px var(--accent-glow)' }} />
                              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 22px',
              borderRadius: 10,
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-accent)',
              fontSize: 13,
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = '0 0 12px var(--accent-glow)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            Close
          </button>
        </div>
      </div>

      <CardPreviewOverlay cardId={simPreviewCard?.id ?? null} onClose={() => setSimPreviewCard(null)} zIndex={10000} />
    </div>
  );
}
