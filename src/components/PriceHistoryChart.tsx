import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../lib/useExitTransition';
import { useCardValueData } from '../lib/cardValues';
import { eurToHuf } from '../lib/priceSuggestion';
import { hasFoilVariant } from '../lib/cardVariants';
import { useCurrency } from '../lib/currency';
import { backdropCloseProps } from '../lib/modalBackdrop';
import { useLanguage } from '../lib/i18n';

/** Blue for the market reference, amber for what really sold here. Fixed series colors, deliberately not theme-tied, so the two lines stay distinguishable from each other on every theme. */
const MARKET_COLOR = '#60a5fa';
const SOLD_COLOR = '#f59e0b';

interface HistoryResponse {
  success: boolean;
  current: { price_eur: number | null; price_foil_eur: number | null; updated_at: string | null } | null;
  market: { at: string; eur: number | null; foil_eur: number | null }[];
  history_available: boolean;
  sales: { at: string; price_huf: number; quantity: number; is_foil: boolean }[];
}

interface PriceHistoryChartProps {
  cardId: string;
  card: { id: string; rarity?: string | null; is_foil?: boolean; game?: string | null };
  initialFoil?: boolean;
}

const PAD = { left: 56, right: 14, top: 12, bottom: 26 };
/** The inline chart is compact; the expanded one gets a much taller, wider drawing area. */
const DIMS = {
  small: { W: 720, H: 230, font: 11 },
  large: { W: 1100, H: 460, font: 13 },
};

type Range = '1w' | '1m' | '1y' | 'all';
const RANGES: { id: Range; label: string; title: string; days: number | null }[] = [
  { id: '1w', label: 'Week', title: 'Last 7 days', days: 7 },
  { id: '1m', label: 'Month', title: 'Last 30 days', days: 30 },
  { id: '1y', label: 'Year', title: 'Last 365 days', days: 365 },
  { id: 'all', label: 'All', title: 'All time', days: null },
];
const DAY_MS = 86400000;

const fmtHuf = (n: number) => `${Math.round(n).toLocaleString('hu-HU')} Ft`;
const fmtDay = (t: number, lang = 'en') => new Date(t).toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-GB', { day: 'numeric', month: 'short' });
const fmtDayYear = (t: number, lang = 'en') => new Date(t).toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The UTC calendar day a time falls on, as a sortable grouping key. */
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * More than one price recorded on the same day (e.g. two uploads in one day) used to plot as
 * separate points directly above each other - just a vertical line, not a trend. They are
 * collapsed to their day's average instead, plotted at noon UTC that day.
 */
function averageByDay(points: { t: number; huf: number }[]): { t: number; huf: number; count: number }[] {
  const byDay = new Map<string, { sum: number; count: number }>();
  for (const p of points) {
    const entry = byDay.get(dayKey(p.t)) ?? { sum: 0, count: 0 };
    entry.sum += p.huf;
    entry.count += 1;
    byDay.set(dayKey(p.t), entry);
  }
  return [...byDay.entries()]
    .map(([key, { sum, count }]) => ({ t: Date.parse(`${key}T12:00:00Z`), huf: sum / count, count }))
    .sort((a, b) => a.t - b.t);
}

/** Same idea for sales: same-day sales average their price and add up their copies. */
function averageSoldByDay(points: { t: number; huf: number; quantity: number }[]): { t: number; huf: number; quantity: number; count: number }[] {
  const byDay = new Map<string, { sum: number; quantity: number; count: number }>();
  for (const p of points) {
    const entry = byDay.get(dayKey(p.t)) ?? { sum: 0, quantity: 0, count: 0 };
    entry.sum += p.huf;
    entry.quantity += p.quantity;
    entry.count += 1;
    byDay.set(dayKey(p.t), entry);
  }
  return [...byDay.entries()]
    .map(([key, { sum, quantity, count }]) => ({ t: Date.parse(`${key}T12:00:00Z`), huf: sum / count, quantity, count }))
    .sort((a, b) => a.t - b.t);
}

