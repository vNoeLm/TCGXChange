import { useEffect, useMemo, useState } from 'react';
import { STORE_BRANDS, STORE_CATEGORIES, STORE_GAMES, IMPORT_BATCH_SIZE } from '../../lib/storeConstants';
import { useLanguage } from '../../lib/i18n';
import { rowsFromCsv, type CsvParseResult } from '../../lib/storeCsv';
import type { ImportDefaults } from '../../lib/storeImport';
import type { StoreProductCategory } from '../../types';
import { storeApi } from './storeClient';

interface ResultItem {
  line: number;
  sku: string;
  name: string;
  action: 'create' | 'update' | 'error';
  error?: string;
}

interface Totals {
  created: number;
  updated: number;
  errors: number;
}

const TEMPLATE = [
  'sku,ean,name,brand,category,game,price,cost,stock,supplier,variant_group,variant_label,variant_kind,color,size,image_url',
  'UG-KAT-BLK,4056133011166,Ultimate Guard Katana Sleeves Standard (100) - Black,Ultimate Guard,sleeves,universal,4990,3200,24,Acme Distribution,ug-katana-standard-100,Black,color,Black,Standard,https://example.com/katana-black.jpg',
  'UG-KAT-RED,4056133011173,Ultimate Guard Katana Sleeves Standard (100) - Red,Ultimate Guard,sleeves,universal,4990,3200,10,Acme Distribution,ug-katana-standard-100,Red,color,Red,Standard,https://example.com/katana-red.jpg',
].join('\n');

const inputClass = 'w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

/**
 * Partner price-list import. The file is parsed in the browser, then sent in small batches: first as a
 * dry run (nothing is written) so you see what will be created / updated / rejected, then for real.
 */
