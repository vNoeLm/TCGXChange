import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';
import {
  fetchSiteFlags,
  getSiteFlags,
  publishSiteFlags,
  type SiteFeatureFlags,
} from '../../lib/siteFlags';

interface FlagRowDef {
  key: keyof SiteFeatureFlags;
  labelEn: string;
  labelHu: string;
}

const FLAG_ROWS: FlagRowDef[] = [
  {
    key: 'p2p_public',
    labelEn: 'Marketplace & P2P Messages',
    labelHu: 'Piactér és P2P üzenetek',
  },
  {
    key: 'store_public',
    labelEn: 'Store & Store Support',
    labelHu: 'Bolt és Ügyfélszolgálat',
  },
  {
    key: 'official_company_info',
    labelEn: 'Official Company Info (Footer)',
    labelHu: 'Hivatalos cégadatok (lábléc)',
  },
];

export function SiteVisibilityPanel({ onToast }: { onToast?: (msg: string) => void }) {
  const { t } = useLanguage();
  const [flags, setFlags] = useState<SiteFeatureFlags>(() => getSiteFlags());
  const [savingKey, setSavingKey] = useState<keyof SiteFeatureFlags | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSiteFlags(true).then(setFlags);
  }, []);

  const toggleFlag = async (key: keyof SiteFeatureFlags) => {
    const nextValue = !flags[key];
    setSavingKey(key);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Authentication required.');

      const res = await fetch('/api/site-flags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: nextValue }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !json?.flags) {
        throw new Error(json?.error || t('Failed to save visibility.', 'Nem sikerült menteni a beállítást.'));
      }
      setFlags(json.flags);
      publishSiteFlags(json.flags);
      onToast?.(
        nextValue
          ? t('Set to Public.', 'Nyilvánosra állítva.')
          : t('Set to Private (admin only).', 'Privátra állítva (csak admin).')
      );
    } catch (err: any) {
      setError(err?.message || t('Failed to update.', 'Sikertelen frissítés.'));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
          {t('Module Visibility', 'Modul láthatóság')}
        </h3>
        {error && (
          <span className="text-xs font-semibold" style={{ color: 'var(--negative)' }}>
            {error}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {FLAG_ROWS.map((row) => {
          const isPublic = flags[row.key];
          const busy = savingKey === row.key;
          return (
            <div
              key={row.key}
              className="rounded-lg border px-3.5 py-2.5 flex items-center justify-between gap-3"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
            >
              <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                {t(row.labelEn, row.labelHu)}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                disabled={busy}
                onClick={() => toggleFlag(row.key)}
                className="px-2.5 py-1 rounded-md text-[11px] font-bold border cursor-pointer transition shrink-0 disabled:opacity-50"
                style={
                  isPublic
                    ? {
                        background: 'var(--positive-muted)',
                        borderColor: 'var(--positive-border)',
                        color: 'var(--positive)',
                      }
                    : {
                        background: 'var(--bg-input)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-secondary)',
                      }
                }
              >
                {busy
                  ? '…'
                  : isPublic
                    ? t('Public', 'Nyilvános')
                    : t('Private', 'Privát')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
