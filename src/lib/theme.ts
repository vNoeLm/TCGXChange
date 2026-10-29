import { useState, useEffect } from 'react';

export type ThemeMode = 'auto' | 'dark' | 'light' | 'custom';
export type ActiveTheme = 'dark' | 'light' | 'custom';

export const THEME_OVERRIDE_KEY = 'tcg_theme_override';
export const ACTIVE_GAME_KEY = 'tcg_active_game';
export const CUSTOM_THEME_STORAGE_KEY = 'tcg_custom_theme';

export interface CustomThemeConfig {
  bgPage: string;
  bgSurface: string;
  bgSurface2: string;
  accent: string;
  accentSecondary?: string;
  textPrimary: string;
  textMuted?: string;
  border?: string;
  borderRadius?: number;
  glowIntensity?: number;
}

export const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
  bgPage: '#0b0f19',
  bgSurface: '#121826',
  bgSurface2: '#1a2336',
  accent: '#a855f7',
  accentSecondary: '#06b6d4',
  textPrimary: '#f8fafc',
  textMuted: '#94a3b8',
  border: 'rgba(168, 85, 247, 0.3)',
  borderRadius: 12,
  glowIntensity: 50,
};

export const CUSTOM_PRESETS: { name: string; config: CustomThemeConfig }[] = [
  {
    name: 'Neon Cyber',
    config: {
      bgPage: '#080811',
      bgSurface: '#111222',
      bgSurface2: '#181932',
      accent: '#06b6d4',
      textPrimary: '#f0fdfa',
      border: 'rgba(6, 182, 212, 0.35)',
    },
  },
  {
    name: 'Amethyst Vault',
    config: {
      bgPage: '#0d0a1a',
      bgSurface: '#17122c',
      bgSurface2: '#221b3e',
      accent: '#a855f7',
      textPrimary: '#faf5ff',
      border: 'rgba(168, 85, 247, 0.35)',
    },
  },
  {
    name: 'Emerald Core',
    config: {
      bgPage: '#06120d',
      bgSurface: '#0c2218',
      bgSurface2: '#133224',
      accent: '#10b981',
      textPrimary: '#ecfdf5',
      border: 'rgba(16, 185, 129, 0.35)',
    },
  },
  {
    name: 'Crimson Sunset',
    config: {
      bgPage: '#12070a',
      bgSurface: '#200e14',
      bgSurface2: '#2e141c',
      accent: '#f43f5e',
      textPrimary: '#fff1f2',
      border: 'rgba(244, 63, 94, 0.35)',
    },
  },
  {
    name: 'Solar Flare',
    config: {
      bgPage: '#130d04',
      bgSurface: '#241a08',
      bgSurface2: '#33250c',
      accent: '#f59e0b',
      textPrimary: '#fffbeb',
      border: 'rgba(245, 158, 11, 0.35)',
    },
  },
];

export function getCustomTheme(): CustomThemeConfig {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_THEME;
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_CUSTOM_THEME, ...parsed };
      }
    }
  } catch (e) {}
  return DEFAULT_CUSTOM_THEME;
}

export function applyCustomThemeStyles(config: CustomThemeConfig = getCustomTheme()) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (config.bgPage) root.style.setProperty('--custom-bg-page', config.bgPage);
  if (config.bgSurface) root.style.setProperty('--custom-bg-surface', config.bgSurface);
  if (config.bgSurface2) root.style.setProperty('--custom-bg-surface-2', config.bgSurface2);
  if (config.accent) root.style.setProperty('--custom-accent', config.accent);
  if (config.accentSecondary) {
    root.style.setProperty('--custom-accent-secondary', config.accentSecondary);
  } else {
    root.style.removeProperty('--custom-accent-secondary');
  }
  if (config.textPrimary) root.style.setProperty('--custom-text-primary', config.textPrimary);
  if (config.textMuted) {
    root.style.setProperty('--custom-text-muted', config.textMuted);
  } else {
    root.style.removeProperty('--custom-text-muted');
  }
  if (config.border) {
    root.style.setProperty('--custom-border', config.border);
  } else {
    root.style.removeProperty('--custom-border');
  }
  if (config.borderRadius !== undefined) {
    root.style.setProperty('--custom-radius', `${config.borderRadius}px`);
  } else {
    root.style.setProperty('--custom-radius', '12px');
  }
  if (config.glowIntensity !== undefined) {
    const gf = config.glowIntensity / 50;
    root.style.setProperty('--custom-glow', String(config.glowIntensity));
    root.style.setProperty('--custom-glow-pct', `${Math.round(28 * gf)}%`);
    root.style.setProperty('--custom-shadow-glow', `${Math.round(16 * gf)}px`);
  } else {
    root.style.setProperty('--custom-glow', '50');
    root.style.setProperty('--custom-glow-pct', '28%');
    root.style.setProperty('--custom-shadow-glow', '16px');
  }
}

