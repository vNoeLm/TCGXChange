import React, { useState } from 'react';
import { useLanguage } from '../../lib/i18n';

interface TokenItem {
  code: string;
  descEn: string;
  descHu: string;
}

const COMMON_TOKENS: TokenItem[] = [
  { code: '<br />', descEn: 'Line break', descHu: 'Sortörés' },
  { code: '**bold**', descEn: 'Bold', descHu: 'Félkövér' },
  { code: '<i>italic</i>', descEn: 'Italic', descHu: 'Dőlt' },
  { code: '<ul><li>...</li></ul>', descEn: 'List', descHu: 'Lista' },
];

const GAME_TOKENS: Record<string, TokenItem[]> = {
  riftbound: [
    { code: '[Action]', descEn: 'Action badge', descHu: 'Action jelvény' },
    { code: '[Reaction]', descEn: 'Reaction badge', descHu: 'Reaction jelvény' },
    { code: '[Assault 3]', descEn: 'Keyword (+ optional number)', descHu: 'Kulcsszó (+ opcionális szám)' },
    { code: ':rb_might:', descEn: 'Might icon', descHu: 'Might ikon' },
    { code: ':rb_exhaust:', descEn: 'Exhaust icon', descHu: 'Exhaust ikon' },
    { code: ':rb_energy_1:', descEn: 'Energy circle (0–12)', descHu: 'Energia kör (0–12)' },
    { code: ':rb_rune_fury:', descEn: 'Rune (fury/calm/mind/body/chaos/order)', descHu: 'Rúna (fury/calm/mind/body/chaos/order)' },
    { code: '[A]', descEn: 'Any rune icon', descHu: 'Bármely rúna ikon' },
    { code: '[>]', descEn: 'Arrow', descHu: 'Nyíl' },
  ],
  onepiece: [
    { code: '[On Play]', descEn: 'Trigger badge', descHu: 'Trigger jelvény' },
    { code: '[When Attacking]', descEn: 'Attack trigger', descHu: 'Támadás trigger' },
    { code: '[Activate: Main]', descEn: 'Main ability', descHu: 'Fő képesség' },
    { code: '[Once Per Turn]', descEn: 'Limit badge', descHu: 'Körönként egyszer' },
    { code: '[Blocker]', descEn: 'Keyword badge', descHu: 'Kulcsszó jelvény' },
    { code: '[DON!! x1]', descEn: 'DON!! modifier', descHu: 'DON!! módosító' },
  ],
  lorcana: [
    { code: '{E}', descEn: 'Exert', descHu: 'Exert' },
    { code: '{L}', descEn: 'Lore', descHu: 'Lore' },
    { code: '{I}', descEn: 'Ink', descHu: 'Tinta' },
    { code: 'Shift 3', descEn: 'Keyword highlight', descHu: 'Kulcsszó kiemelés' },
  ],
  starwars: [
    { code: '{C=1}', descEn: 'Cost circle', descHu: 'Költség kör' },
    { code: '{Exhaust}', descEn: 'Exhaust badge', descHu: 'Exhaust jelvény' },
  ],
  fab: [
    { code: '{p}', descEn: 'Attack (ATK)', descHu: 'Támadás (ATK)' },
    { code: '{d}', descEn: 'Defense (DEF)', descHu: 'Védekezés (DEF)' },
    { code: '{r}', descEn: 'Resource Pitch', descHu: 'Pitch (R)' },
    { code: '{h}', descEn: 'Life / HP', descHu: 'Élet (HP)' },
  ],
};

interface CardMarkupHelpProps {
  game?: string;
  onInsert?: (code: string) => void;
}

export function CardMarkupHelp({ game = 'riftbound', onInsert }: CardMarkupHelpProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const normalized = (game || 'riftbound').toLowerCase();
  const specific = GAME_TOKENS[normalized] || GAME_TOKENS.riftbound;

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer hover:underline"
        style={{ color: 'var(--text-accent)' }}
      >
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>{open ? t('Hide formatting', 'Parancsok elrejtése') : t('Formatting commands', 'Formázási parancsok')}</span>
      </button>

      {open && (
        <div
          className="mt-2 rounded-lg border p-2.5 space-y-2 text-[11px]"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
        >
          <div className="flex flex-wrap gap-1.5">
            {[...specific, ...COMMON_TOKENS].map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => onInsert?.(item.code)}
                title={t(item.descEn, item.descHu)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded border text-left transition hover:border-[var(--accent)] cursor-pointer"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                <code className="font-mono font-bold text-[10px]" style={{ color: 'var(--text-accent)' }}>
                  {item.code}
                </code>
                <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  {t(item.descEn, item.descHu)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
