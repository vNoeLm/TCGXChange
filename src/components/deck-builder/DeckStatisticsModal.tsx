import React, { useEffect, useState } from 'react';
import type { CatalogCard } from '../../types';
import type { DeckState } from './useDeckBuilder';
import { RUNE_ICONS } from '../../lib/riftboundIcons';
import { getCardPowerRequirement } from '../../lib/cardPowerData';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { KEYWORD_LIST, keywordSolidColor } from '../../lib/formatGameText';
import { hasZone, type GameId } from '../../lib/deckRules';
import { backdropCloseProps } from '../../lib/modalBackdrop';
import { useLanguage } from '../../lib/i18n';

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

export function DeckStatisticsModal({
  deck,
  cards,
  activeGame = 'riftbound',
  legendCard,
  championCard,
  onClose,
  
}: DeckStatisticsModalProps) {
  const { t, lang } = useLanguage();
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
  // Domain demand: { [domain]: { total: number; strict: number; multiPower: number } }
  const domainDemand: Record<string, { total: number; strict: number; multiPower: number }> = {};
  // Dual-domain Signature cards (Spells, Gear, Units - the only dual/mixed domain cards)
  const mixedSignatures: Array<{
    id: string;
    name: string;
    card_type?: string;
    qty: number;
    power: number;
    domains: string[];
  }> = [];
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
        // Dual-domain Signature card: separate from single-domain strict counts
        const existing = mixedSignatures.find(s => s.id === card.id || s.name === card.name);
        if (existing) {
          existing.qty += qty;
        } else {
          mixedSignatures.push({
            id: card.id,
            name: card.name,
            card_type: card.card_type,
            qty,
            power: p,
            domains: powerReq.domains,
          });
        }
      } else {
        // Single-domain card: strictly requires this domain
        const d = powerReq.domains[0];
        if (d) {
          if (!domainDemand[d]) domainDemand[d] = { total: 0, strict: 0, multiPower: 0 };
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

  // Keyword Frequency -- how many instances of each printed keyword are in the deck
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

  return (
    <div
      {...backdropCloseProps(onClose)}
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
          maxWidth: 780,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          padding: 24,
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 900,
              color: 'var(--text-accent)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              {t('Deck Statistics', 'Paklistatisztika')}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
              {legendCard ? `${legendCard.name} · ` : ''}{mainCardCount} {lang === 'hu' ? 'főpakli kártya' : 'Main Deck cards'} ({totalDeckCount} {lang === 'hu' ? 'összesen' : 'total'})
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Close statistics', 'Statisztika bezárása')}
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

        {/* Modal Scroll Body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', paddingRight: 4 }}>
          {/* Quick Highlights Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
                {t('Average Cost', 'Átlagköltség')}
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-accent)' }}>
                {avgEnergyCost}
              </div>
            </div>

            {activeGame === 'riftbound' && (
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
                  {t('Avg Power Cost', 'Átlag Power költség')}
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-accent)' }}>
                  {avgPowerCost}
                </div>
              </div>
            )}

            {hasZone(activeGame, 'runeDeck') && (
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
                  {t('Rune Deck', 'Rúnapakli')}
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-accent)' }}>
                  {runeCount} <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/ 12</span>
                </div>
              </div>
            )}

            {hasZone(activeGame, 'sideboard') && (
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 4 }}>
                  {t('Sideboard', 'Sideboard')}
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
                {activeGame === 'riftbound' ? t('Energy Curve', 'Energiagörbe') : activeGame === 'mtg' ? t('Mana Curve', 'Managörbe') : t('Cost Curve', 'Költséggörbe')}
              </h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
                {lang === 'hu' ? `${totalEnergyCards} költséggel rendelkező kártya` : `${totalEnergyCards} cards with cost`}
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
                    <div style={{
                      width: '100%',
                      maxWidth: 34,
                      height: `${Math.max(4, heightPct)}%`,
                      background: count > 0 ? 'var(--accent-strong)' : 'rgba(255,255,255,0.06)',
                      borderRadius: '6px 6px 2px 2px',
                      transition: 'height 0.3s ease',
                      boxShadow: count > 0 ? '0 0 10px var(--accent-glow)' : 'none',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #cbd5e1)' }}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Riftbound Power Cost Breakdown & Domain Demand */}
          {activeGame === 'riftbound' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {/* Power Curve */}
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
                    {t('Power Curve', 'Power görbe')}
                  </h3>
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
                    {lang === 'hu' ? `${totalPowerCards} power kártya` : `${totalPowerCards} power cards`}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, height: 110, paddingTop: 10, paddingBottom: 6 }}>
                  {[0, 1, 2, 3].map(p => {
                    const count = powerCurve[p] || 0;
                    const maxPCount = Math.max(1, ...Object.values(powerCurve));
                    const heightPct = (count / maxPCount) * 100;
                    const label = p === 3 ? '3+ P' : `${p} P`;

                    return (
                      <div key={p} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: count > 0 ? 'var(--text-accent)' : 'var(--text-muted, #64748b)' }}>
                          {count}
                        </span>
                        <div style={{
                          width: '100%',
                          maxWidth: 38,
                          height: `${Math.max(4, heightPct)}%`,
                          background: count > 0 ? '#38bdf8' : 'rgba(255,255,255,0.06)',
                          borderRadius: '6px 6px 2px 2px',
                          transition: 'height 0.3s ease',
                          boxShadow: count > 0 ? '0 0 10px rgba(56, 189, 248, 0.3)' : 'none',
                        }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #cbd5e1)' }}>
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Domain Demand */}
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
                    {t('Domain Power Demand', 'Domén Power igény')}
                  </h3>
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
                    {t('Runes needed for Power', 'Powerhez szükséges rúnák')}
                  </span>
                </div>

                {Object.keys(domainDemand).length === 0 && mixedSignatures.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                    {t('No cards with Power requirements', 'Nincsenek Power igényű kártyák')}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(domainDemand)
                      .sort((a, b) => b[1].strict - a[1].strict)
                      .map(([dom, dData]) => {
                        const style = DOMAIN_COLORS[dom.toLowerCase()] || DOMAIN_COLORS.colorless;
                        const iconKey = dom.toLowerCase();
                        const iconData = RUNE_ICONS[iconKey];

                        return (
                          <div
                            key={dom}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              borderRadius: 8,
                              background: 'var(--bg-surface)',
                              border: `1px solid ${style.border}44`,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {iconData ? (
                                <img
                                  src={iconData}
                                  alt={dom}
                                  style={{ width: 18, height: 18, objectFit: 'contain' }}
                                />
                              ) : (
                                <div style={{ width: 12, height: 12, borderRadius: '50%', background: style.bg }} />
                              )}
                              <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'capitalize', color: style.text }}>
                                {dom}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                              <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>
                                <strong style={{ color: 'var(--text-primary)' }}>{dData.strict}</strong> {lang === 'hu' ? 'kötött' : 'strict'}
                              </span>
                              {dData.multiPower > 0 && (
                                <span style={{
                                  background: 'rgba(234, 179, 8, 0.15)',
                                  color: '#facc15',
                                  border: '1px solid rgba(234, 179, 8, 0.3)',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 800,
                                }}>
                                  {dData.multiPower} {lang === 'hu' ? 'legalább 2 P-t igényel' : 'needs 2+ P'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                    {mixedSignatures.map(sig => (
                      <div
                        key={sig.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '7px 10px',
                          borderRadius: 8,
                          background: 'var(--bg-surface)',
                          border: '1px solid rgba(168, 85, 247, 0.35)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                            {sig.domains.map(dom => {
                              const iconKey = dom.toLowerCase();
                              const iconData = RUNE_ICONS[iconKey];
                              const style = DOMAIN_COLORS[iconKey] || DOMAIN_COLORS.colorless;
                              return iconData ? (
                                <img
                                  key={dom}
                                  src={iconData}
                                  alt={dom}
                                  title={dom}
                                  style={{ width: 16, height: 16, objectFit: 'contain' }}
                                />
                              ) : (
                                <div
                                  key={dom}
                                  title={dom}
                                  style={{ width: 10, height: 10, borderRadius: '50%', background: style.bg }}
                                />
                              );
                            })}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {sig.name}
                            </div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Signature {sig.card_type || 'Card'} &middot; {sig.domains.map(d => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()).join(' / ')}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, flexShrink: 0 }}>
                          <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>
                            <strong style={{ color: 'var(--text-primary)' }}>{sig.qty}</strong> {lang === 'hu' ? 'példány' : sig.qty === 1 ? 'copy' : 'copies'}
                            <span style={{ color: 'var(--text-muted)' }}> {lang === 'hu' ? '(bármelyik domén)' : '(either domain)'}</span>
                          </span>
                          {sig.power > 1 && (
                            <span
                              style={{
                                background: 'rgba(234, 179, 8, 0.15)',
                                color: '#facc15',
                                border: '1px solid rgba(234, 179, 8, 0.3)',
                                padding: '1px 5px',
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 800,
                              }}
                            >
                              {sig.power} P
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 3: Two Column Layout (Card Types + Rarities) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {/* Card Types Breakdown */}
            <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
                {t('Card Types', 'Kártyatípusok')}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(typeCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tName, count]) => {
                    const pct = Math.round((count / (mainCardCount || 1)) * 100);
                    return (
                      <div key={tName} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                          <span style={{ color: 'var(--text-secondary, #cbd5e1)' }}>{tName}</span>
                          <span style={{ color: 'var(--text-primary)' }}>{count} <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>({pct}%)</span></span>
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Rarity Distribution */}
            <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: 'var(--text-accent)' }}>
                {t('Rarity Distribution', 'Ritkaság eloszlás')}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {displayRarities.map(r => {
                  const count = rarityCounts[r] || 0;
                  const pct = Math.round((count / (mainCardCount || 1)) * 100);
                  const color = RARITY_COLORS[r] || 'var(--text-muted)';

                  return (
                    <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                        <span style={{ color }}>{r}</span>
                        <span style={{ color: 'var(--text-primary)' }}>{count} <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>({pct}%)</span></span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
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

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
          <button
            onClick={onClose}
            aria-label={t('Close statistics', 'Statisztika bezárása')}
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
    </div>
  );
}