export function StoreImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [category, setCategory] = useState<string>('');
  const [brand, setBrand] = useState('');
  const [game, setGame] = useState<string>('');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState<null | 'preview' | 'import'>(null);
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [items, setItems] = useState<ResultItem[]>([]);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const defaults = useMemo<ImportDefaults>(() => {
    const d: ImportDefaults = {};
    if (category) d.category = category as StoreProductCategory;
    if (brand.trim()) d.brand = brand.trim();
    if (game) d.game = game === 'universal' ? null : game;
    if (supplier.trim()) d.supplier = supplier.trim();
    return d;
  }, [category, brand, game, supplier]);

  const reset = () => {
    setTotals(null);
    setItems([]);
    setApplied(false);
    setError(null);
  };

  // A preview only describes the defaults it was run with, so changing them invalidates it.
  useEffect(() => {
    if (!busy && !applied) {
      setTotals(null);
      setItems([]);
    }
  }, [defaults]);

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    setParsed(rowsFromCsv(await file.text()));
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'store-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const run = async (dryRun: boolean) => {
    if (!parsed) return;
    reset();
    setBusy(dryRun ? 'preview' : 'import');
    setProgress(0);
    const sum: Totals = { created: 0, updated: 0, errors: 0 };
    const all: ResultItem[] = [];

    for (let i = 0; i < parsed.rows.length; i += IMPORT_BATCH_SIZE) {
      const batch = parsed.rows.slice(i, i + IMPORT_BATCH_SIZE);
      const res = await storeApi<{ summary?: Totals; items?: ResultItem[]; error?: string }>('/api/store/import', {
        method: 'POST',
        body: JSON.stringify({ rows: batch, defaults, dryRun }),
      });
      if (!res.ok || !res.data.summary) {
        setError(res.data.error || 'The import request failed.');
        break;
      }
      sum.created += res.data.summary.created;
      sum.updated += res.data.summary.updated;
      sum.errors += res.data.summary.errors;
      all.push(...(res.data.items || []));
      setProgress(Math.min(100, Math.round(((i + batch.length) / parsed.rows.length) * 100)));
    }

    setTotals(sum);
    setItems(all);
    setApplied(!dryRun);
    setBusy(null);
    if (!dryRun) onDone();
  };

  const problems = items.filter((i) => i.action === 'error');
  const fileIssues = parsed?.issues ?? [];
  const canRun = Boolean(parsed && parsed.rows.length > 0 && !busy);

  return (
    <div className="fixed inset-0 z-[120] flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-label={t('Import products from CSV', 'Termékek importálása CSV-ből')} className="relative w-full max-w-2xl rounded-2xl border shadow-2xl p-5 sm:p-6 my-6 z-10" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between pb-4 border-b mb-5" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <h2 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>{t('Import from CSV', 'Importálás CSV-ből')}</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {t('Products are matched by SKU: known SKUs are updated (only the columns in your file), new SKUs are created as drafts.', 'A termékek azonosítása cikkszám (SKU) alapján történik: a meglévő cikkszámok frissülnek, az új cikkszámok vázlatként jönnek létre.')}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label={t('Close', 'Bezárás')} className="p-1.5 rounded-lg border cursor-pointer hover:bg-[var(--bg-raised)]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="px-4 py-2 text-xs font-bold rounded-xl border cursor-pointer" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)' }}>
              {fileName ? t('Choose another file', 'Másik fájl választása') : t('Choose CSV file', 'CSV fájl kiválasztása')}
              <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{fileName || t('Comma, semicolon or tab separated', 'Vesszővel, pontosvesszővel vagy tabulátorral tagolt')}</span>
            <button type="button" onClick={downloadTemplate} className="ml-auto text-xs font-bold underline underline-offset-2 cursor-pointer" style={{ color: 'var(--text-accent)' }}>
              {t('Download template', 'Sablon letöltése')}
            </button>
          </div>

          {parsed && (
            <>
              <div className="p-3 rounded-xl border text-xs space-y-1.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <p style={{ color: 'var(--text-primary)' }}>
                  <strong>{parsed.rows.length}</strong> {t('rows read', 'sor beolvasva')}
                  {fileIssues.length > 0 && <span style={{ color: 'var(--negative)' }}>, {fileIssues.length} {t('unreadable', 'nem olvasható')}</span>}
                </p>
                <p style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t('Recognised columns:', 'Felismerve:')} </span>
                  {parsed.mappedColumns.length ? parsed.mappedColumns.join(', ') : t('none', 'egyik sem')}
                </p>
                {parsed.unknownColumns.length > 0 && (
                  <p style={{ color: '#eab308' }}>{t('Ignored columns:', 'Figyelmen kívül hagyva:')} {parsed.unknownColumns.join(', ')}</p>
                )}
              </div>

              <fieldset className="p-3 rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
                <legend className="px-1 text-xs font-black" style={{ color: 'var(--text-secondary)' }}>{t('Defaults for new products', 'Alapértelmezések új termékekhez')}</legend>
                <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>{t('Used only when the file has no such column. Existing products are never changed by these.', 'Csak akkor kerül felhasználásra, ha a fájlban nincs ilyen oszlop. Meglévő termékeket nem módosít.')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('Default category', 'Alapértelmezett kategória')} className={`${inputClass} cursor-pointer`} style={inputStyle}>
                    <option value="">{t('Category: from file', 'Kategória: fájlból')}</option>
                    {STORE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <input list="import-brands" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder={t('Brand: from file', 'Márka: fájlból')} aria-label={t('Default brand', 'Alapértelmezett márka')} className={inputClass} style={inputStyle} />
                  <datalist id="import-brands">{STORE_BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
                  <select value={game} onChange={(e) => setGame(e.target.value)} aria-label={t('Default game', 'Alapértelmezett játék')} className={`${inputClass} cursor-pointer`} style={inputStyle}>
                    <option value="">{t('Game: from file', 'Játék: fájlból')}</option>
                    {STORE_GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t('Supplier: from file', 'Beszállító: fájlból')} aria-label={t('Default supplier', 'Alapértelmezett beszállító')} className={inputClass} style={inputStyle} />
                </div>
              </fieldset>
            </>
          )}

          {busy && (
            <div role="status" aria-live="polite">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
                <div className="h-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent-strong)' }} />
              </div>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{busy === 'preview' ? t('Checking', 'Ellenőrzés') : t('Importing', 'Importálás')}... {progress}%</p>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 rounded-xl text-xs border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>{error}</div>
          )}

          {totals && (
            <div className="p-3 rounded-xl border text-xs" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <p className="font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>{applied ? t('Import finished', 'Importálás befejezve') : t('Preview (nothing saved yet)', 'Előnézet (még semmi sincs mentve)')}</p>
              <p style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--positive)' }}>{totals.created} {applied ? t('created', 'létrehozva') : t('will be created', 'lesz létrehozva')}</span>
                {' | '}
                <span style={{ color: 'var(--text-accent)' }}>{totals.updated} {applied ? t('updated', 'frissítve') : t('will be updated', 'lesz frissítve')}</span>
                {' | '}
                <span style={{ color: totals.errors ? 'var(--negative)' : 'var(--text-muted)' }}>{totals.errors} {t('rejected', 'elutasítva')}</span>
              </p>
            </div>
          )}

          {(problems.length > 0 || fileIssues.length > 0) && (
            <div className="max-h-44 overflow-y-auto rounded-xl border custom-scrollbar" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-xs">
                <caption className="sr-only">{t('Rows that cannot be imported', 'Nem importálható sorok')}</caption>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-bold px-3 py-2 w-16">{t('Line', 'Sor')}</th>
                    <th className="text-left font-bold px-3 py-2">{t('Problem', 'Hiba')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...fileIssues.map((i) => ({ line: i.line, text: i.message })), ...problems.map((p) => ({ line: p.line, text: `${p.sku ? `${p.sku}: ` : ''}${p.error}` }))]
                    .sort((a, b) => a.line - b.line)
                    .slice(0, 100)
                    .map((row, idx) => (
                      <tr key={idx} className="border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                        <td className="px-3 py-1.5 tabular-nums">{row.line}</td>
                        <td className="px-3 py-1.5">{row.text}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <button type="button" onClick={onClose} disabled={Boolean(busy)} className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              {applied ? t('Close', 'Bezárás') : t('Cancel', 'Mégse')}
            </button>
            {!applied && (
              <>
                <button type="button" onClick={() => run(true)} disabled={!canRun} className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-surface-2)' }}>
                  {t('Preview', 'Előnézet')}
                </button>
                <button
                  type="button"
                  onClick={() => run(false)}
                  disabled={!canRun || !totals || totals.created + totals.updated === 0}
                  title={!totals ? t('Run a preview first', 'Először futtass előnézetet') : undefined}
                  className="px-5 py-2 rounded-xl text-xs font-bold shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {t('Import', 'Importálás')} {totals ? `${totals.created + totals.updated} ` : ''}{t('products', 'termék')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