export function saveCustomTheme(config: Partial<CustomThemeConfig>): CustomThemeConfig {
  const current = getCustomTheme();
  const updated: CustomThemeConfig = { ...current, ...config };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {}
    applyCustomThemeStyles(updated);
    window.dispatchEvent(new CustomEvent('tcg-custom-theme-change', { detail: updated }));
  }
  return updated;
}

export function getThemeOverride(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = localStorage.getItem(THEME_OVERRIDE_KEY);
    if (saved === 'riftbound') {
      localStorage.setItem(THEME_OVERRIDE_KEY, 'dark');
      return 'dark';
    }
    if (saved === 'dark' || saved === 'light' || saved === 'custom' || saved === 'auto') {
      return saved as ThemeMode;
    }
  } catch (e) {}
  return 'auto';
}

export function getActiveGame(): string {
  if (typeof window === 'undefined') return 'riftbound';
  try {
    return localStorage.getItem(ACTIVE_GAME_KEY) || 'riftbound';
  } catch (e) {
    return 'riftbound';
  }
}

export function getEffectiveTheme(activeGame?: string): ActiveTheme {
  const override = getThemeOverride();
  if (override === 'custom') return 'custom';
  if (override === 'light') return 'light';
  if (override === 'dark') return 'dark';

  // 'auto' mode: dynamically respects OS prefers-color-scheme
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  }
  // Midnight Slate is the default dark theme
  return 'dark';
}

export function applySiteTheme(activeGame?: string): ActiveTheme {
  if (typeof window === 'undefined') return 'dark';
  const effective = getEffectiveTheme(activeGame);
  try {
    document.documentElement.setAttribute('data-theme', effective);
    if (effective === 'custom') {
      applyCustomThemeStyles();
    }
    window.dispatchEvent(
      new CustomEvent('tcg-theme-change', {
        detail: {
          theme: effective,
          override: getThemeOverride(),
        },
      })
    );
  } catch (e) {}
  return effective;
}

export function setThemeOverride(mode: ThemeMode): ActiveTheme {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(THEME_OVERRIDE_KEY, mode);
    } catch (e) {}
  }
  return applySiteTheme();
}

export function useSiteTheme(cardGame?: string): {
  theme: ActiveTheme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isRiftbound: boolean;
  isDark: boolean;
  isLight: boolean;
  isCustom: boolean;
} {
  const [themeMode, setModeState] = useState<ThemeMode>(() => getThemeOverride());
  const [theme, setTheme] = useState<ActiveTheme>(() => getEffectiveTheme(cardGame));

  useEffect(() => {
    const current = getEffectiveTheme(cardGame);
    setTheme(current);
    setModeState(getThemeOverride());
    if (current === 'custom') {
      applyCustomThemeStyles();
    }

    const handleThemeChange = (e: Event) => {
      const custom = e as CustomEvent<{ theme: ActiveTheme; override: ThemeMode }>;
      if (custom.detail?.theme) {
        setTheme(custom.detail.theme);
      }
      if (custom.detail?.override) {
        setModeState(custom.detail.override);
      } else {
        setModeState(getThemeOverride());
      }
    };

    const handleGameChange = (e: Event) => {
      const custom = e as CustomEvent<{ game: string }>;
      const newGame = custom.detail?.game || cardGame;
      const effective = getEffectiveTheme(newGame);
      setTheme(effective);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', effective);
        if (effective === 'custom') {
          applyCustomThemeStyles();
        }
      }
    };

    const handleCustomThemeChange = () => {
      if (getThemeOverride() === 'custom') {
        applyCustomThemeStyles();
      }
    };

    // Auto mode listener for system dark/light switch
    const mediaQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null;

    const handleMediaChange = () => {
      if (getThemeOverride() === 'auto') {
        const nextEffective = getEffectiveTheme(cardGame);
        setTheme(nextEffective);
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', nextEffective);
        }
      }
    };

    window.addEventListener('tcg-theme-change', handleThemeChange);
    window.addEventListener('tcg-game-change', handleGameChange);
    window.addEventListener('tcg-custom-theme-change', handleCustomThemeChange);
    if (mediaQuery && mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange);
    }

    return () => {
      window.removeEventListener('tcg-theme-change', handleThemeChange);
      window.removeEventListener('tcg-game-change', handleGameChange);
      window.removeEventListener('tcg-custom-theme-change', handleCustomThemeChange);
      if (mediaQuery && mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      }
    };
  }, [cardGame]);

  const updateMode = (mode: ThemeMode) => {
    setThemeOverride(mode);
    setModeState(mode);
    const nextTheme = getEffectiveTheme(cardGame);
    setTheme(nextTheme);
  };

  return {
    theme,
    themeMode,
    setThemeMode: updateMode,
    isRiftbound: false,
    isDark: theme === 'dark',
    isLight: theme === 'light',
    isCustom: theme === 'custom',
  };
}
