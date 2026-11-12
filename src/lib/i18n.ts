import { useCallback, useSyncExternalStore } from 'react';

export type Language = 'en' | 'hu';

export const LANG_STORAGE_KEY = 'tcg_lang';
export const LEGAL_LANG_STORAGE_KEY = 'tcg_legal_lang';
export const LEGACY_LOCALE_KEY = 'tcg_locale';
export const LANG_EVENT = 'tcg-lang-change';

export function detectDefaultLanguage(): Language {
  if (typeof window === 'undefined') return 'hu';
  try {
    const saved =
      localStorage.getItem(LANG_STORAGE_KEY) ||
      localStorage.getItem(LEGAL_LANG_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_LOCALE_KEY);
    if (saved === 'en' || saved === 'hu') return saved;

    const languages = navigator.languages || [navigator.language || ''];
    for (const l of languages) {
      if (l && l.toLowerCase().startsWith('hu')) {
        return 'hu';
      }
    }
  } catch {}
  return 'hu';
}

export function getLanguage(): Language {
  if (typeof window === 'undefined') return 'hu';
  try {
    const saved =
      localStorage.getItem(LANG_STORAGE_KEY) ||
      localStorage.getItem(LEGAL_LANG_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_LOCALE_KEY);
    if (saved === 'en' || saved === 'hu') return saved;
  } catch {}
  return detectDefaultLanguage();
}

const listeners = new Set<() => void>();
let globalListenersAttached = false;

function notifyLanguageListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function ensureGlobalListeners() {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;

  const handleLangEvent = () => {
    notifyLanguageListeners();
  };

  const handleStorage = (e: StorageEvent) => {
    if (
      e.key === null ||
      e.key === LANG_STORAGE_KEY ||
      e.key === LEGAL_LANG_STORAGE_KEY ||
      e.key === LEGACY_LOCALE_KEY
    ) {
      notifyLanguageListeners();
    }
  };

  window.addEventListener(LANG_EVENT, handleLangEvent);
  window.addEventListener('storage', handleStorage);
}

function subscribeLanguage(listener: () => void): () => void {
  ensureGlobalListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerLanguageSnapshot(): Language {
  return 'hu';
}

export function setLanguage(lang: Language): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
    localStorage.setItem(LEGAL_LANG_STORAGE_KEY, lang);
    localStorage.setItem(LEGACY_LOCALE_KEY, lang);
    document.documentElement.setAttribute('lang', lang);
  } catch {}
  window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: { lang } }));
  notifyLanguageListeners();
}

export function useLanguage() {
  const lang = useSyncExternalStore(subscribeLanguage, getLanguage, getServerLanguageSnapshot);

  const t = useCallback(
    <T,>(en: T, hu: T): T => (lang === 'hu' ? hu : en),
    [lang]
  );

  return {
    lang,
    isHu: lang === 'hu',
    setLanguage,
    t,
  };
}

export const STORE_CATEGORY_LABELS_HU: Record<string, string> = {
  singles: 'Egyedi kártyák (Singles)',
  sealed: 'Bontatlan termékek',
  sleeves: 'Kártyavédő fóliák (Sleeves)',
  deck_boxes: 'Paklitartók (Deck Box)',
  binders: 'Albumok és mappák',
  playmats: 'Játszószőnyegek (Playmat)',
  protection: 'Toploaderek és védelem',
  storage: 'Tárolódobozok és archívumok',
  toploaders: 'Toploaderek és merevítők',
  accessories: 'Dobókockák és kiegészítők',
  dice: 'Kockák és jelölők',
  other: 'Egyéb kiegészítők',
};

const DYNAMIC_CATEGORY_LABELS_HU: Record<string, string> = {};

export function registerCategoryTranslations(categories: { id: string; label?: string; label_hu?: string }[]): void {
  if (!Array.isArray(categories)) return;
  for (const c of categories) {
    if (c?.id && c.label_hu) {
      DYNAMIC_CATEGORY_LABELS_HU[c.id] = c.label_hu;
    }
  }
}

export function translateStoreCategory(id: string, fallbackEn: string, lang: Language, explicitHu?: string): string {
  if (lang === 'hu') {
    if (explicitHu) return explicitHu;
    if (DYNAMIC_CATEGORY_LABELS_HU[id]) return DYNAMIC_CATEGORY_LABELS_HU[id];
    if (STORE_CATEGORY_LABELS_HU[id]) return STORE_CATEGORY_LABELS_HU[id];
  }
  return fallbackEn;
}