/** A round step for the price axis, so its labels are 500, 1 000, 2 000 rather than odd numbers. */
function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}

type Series = {
  market: { t: number; huf: number; count: number }[];
  sold: { t: number; huf: number; quantity: number; count: number }[];
};

/** A small segmented control, styled like the existing Normal/Foil one. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`px-2.5 h-7 text-xs font-bold cursor-pointer transition ${value === o.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
          style={{ background: value === o.id ? 'var(--bg-raised)' : 'var(--bg-input)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ChartViewProps {
  data: HistoryResponse | null;
  failed: boolean;
  series: Series | null;
  range: Range;
  setRange: (r: Range) => void;
  twoFinishes: boolean;
  foil: boolean;
  setFoil: (f: boolean) => void;
  large?: boolean;
  onToggleExpand: () => void;
}

/** Everything drawn: the legend and controls, the plot, and the summary line. Used inline and expanded. */
function ChartView({ data, failed, series, range, setRange, twoFinishes, foil, setFoil, large = false, onToggleExpand }: ChartViewProps) {
  const { W, H, font } = large ? DIMS.large : DIMS.small;
  const { currency, formatPrice, eurHufRate } = useCurrency();
  const { t, lang } = useLanguage();
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const windowDays = RANGES.find((r) => r.id === range)?.days ?? null;
  // A year of data puts many more points on the same width; smaller dots keep the trend visible.
  const pointScale = range === '1y' ? 0.62 : 1;

  const chart = useMemo(() => {
    if (!series || (series.market.length === 0 && series.sold.length === 0)) return null;

    const now = Date.now();
    const times = [...series.market.map((m) => m.t), ...series.sold.map((s) => s.t)];
    let tMin = Math.min(...times);
    const tMax = Math.max(now, ...times);
    if (windowDays !== null) tMin = tMax - windowDays * DAY_MS;
    // A single day of data would otherwise be a single vertical line.
    else if (tMax - tMin < 7 * DAY_MS) tMin = tMax - 7 * DAY_MS;

    const prices = [...series.market.map((m) => m.huf), ...series.sold.map((s) => s.huf)];
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    if (hi === lo) {
      lo *= 0.8;
      hi *= 1.2;
    }
    const step = niceStep(hi - lo, large ? 6 : 4);
    const yMin = Math.max(0, Math.floor((lo - (hi - lo) * 0.1) / step) * step);
    const yMax = Math.ceil((hi + (hi - lo) * 0.1) / step) * step;

    const x = (t: number) => PAD.left + ((t - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

    // Straight line from point to point; the last price then holds flat through to today.
    const path = series.market
      .map((m, i) => `${i === 0 ? 'M' : 'L'}${x(m.t)},${y(m.huf)}`)
      .join(' ');
    const last = series.market[series.market.length - 1];
    const tail = last ? `${path} L${x(tMax)},${y(last.huf)}` : '';

    // Sold copies as a line too, so a run of sales reads as a trend instead of scattered dots.
    const soldPath = series.sold.length > 1
      ? series.sold.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.t)},${y(s.huf)}`).join(' ')
      : '';

    const yTicks: number[] = [];
    for (let v = yMin; v <= yMax + step / 2; v += step) yTicks.push(v);
    const xTicks = [0, 1, 2, 3].map((i) => tMin + ((tMax - tMin) * i) / 3);

    return { x, y, tail, soldPath, yTicks, xTicks, tMin, tMax };
  }, [series, windowDays, large, W, H]);

  const summary = useMemo(() => {
    if (!series || series.market.length === 0) return null;
    const last = series.market[series.market.length - 1];
    const prev = series.market[series.market.length - 2];
    const change = prev ? ((last.huf - prev.huf) / prev.huf) * 100 : null;
    return { last, prev, change };
  }, [series]);

  // A year-long axis needs the year on its labels; a week does not.
  const fmtTick = (t: number) =>
    (windowDays !== null && windowDays >= 120) || (chart !== null && chart.tMax - chart.tMin >= 120 * DAY_MS)
      ? `${new Date(t).toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-GB', { month: 'short' })} '${String(new Date(t).getFullYear()).slice(2)}`
      : fmtDay(t, lang);

  return (
    <section className={large ? 'p-2' : 'px-4 sm:px-6 py-4 border-b lg:border-b-0'} style={large ? undefined : { borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mb-3">
        <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>{t('Price history', 'Ártörténet')}</h3>
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={MARKET_COLOR} strokeWidth="2.5" strokeLinecap="round" /></svg>
          {t('Market reference', 'Piaci referencia')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill={SOLD_COLOR} /></svg>
          {t('Sold on the site', 'Itt elkelt')}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          <Segmented
            label={t('Time range', 'Időtartam')}
            options={[
              { id: '1w', label: t('Week', 'Hét'), title: t('Last 7 days', 'Utolsó 7 nap') },
              { id: '1m', label: t('Month', 'Hónap'), title: t('Last 30 days', 'Utolsó 30 nap') },
              { id: '1y', label: t('Year', 'Év'), title: t('Last 365 days', 'Utolsó 365 nap') },
              { id: 'all', label: t('All', 'Mind'), title: t('All time', 'Kezdettől') },
            ]}
            value={range}
            onChange={setRange}
          />
          {twoFinishes && (
            <Segmented
              label={t('Finish', 'Kivitel')}
              options={[{ id: 'normal', label: t('Normal', 'Normál') }, { id: 'foil', label: 'Foil' }]}
              value={foil ? 'foil' : 'normal'}
              onChange={(v) => setFoil(v === 'foil')}
            />
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={large ? t('Close expanded chart', 'Nagyított grafikon bezárása') : t('Expand chart', 'Grafikon nagyítása')}
            title={large ? t('Close', 'Bezárás') : t('Expand chart', 'Grafikon nagyítása')}
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg border cursor-pointer transition"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {large ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            )}
          </button>
        </div>
      </div>

      {failed ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('The price history could not be loaded.', 'Nem sikerült betölteni az ártörténetet.')}</p>
      ) : !data ? (
        <div className="rounded-xl animate-pulse" style={{ background: 'var(--bg-surface-2)', height: large ? 460 : 230 }} aria-label={t('Loading price history', 'Ártörténet betöltése…')} />
      ) : !chart ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
          {!data.history_available
            ? t('The price history is not set up yet.', 'Az ártörténet még nincs beállítva.')
            : range === 'all'
              ? t('There is no price data for this card yet.', 'Még nincs áradat ehhez a kártyához.')
              : t('There is no price data in this time range.', 'Ebben az időszakban nincs áradat.')}
        </p>
      ) : (
        <>
          <div className={`relative ${large ? '' : 'max-w-[760px] mx-auto'}`}>
            <svg viewBox={`0 0 ${W} ${H}`} className={`w-full h-auto block ${large ? '' : 'max-h-[220px]'}`} role="img" aria-label={t('Price history chart', 'Ártörténet grafikon')} onMouseLeave={() => setHover(null)}>
              {chart.yTicks.map((v) => (
                <g key={v}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={chart.y(v)} y2={chart.y(v)} stroke="currentColor" strokeOpacity="0.09" style={{ color: 'var(--border)' }} />
                  <text x={PAD.left - 8} y={chart.y(v) + 4} textAnchor="end" fontSize={font} fill="currentColor" style={{ color: 'var(--text-muted)' }}>
                    {currency === 'EUR' ? `${(v / eurHufRate).toFixed(v / eurHufRate < 10 ? 1 : 0)}€` : v >= 10000 ? `${Math.round(v / 1000)}k` : v.toLocaleString('hu-HU')}
                  </text>
                </g>
              ))}
              {chart.xTicks.map((t, i) => (
                <text key={i} x={chart.x(t)} y={H - 7} textAnchor={i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'} fontSize={font} fill="currentColor" style={{ color: 'var(--text-muted)' }}>
                  {fmtTick(t)}
                </text>
              ))}

              {chart.tail && <path d={chart.tail} fill="none" stroke={MARKET_COLOR} strokeWidth={large ? 3 : 2.5} strokeLinejoin="round" strokeLinecap="round" />}
              {series!.market.map((m, i) => (
                <g key={`m${i}`}>
                  <circle cx={chart.x(m.t)} cy={chart.y(m.huf)} r={(large ? 4.5 : 3.5) * pointScale} fill={MARKET_COLOR} />
                  <circle
                    cx={chart.x(m.t)} cy={chart.y(m.huf)} r="12" fill="transparent"
                    onMouseEnter={() => setHover({
                      x: chart.x(m.t), y: chart.y(m.huf),
                      lines: [m.count > 1 ? (lang === 'hu' ? `Piaci referencia (${m.count} db átlaga aznap)` : `Market reference (avg of ${m.count} that day)`) : t('Market reference', 'Piaci referencia'), formatPrice(m.huf), fmtDayYear(m.t, lang)],
                    })}
                  />
                </g>
              ))}
              {chart.soldPath && <path d={chart.soldPath} fill="none" stroke={SOLD_COLOR} strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />}
              {series!.sold.map((s, i) => (
                <g key={`s${i}`}>
                  <circle cx={chart.x(s.t)} cy={chart.y(s.huf)} r={(large ? 6 : 5) * pointScale} fill={SOLD_COLOR} stroke="var(--bg-surface)" strokeWidth="1.5" />
                  <circle
                    cx={chart.x(s.t)} cy={chart.y(s.huf)} r="13" fill="transparent"
                    onMouseEnter={() => setHover({
                      x: chart.x(s.t), y: chart.y(s.huf),
                      lines: [
                        s.count > 1 ? (lang === 'hu' ? `Elkelt (${s.count} eladás átlaga, ${s.quantity} db)` : `Sold (avg of ${s.count} sales, ${s.quantity} copies)`) : (lang === 'hu' ? `Elkelt${s.quantity > 1 ? ` (${s.quantity} db)` : ''}` : `Sold${s.quantity > 1 ? ` (${s.quantity} copies)` : ''}`),
                        formatPrice(s.huf),
                        fmtDayYear(s.t, lang),
                      ],
                    })}
                  />
                </g>
              ))}
            </svg>

            {hover && (
              <div
                className="absolute pointer-events-none rounded-lg px-2.5 py-1.5 text-xs shadow-lg border"
                style={{
                  left: `${(hover.x / W) * 100}%`,
                  top: `${(hover.y / H) * 100}%`,
                  transform: `translate(${hover.x > W * 0.7 ? '-105%' : '8%'}, -110%)`,
                  background: 'var(--bg-surface-2)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                }}
              >
                <div className="font-bold">{hover.lines[0]}</div>
                <div className="font-black">{hover.lines[1]}</div>
                <div style={{ color: 'var(--text-tertiary)' }}>{hover.lines[2]}</div>
              </div>
            )}
          </div>

          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {summary
              ? summary.change === null
                ? (lang === 'hu' ? `Piaci referencia: ${formatPrice(summary.last.huf)} (${fmtDay(summary.last.t, lang)} óta). ` : `Market reference: ${formatPrice(summary.last.huf)} since ${fmtDay(summary.last.t, lang)}. `)
                : (lang === 'hu' ? `Piaci referencia: ${formatPrice(summary.last.huf)}, ${summary.change >= 0 ? '+' : ''}${Math.abs(summary.change).toFixed(0)}% változás (${fmtDay(summary.last.t, lang)}). ` : `Market reference: ${formatPrice(summary.last.huf)}, ${summary.change >= 0 ? 'up' : 'down'} ${Math.abs(summary.change).toFixed(0)}% on ${fmtDay(summary.last.t, lang)}. `)
              : ''}
            {(() => {
              const saleCount = series!.sold.reduce((sum, s) => sum + s.count, 0);
              return saleCount === 0
                ? t('Nothing has sold on the site yet.', 'Még nem kelt el példány az oldalon.')
                : (lang === 'hu' ? `${saleCount} eladás történt az oldalon.` : `${saleCount} sale${saleCount === 1 ? '' : 's'} on the site.`);
            })()}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * How a card's price has moved: the market reference as a solid line and the prices copies
 * actually sold for on the site as dots joined by a dashed line. What is listed for sale right
 * now is not part of it. The range and finish controls scope the plot; the expand button opens
 * the same chart much larger.
 */
export function PriceHistoryChart({ cardId, card, initialFoil }: PriceHistoryChartProps) {
  const { t } = useLanguage();
  const values = useCardValueData();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [foil, setFoil] = useState(Boolean(initialFoil));
  const [range, setRange] = useState<Range>('all');
  const [expanded, setExpanded] = useState(false);
  const expandAnim = useExitTransition(expanded, 250);

  // Only Common and Uncommon come in two finishes; the rest are one entry.
  const twoFinishes = hasFoilVariant({ ...card, is_foil: initialFoil });

  useEffect(() => {
    setFoil(Boolean(initialFoil));
  }, [cardId, initialFoil]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetch(`/api/cards/price-history?card_id=${encodeURIComponent(cardId)}`)
      .then((r) => r.json())
      .then((json: HistoryResponse) => {
        if (cancelled) return;
        if (json.success) setData(json);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const series = useMemo<Series | null>(() => {
    if (!data) return null;
    const toHuf = (eur: number | null | undefined) => (eur ? eurToHuf(eur, values.eurHuf) : null);

    let market = data.market
      .map((m) => ({ t: Date.parse(m.at), huf: toHuf(twoFinishes && foil ? m.foil_eur ?? m.eur : m.eur) }))
      .filter((m): m is { t: number; huf: number } => Number.isFinite(m.t) && m.huf !== null);

    // Without a history yet, the price the card has now is still the first point.
    if (market.length === 0 && data.current) {
      const eur = twoFinishes && foil ? data.current.price_foil_eur ?? data.current.price_eur : data.current.price_eur;
      const huf = toHuf(eur);
      const t = data.current.updated_at ? Date.parse(data.current.updated_at) : NaN;
      if (huf !== null) market = [{ t: Number.isFinite(t) ? t : Date.now(), huf }];
    }

    const sold = data.sales
      .filter((s) => !twoFinishes || s.is_foil === foil)
      .map((s) => ({ t: Date.parse(s.at), huf: s.price_huf, quantity: s.quantity }))
      .filter((s) => Number.isFinite(s.t));

    const days = RANGES.find((r) => r.id === range)?.days ?? null;
    const cutoff = days === null ? -Infinity : Date.now() - days * DAY_MS;

    let marketDays = averageByDay(market);
    if (days !== null) {
      // The price in force when the window opens is still the starting point of the line, not a gap.
      const before = marketDays.filter((m) => m.t < cutoff).pop();
      marketDays = marketDays.filter((m) => m.t >= cutoff);
      if (before && (marketDays.length === 0 || marketDays[0].t > cutoff)) {
        marketDays.unshift({ t: cutoff, huf: before.huf, count: 1 });
      }
    }
    const soldDays = averageSoldByDay(sold).filter((s) => s.t >= cutoff);

    return { market: marketDays, sold: soldDays };
  }, [data, values.eurHuf, twoFinishes, foil, range]);

  const shared = { data, failed, series, range, setRange, twoFinishes, foil, setFoil };

  return (
    <>
      <ChartView {...shared} onToggleExpand={() => setExpanded(true)} />
      {expandAnim.rendered && typeof document !== 'undefined' && createPortal(
        <div
          // React events bubble through portals to the modal this chart sits in, which would close it.
          {...backdropCloseProps(() => setExpanded(false), { stopPropagation: true })}
          data-state={expandAnim.state}
          className="tv-overlay fixed inset-0 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
          style={{ zIndex: 10001 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-state={expandAnim.state}
            role="dialog"
            aria-modal="true"
            aria-label={t('Price history, expanded', 'Ártörténet nagyítva')}
            className="tv-modal-panel w-full max-w-6xl my-auto rounded-2xl border shadow-2xl p-3 sm:p-5"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <ChartView {...shared} large onToggleExpand={() => setExpanded(false)} />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
