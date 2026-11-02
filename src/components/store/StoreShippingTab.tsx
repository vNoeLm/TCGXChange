import { useEffect, useState } from 'react';
import {
  STORE_SHIPPING_METHODS,
  notifyStoreShippingUpdated,
  type StoreShippingMethod,
} from '../../lib/storeCart';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { storeApi } from './storeClient';

export function StoreShippingTab() {
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();
  const [methods, setMethods] = useState<StoreShippingMethod[]>(STORE_SHIPPING_METHODS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bulkThreshold, setBulkThreshold] = useState<string>('25000');

  const loadShipping = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await storeApi<{ methods?: StoreShippingMethod[]; error?: string }>('/api/store/shipping');
      if (res.ok && Array.isArray(res.data.methods) && res.data.methods.length > 0) {
        setMethods(res.data.methods);
        const firstPaidWithThreshold = res.data.methods.find((m) => m.feeHuf > 0 && m.freeAboveHuf && m.freeAboveHuf > 0);
        if (firstPaidWithThreshold?.freeAboveHuf) {
          setBulkThreshold(String(firstPaidWithThreshold.freeAboveHuf));
        }
      }
    } catch (e) {
      console.error('Failed to load store shipping methods:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShipping();
  }, []);

  const updateMethod = (index: number, patch: Partial<StoreShippingMethod>) => {
    setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
    setMessage(null);
  };

  const applyBulkFreeThreshold = () => {
    const parsed = bulkThreshold.trim() === '' ? null : Math.max(0, Math.round(Number(bulkThreshold)));
    if (parsed !== null && !Number.isFinite(parsed)) return;
    setMethods((prev) =>
      prev.map((m) => {
        if (m.id === 'pickup' || m.feeHuf === 0) return m;
        return { ...m, freeAboveHuf: parsed };
      })
    );
    setMessage({
      type: 'success',
      text:
        parsed === null
          ? t('Removed free shipping threshold from all paid methods. Click "Save Shipping Settings" to publish.', 'Ingyenes szállítási értékhatár eltávolítva az összes fizetős módból. Kattints a "Beállítások mentése" gombra a közzétételhez.')
          : t(`Applied ${parsed.toLocaleString('hu-HU')} Ft free-shipping threshold to all paid methods. Click "Save Shipping Settings" to publish.`, `Alkalmazva ${parsed.toLocaleString('hu-HU')} Ft ingyenes szállítási értékhatár minden fizetős módra. Kattints a "Beállítások mentése" gombra a közzétételhez.`),
    });
  };

  const addMethod = () => {
    const slug = `custom_${Date.now().toString(36)}`;
    setMethods((prev) => [
      ...prev,
      {
        id: slug,
        label: t('New Shipping Method', 'Új szállítási mód'),
        feeHuf: 1990,
        freeAboveHuf: 25000,
        description: t('Estimated delivery in 2-4 business days', 'Várható szállítás 2-4 munkanap alatt'),
        enabled: true,
      },
    ]);
    setMessage(null);
  };

  const removeMethod = (index: number) => {
    if (methods.length <= 1) {
      setMessage({ type: 'error', text: t('At least one shipping method must remain.', 'Legalább egy szállítási módnak maradnia kell.') });
      return;
    }
    setMethods((prev) => prev.filter((_, i) => i !== index));
    setMessage(null);
  };

  const resetDefaults = () => {
    if (!window.confirm(t('Reset Store shipping methods to the default configuration?', 'Visszaállítod a Store szállítási módokat az alapértelmezett beállításokra?'))) return;
    setMethods(STORE_SHIPPING_METHODS);
    setBulkThreshold('25000');
    setMessage({ type: 'success', text: t('Restored default shipping methods. Click "Save Shipping Settings" to publish.', 'Alapértelmezett szállítási módok visszaállítva. Kattints a "Beállítások mentése" gombra a közzétételhez.') });
  };

  const saveShipping = async () => {
    const enabledCount = methods.filter((m) => m.enabled !== false).length;
    if (enabledCount === 0) {
      setMessage({ type: 'error', text: t('Please keep at least one shipping method enabled for checkout.', 'Kérjük, hagyj legalább egy szállítási módot bekapcsolva a pénztárhoz.') });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await storeApi<{ ok?: boolean; methods?: StoreShippingMethod[]; error?: string }>('/api/store/shipping', {
        method: 'POST',
        body: JSON.stringify({ methods }),
      });
      if (res.ok && res.data.methods) {
        setMethods(res.data.methods);
        notifyStoreShippingUpdated(res.data.methods);
        setMessage({ type: 'success', text: t('Store shipping methods and free-shipping thresholds saved.', 'Store szállítási módok és ingyenességi értékhatárok elmentve.') });
      } else {
        setMessage({ type: 'error', text: res.data.error || t('Could not save shipping configuration.', 'Nem sikerült menteni a szállítási konfigurációt.') });
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || t('Network error while saving shipping configuration.', 'Hálózati hiba a szállítási konfiguráció mentése közben.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Toolbar */}
      <div
        className="p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-3"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {/* Quick Free Shipping Threshold */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            {t('Free shipping over:', 'Ingyenes szállítás ettől:')}
          </span>
          <div className="relative">
            <input
              type="number"
              min={0}
              step={500}
              value={bulkThreshold}
              onChange={(e) => setBulkThreshold(e.target.value)}
              placeholder={t('None', 'Nincs')}
              className="w-32 px-2.5 py-1.5 pr-8 rounded-lg border text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>
              Ft
            </span>
          </div>
          <button
            type="button"
            onClick={applyBulkFreeThreshold}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer hover:bg-[var(--bg-raised)]"
            style={{ borderColor: 'var(--accent-border)', background: 'var(--accent-muted)', color: 'var(--text-accent)' }}
          >
            {t('Apply to all paid', 'Minden fizetősre')}
          </button>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={resetDefaults}
            className="px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer hover:bg-[var(--bg-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Reset', 'Alaphelyzet')}
          </button>
          <button
            type="button"
            onClick={addMethod}
            className="px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer hover:bg-[var(--bg-raised)] inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-surface-2)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('Add method', 'Mód hozzáadása')}
          </button>
          <button
            type="button"
            onClick={saveShipping}
            disabled={saving || loading}
            className="px-4 py-1.5 rounded-xl text-xs font-black transition cursor-pointer shadow-sm active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {saving ? t('Saving...', 'Mentés...') : t('Save Settings', 'Beállítások mentése')}
          </button>
        </div>
      </div>

        {message && (
          <div
            role="status"
            className="p-3 rounded-xl border text-xs font-medium flex items-center gap-2"
            style={
              message.type === 'success'
                ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
                : { background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }
            }
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              {message.type === 'success' ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </>
              )}
            </svg>
            <span>{message.text}</span>
          </div>
        )}

      {/* Methods List */}
      {loading ? (
        <div
          className="p-8 rounded-2xl border text-center text-xs"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          {t('Loading Store shipping configuration...', 'Store szállítási konfiguráció betöltése...')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {methods.map((method, idx) => {
            const isEnabled = method.enabled !== false;
            const isAlwaysFree = method.feeHuf === 0 || method.freeAboveHuf === 0;
            return (
              <div
                key={`${method.id}-${idx}`}
                className={`p-4 rounded-2xl border transition ${isEnabled ? '' : 'opacity-65'}`}
                style={{ background: 'var(--bg-surface)', borderColor: isEnabled ? 'var(--border)' : 'var(--border-subtle)' }}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left: Toggle + Label + Description */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <label className="inline-flex items-center gap-2 pt-1 cursor-pointer select-none shrink-0">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => updateMethod(idx, { enabled: e.target.checked })}
                        className="w-4 h-4 rounded accent-[var(--accent)] cursor-pointer"
                      />
                      <span
                        className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border"
                        style={
                          isEnabled
                            ? { background: 'var(--positive-muted)', color: 'var(--positive)', borderColor: 'var(--positive-border)' }
                            : { background: 'var(--bg-surface-2)', color: 'var(--text-muted)', borderColor: 'var(--border)' }
                        }
                      >
                        {isEnabled ? t('Active', 'Aktív') : t('Hidden', 'Rejtett')}
                      </span>
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                          {t('Method Name', 'Mód neve')}
                        </label>
                        <input
                          type="text"
                          value={method.label}
                          onChange={(e) => updateMethod(idx, { label: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-lg border text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                          {t('Subtitle / Delivery Note', 'Alcím / Szállítási megjegyzés')}
                        </label>
                        <input
                          type="text"
                          value={method.description}
                          onChange={(e) => updateMethod(idx, { description: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right: Fee HUF + Free Above HUF + Preview + Delete */}
                  <div className="flex flex-wrap sm:flex-nowrap items-end gap-3 shrink-0">
                    <div className="w-36">
                      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                        {t('Shipping Price (HUF)', 'Szállítási díj (Ft)')}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={method.feeHuf}
                          onChange={(e) => {
                            const fee = Math.max(0, Math.round(Number(e.target.value) || 0));
                            updateMethod(idx, {
                              feeHuf: fee,
                              freeAboveHuf: fee === 0 ? 0 : method.freeAboveHuf === 0 ? 25000 : method.freeAboveHuf,
                            });
                          }}
                          className="w-full px-3 py-1.5 pr-8 rounded-lg border text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>
                          Ft
                        </span>
                      </div>
                    </div>

                    <div className="w-44">
                      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                        {t('Free Above (HUF)', 'Ingyenes felette (Ft)')}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          step={500}
                          disabled={method.feeHuf === 0}
                          value={method.feeHuf === 0 ? 0 : method.freeAboveHuf ?? ''}
                          placeholder={t('Never free', 'Soha nem ingyenes')}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            updateMethod(idx, {
                              freeAboveHuf: raw === '' ? null : Math.max(0, Math.round(Number(raw) || 0)),
                            });
                          }}
                          className="w-full px-3 py-1.5 pr-8 rounded-lg border text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>
                          Ft
                        </span>
                      </div>
                    </div>

                    <div
                      className="px-3 py-1.5 rounded-lg border text-[11px] min-w-[140px]"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                    >
                      <div className="font-bold" style={{ color: isAlwaysFree ? 'var(--positive)' : 'var(--text-primary)' }}>
                        {isAlwaysFree ? t('Always Free', 'Mindig ingyenes') : formatPrice(method.feeHuf)}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {isAlwaysFree
                          ? t('No shipping fee', 'Nincs szállítási díj')
                          : method.freeAboveHuf && method.freeAboveHuf > 0
                            ? `${t('Free over', 'Ingyenes felette:')} ${formatPrice(method.freeAboveHuf)}`
                            : t('No free threshold', 'Nincs ingyenes határ')}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeMethod(idx)}
                      title={t('Remove shipping method', 'Szállítási mód törlése')}
                      aria-label={t('Remove shipping method', 'Szállítási mód törlése')}
                      className="p-2 rounded-lg border transition cursor-pointer hover:bg-[var(--bg-raised)] hover:text-red-400"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
