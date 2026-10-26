import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardListingGroup } from '../../lib/marketplaceGrouping';
import type { InventoryCard } from '../../types';
import { cardThumbProps } from '../../lib/supabase';
import { splitCardTitle, formatCleanCardNumber } from '../../lib/formatGameText';
import { getListingDescription } from '../../lib/sellerNotes';
import { useCurrency } from '../../lib/currency';
import { PriceHistoryChart } from './PriceHistoryChart';
import { cartQuantityFor, addToCart, removeFromCart, updateCartItemQuantity } from '../../lib/marketplaceCart';
import { useCart } from '../../lib/useCart';
import { useCurrentUserId } from '../../lib/useCurrentUserId';
import { CountryFlag } from '../CountryFlag';
import { OWNER_ID } from '../../lib/constants';
import { resolveSellerTier } from '../../lib/badges';
import { isOvernumbered, isAltArt } from '../../lib/cardVariants';
import { ListingLikeButton } from './ListingLikeButton';

const fmtHuf = (n: number) =>
  new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n);

const CONDITION_ORDER = ['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

function shortCondition(c?: string): string {
  switch ((c || '').trim().toLowerCase()) {
    case 'mint': return 'M';
    case 'near mint': return 'NM';
    case 'lightly played': return 'LP';
    case 'moderately played': return 'MP';
    case 'heavily played': return 'HP';
    case 'damaged': return 'DMG';
    default: return c || 'NM';
  }
}

type ListingSort = 'price_asc' | 'price_desc' | 'condition' | 'quantity';

// Seller | Description | Condition | Amount | Price | (View). On a phone the seller, price and View share
// the first line and the rest wrap underneath.
//
// Gated on the *panel's own* width via a container query, not the viewport - this table lives in
// the narrower right-hand column of a two-panel layout that only goes side-by-side at `lg`, and
// even then the panel is well under 720px until the modal itself widens at `2xl`. Gating on a
// viewport breakpoint (the old `md:`) turned the desktop grid on long before the panel actually
// had room for it: the Description track (min 0) collapsed to zero while Seller/Condition held
// their 150px floors, so Description effectively vanished into Condition and the row still didn't
// fit, forcing the whole thing to scroll horizontally.
const ROW_COLUMNS = '@[720px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1.8fr)_minmax(0,1.3fr)_80px_110px_96px]';

interface CardListingsModalProps {
  group: CardListingGroup;
  onClose: () => void;
  onSelectListing: (inventoryId: string) => void;
}

/** Every active listing of one card with its price, condition and seller, cheapest first. */
export function CardListingsModal({ group, onClose, onSelectListing }: CardListingsModalProps) {
  const { formatPrice } = useCurrency();
  const card = group.representative;
  const imagePath = card.card_image_path || card.image_path;
  const { main, sub } = splitCardTitle(card.name);

  const cart = useCart();
  const currentUserId = useCurrentUserId();
  const isOwnListing = (l: InventoryCard) => Boolean(currentUserId && l.seller_id === currentUserId);
  const inCartFor = (l: InventoryCard) => cartQuantityFor(cart, l.inventory_id);
  const leftFor = (l: InventoryCard) => Math.max(0, (l.quantity || 0) - inCartFor(l));

  const [sort, setSort] = useState<ListingSort>('price_asc');
  const [foilOnly, setFoilOnly] = useState(false);
  const [condition, setCondition] = useState('All');


  const conditions = useMemo(
    () => Array.from(new Set(group.listings.map(l => l.condition || 'Near Mint')))
      .sort((a, b) => CONDITION_ORDER.indexOf(a) - CONDITION_ORDER.indexOf(b)),
    [group]
  );

  const visible = useMemo(() => {
    const rows = group.listings.filter(l =>
      (!foilOnly || l.is_foil) && (condition === 'All' || (l.condition || 'Near Mint') === condition)
    );
    return rows.sort((a, b) => {
      if (sort === 'price_desc') return (b.price_huf || 0) - (a.price_huf || 0);
      if (sort === 'quantity') return (b.quantity || 0) - (a.quantity || 0);
      if (sort === 'condition') {
        return CONDITION_ORDER.indexOf(a.condition || 'Near Mint') - CONDITION_ORDER.indexOf(b.condition || 'Near Mint')
          || (a.price_huf || 0) - (b.price_huf || 0);
      }
      return (a.price_huf || Infinity) - (b.price_huf || Infinity);
    });
  }, [group, sort, foilOnly, condition]);

  const rowSeller = (l: InventoryCard) => l.seller_name || 'Community Seller';

  const [addedId, setAddedId] = useState<string | null>(null);

  const handleAddToCart = (e: React.MouseEvent, l: InventoryCard) => {
    e.stopPropagation();
    if (isOwnListing(l) || l.status === 'On Hold' || l.status === 'Reserved' || l.status === 'Sold' || leftFor(l) <= 0) return;
    addToCart({
      inventoryId: l.inventory_id,
      sellerId: l.seller_id || '',
      sellerName: rowSeller(l),
      cardName: card.name,
      cardNumber: card.card_number,
      imagePath: imagePath || undefined,
      priceHuf: l.price_huf || 0,
      quantity: 1,
      maxQuantity: Math.max(1, l.quantity || 1),
      isFoil: Boolean(l.is_foil),
      condition: l.condition || 'Near Mint',
      handoverMethods: (l as any).handover_methods,
      sellerCountry: l.seller_country || 'HU',
    });
    setAddedId(l.inventory_id);
    setTimeout(() => {
      setAddedId((curr) => (curr === l.inventory_id ? null : curr));
    }, 1200);
  };

  // No isOpen prop - the parent mounts/unmounts this directly, so there's no signal to hold it
  // for an exit transition. This still gives a real entrance instead of an instant pop-in.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  const renderCartAction = (l: InventoryCard) => {
    // A seller cannot buy their own copy: the price row shows a muted note instead of Add.
    if (isOwnListing(l)) {
      return (
        <span
          className="inline-flex items-center justify-center w-[82px] py-1.5 rounded-lg text-[10px] font-bold border cursor-default"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
          title="This is your own listing"
        >
          Your listing
        </span>
      );
    }
    if (l.status === 'On Hold' || l.status === 'Reserved') {
      return (
        <span
          className="inline-flex items-center justify-center gap-1 w-[82px] py-1.5 rounded-lg text-[10px] font-bold border cursor-default uppercase tracking-wider"
          style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}
          title="This listing is currently on hold"
        >
          <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>On Hold</span>
        </span>
      );
    }
    if (inCartFor(l) > 0) {
      return (
        <div className="flex flex-col items-center gap-1">
          <span
            className="text-[10px] font-bold tracking-tight select-none leading-none"
            style={{ color: 'var(--positive)' }}
          >
            {inCartFor(l)} in cart
          </span>
          <div
            className="inline-flex items-center rounded-lg border overflow-hidden shadow-xs h-[28px]"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const cur = inCartFor(l);
                if (cur <= 1) {
                  removeFromCart(l.inventory_id);
                } else {
                  updateCartItemQuantity(l.inventory_id, cur - 1);
                }
              }}
              aria-label="Decrease quantity in cart"
              title="Decrease quantity or remove"
              className="w-7 h-full flex items-center justify-center cursor-pointer hover:bg-[var(--bg-raised)] transition"
              style={{ color: 'var(--text-secondary)' }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <span
              className="min-w-[28px] px-1 text-center text-xs font-black tabular-nums"
              style={{ color: 'var(--text-accent)' }}
              title={`${inCartFor(l)} in cart`}
            >
              {inCartFor(l)}
            </span>
            <button
              type="button"
              disabled={leftFor(l) <= 0}
              onClick={(e) => handleAddToCart(e, l)}
              aria-label="Increase quantity in cart"
              title={leftFor(l) <= 0 ? 'No more copies available' : 'Add another copy'}
              className="w-7 h-full flex items-center justify-center cursor-pointer hover:bg-[var(--bg-raised)] transition disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ color: 'var(--text-secondary)' }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      );
    }
    if (leftFor(l) > 0) {
      return (
        <button
          type="button"
          onClick={(e) => handleAddToCart(e, l)}
          className="inline-flex items-center justify-center gap-1.5 w-[82px] py-1.5 rounded-lg text-xs font-bold cursor-pointer transition hover:brightness-110 active:scale-95 shadow-sm whitespace-nowrap"
          style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          title={`Add to cart from ${rowSeller(l)}`}
        >
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
          </svg>
          <span>Add</span>
        </button>
      );
    }
    return (
      <span className="w-[82px] py-1.5 text-center text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        Sold out
      </span>
    );
  };

  const content = (
    <div
      onClick={onClose}
      data-state={entered ? 'open' : 'closed'}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.85)',
        padding: 'clamp(8px, 1.2vw, 20px)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        willChange: 'opacity',
      }}
      className="tv-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-state={entered ? 'open' : 'closed'}
        className="tv-modal-panel w-full h-full max-w-none relative rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', willChange: 'transform, opacity' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-20 w-8 h-8 flex items-center justify-center rounded-lg hover:brightness-110 cursor-pointer transition shadow-sm"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        {/* Modal Scroll Container */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col">
          {/* Top Section: Card Info on Left & Price History on Right (side-by-side on lg+) */}
          <div className="flex flex-col lg:flex-row border-b shrink-0 items-start lg:items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
            {/* Card Info & Cardmarket-style Stats */}
            <div className="p-4 sm:p-5 lg:w-[420px] xl:w-[460px] lg:shrink-0 lg:border-r flex flex-col justify-center self-stretch" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex gap-4 sm:gap-6 items-start">
                <div className="relative w-24 sm:w-32 lg:w-36 shrink-0 aspect-[63/88] rounded-xl overflow-hidden border shadow-md" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                  {imagePath && <img {...cardThumbProps(imagePath, 'avatar')} alt={card.name} className="w-full h-full object-cover" />}
                  <div className="absolute bottom-1.5 left-1.5 flex flex-col items-start gap-1" style={{ zIndex: 3 }}>
                    {isAltArt(card) && (
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase tracking-wider"
                        style={{
                          background: "rgba(219, 39, 119, 0.95)",
                          color: "#ffffff",
                          border: "1px solid #f472b6",
                        }}
                      >
                        ALT ART
                      </span>
                    )}
                    {isOvernumbered(card) && (
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase tracking-wider"
                        style={{
                          background: "rgba(99, 102, 241, 0.95)",
                          color: "#ffffff",
                          border: "1px solid #818cf8",
                        }}
                      >
                        ON
                      </span>
                    )}
                  </div>
                </div>
                <div className="min-w-0 flex-1 flex flex-col justify-center">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight" style={{ color: 'var(--text-primary)' }}>{main}</h2>
                    {sub && <p className="text-xs font-bold uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {card.set_name} &middot; {formatCleanCardNumber(card.card_number)} &middot; {card.rarity}
                      </span>
                    </div>
                  </div>

                  {/* Cardmarket-style Stats List */}
                  <div className="mt-3.5 rounded-xl border divide-y overflow-hidden text-xs" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                    <div className="flex items-center justify-between px-3.5 py-1.5">
                      <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Lowest price</span>
                      <span className="font-black text-sm text-[var(--positive)]">
                        {group.lowest_price > 0 ? formatPrice(group.lowest_price) : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3.5 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Average price</span>
                      <span className="font-black text-sm" style={{ color: 'var(--text-primary)' }}>
                        {group.avg_price > 0 ? formatPrice(group.avg_price) : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3.5 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Available items</span>
                      <span className="font-bold text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {group.listing_count}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3.5 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Total copies</span>
                      <span className="font-bold text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {group.total_quantity}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Price History Chart - cleanly positioned without excess dead whitespace.
                The extra right padding keeps the chart's expand button out from under this
                modal's close button, which floats in the panel's top-right corner. */}
            <div className="flex-1 min-w-0 max-w-4xl p-2 sm:p-4 lg:pr-14 flex flex-col justify-center">
              <PriceHistoryChart
                cardId={group.card_id}
                card={{ id: group.card_id, rarity: card.rarity, is_foil: foilOnly, game: card.game }}
                initialFoil={foilOnly}
              />
            </div>
          </div>

          {/* Bottom Section: Full-width Listings Table */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="sticky top-0 z-10 flex items-center gap-2 flex-wrap px-4 sm:px-6 py-3 border-b shrink-0 shadow-xs" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as ListingSort)}
                className="h-8 px-2.5 rounded-lg text-xs font-semibold border cursor-pointer" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="condition">Condition: best first</option>
                <option value="quantity">Most copies</option>
              </select>
              {conditions.length > 1 && (
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="h-8 px-2.5 rounded-lg text-xs font-semibold border cursor-pointer" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <option value="All">All conditions</option>
                  {conditions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {group.has_foil && (
                <button
                  type="button"
                  onClick={() => setFoilOnly(f => !f)}
                  className={`h-8 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${foilOnly ? 'bg-sky-500/20 text-sky-300 border-sky-500/50' : 'hover:text-[var(--text-secondary)]'}`}
                  style={foilOnly ? undefined : { background: 'var(--bg-input)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
                >
                  Foil only
                </button>
              )}
              <span className="hidden sm:inline text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>Click any listing to view photos &amp; details</span>
              <span className="ml-auto text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>{visible.length} shown</span>
            </div>

            <div className="px-3 sm:px-6 py-2 [container-type:inline-size] flex-1">
              <div className={`hidden @[720px]:grid ${ROW_COLUMNS} items-center px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider border-b`} style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                <div className="px-3 border-r text-center" style={{ borderColor: 'var(--border-subtle)' }}>Seller</div>
                <div className="px-3 border-r text-center" style={{ borderColor: 'var(--border-subtle)' }}>Description</div>
                <div className="px-3 border-r text-center" style={{ borderColor: 'var(--border-subtle)' }}>Condition</div>
                <div className="px-1.5 border-r text-center" style={{ borderColor: 'var(--border-subtle)' }}>Amount</div>
                <div className="px-2 border-r text-center" style={{ borderColor: 'var(--border-subtle)' }}>Price</div>
                <div className="pl-2 text-center">Cart</div>
              </div>
              {visible.length === 0 ? (
                <p className="text-center text-sm py-10" style={{ color: 'var(--text-muted)' }}>No listings match these filters.</p>
              ) : (
                <div className="flex flex-col">
                  {visible.map((l, i) => {
                    const onHold = l.status === 'On Hold' || l.status === 'Reserved';
                    const sellerTier = resolveSellerTier(l);
                    const isOwner = sellerTier.isOwner;
                    const hasPhotos = Boolean((l.inventory_images && l.inventory_images.length > 0) || l.inventory_image || ((l as any).images && (l as any).images.length > 0));
                    const photoCount = (l.inventory_images && l.inventory_images.length > 0)
                      ? l.inventory_images.length
                      : (((l as any).images && (l as any).images.length > 0)
                      ? (l as any).images.length
                      : (l.inventory_image ? 1 : 0));
                    const description = getListingDescription(l.notes);

                    return (
                      <div
                        key={l.inventory_id}
                        onClick={() => {
                          if (onHold) return;
                          onSelectListing(l.inventory_id);
                        }}
                        title={onHold ? "This listing is currently on hold" : "Click to view full photos and seller details"}
                        className={`listing-row px-3 py-3 sm:py-3.5 rounded-xl transition-all ${
                          onHold ? 'cursor-not-allowed opacity-80' : 'cursor-pointer hover:bg-[var(--bg-surface-2)]/80 group'
                        }`}
                        style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}
                        role="button"
                        tabIndex={onHold ? -1 : 0}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !onHold) {
                            e.preventDefault();
                            onSelectListing(l.inventory_id);
                          }
                        }}
                      >
                        {/* MOBILE VIEW (< 720px): 2 clean rows */}
                        <div className="@[720px]:hidden flex flex-col gap-2 w-full">
                          {/* Row 1: Profile + Tags in one line */}
                          <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                            <div
                              className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (l.seller_id) {
                                  window.location.href = `/user?id=${l.seller_id}`;
                                }
                              }}
                            >
                              {l.seller_avatar ? (
                                <img src={l.seller_avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 border" style={{ borderColor: 'var(--border)' }} />
                              ) : (
                                <span className="w-5 h-5 rounded-full flex items-center justify-center font-black text-[10px] shrink-0 border" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}>
                                  {rowSeller(l)[0].toUpperCase()}
                                </span>
                              )}
                              <CountryFlag countryCode={l.seller_country || 'HU'} className="w-3.5 h-2.5 rounded-[2px] shrink-0" />
                              <span className="text-xs sm:text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{rowSeller(l)}</span>
                              {isOwner && (
                                <span
                                  className="text-[9px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wider inline-flex items-center gap-1 shrink-0"
                                  style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}
                                  title="Platform Owner"
                                >
                                  <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                                  </svg>
                                  <span>Owner</span>
                                </span>
                              )}
                              {sellerTier.nameEn && (
                                <span
                                  className="text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center shrink-0"
                                  style={sellerTier.badgeStyle}
                                  title={`${sellerTier.nameEn} — earned from completed marketplace sales`}
                                >
                                  {sellerTier.nameEn}
                                </span>
                              )}
                            </div>
                            {l.seller_rating_avg != null && (l.seller_rating_count || 0) > 0 && (
                              <span className="text-[11px] font-bold inline-flex items-center gap-0.5 shrink-0 ml-auto" style={{ color: 'var(--text-accent)' }}>
                                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                </svg>
                                <span>{l.seller_rating_avg.toFixed(1)}</span>
                              </span>
                            )}
                          </div>

                          {/* Row 2: Condition (NM) + Camera icon | Amount | Price | Add */}
                          <div className="flex items-center justify-between gap-2 w-full pt-0.5">
                            {/* Condition + badges (abbreviated NM, camera icon only) */}
                            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                              <span className="px-1.5 py-0.5 rounded-md text-[11px] font-black border uppercase tracking-wider" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
                                {shortCondition(l.condition)}
                              </span>
                              {l.is_foil && (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                                  Foil
                                </span>
                              )}
                              {hasPhotos && (
                                <span
                                  className="inline-flex items-center justify-center p-1 rounded-md border shadow-xs"
                                  style={{ background: 'rgba(59, 130, 246, 0.18)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.45)' }}
                                  title={`${photoCount} photo${photoCount > 1 ? 's' : ''} available`}
                                >
                                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                                    <circle cx="12" cy="13" r="4" />
                                  </svg>
                                </span>
                              )}
                              {onHold && (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold border" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}>
                                  Hold
                                </span>
                              )}
                            </div>

                            {/* Amount */}
                            <div className="text-xs font-semibold px-1" style={{ color: 'var(--text-tertiary)' }}>
                              {leftFor(l)}&times;
                            </div>

                            {/* Price */}
                            <div className="text-sm font-black text-[var(--positive)] whitespace-nowrap ml-auto pr-1">
                              {l.price_huf ? formatPrice(l.price_huf) : 'N/A'}
                            </div>

                            {/* Add button / stepper */}
                            <div className="shrink-0 flex items-center gap-1.5">
                              <ListingLikeButton id={l.inventory_id} type="listing" initialCount={l.likes_count} alwaysShowCount size="sm" variant="surface" />
                              {renderCartAction(l)}
                            </div>
                          </div>
                        </div>

                        {/* DESKTOP VIEW (>= 720px): Full 6-column grid */}
                        <div className={`hidden @[720px]:grid ${ROW_COLUMNS} items-center gap-x-0 w-full`}>
                          {/* Seller Column */}
                          <div
                            className="seller-col min-w-0 px-2 @[720px]:px-3 border-r"
                            style={{ borderColor: 'var(--border-subtle)' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (l.seller_id) {
                                window.location.href = `/user?id=${l.seller_id}`;
                              }
                            }}
                          >
                            <a
                              href={l.seller_id ? `/user?id=${l.seller_id}` : undefined}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-2 min-w-0 p-1.5 -m-1.5 rounded-lg border border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-raised)] transition-all cursor-pointer group/seller"
                              title={`View ${rowSeller(l)}'s profile`}
                            >
                              {l.seller_avatar ? (
                                <img src={l.seller_avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 border" style={{ borderColor: 'var(--border)' }} />
                              ) : (
                                <span className="w-7 h-7 rounded-full flex items-center justify-center font-black text-xs shrink-0 border" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}>
                                  {rowSeller(l)[0].toUpperCase()}
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                                  <CountryFlag countryCode={l.seller_country || 'HU'} className="w-3.5 h-2.5 rounded-[2px]" />
                                  <span className="truncate">{rowSeller(l)}</span>
                                </div>
                                <div className="text-[11px] flex items-center gap-1.5 flex-wrap mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                  {isOwner && (
                                    <span
                                      className="text-[9px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wider inline-flex items-center gap-1 shrink-0"
                                      style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}
                                      title="Platform Owner"
                                    >
                                      <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                                      </svg>
                                      <span>Owner</span>
                                    </span>
                                  )}
                                  {sellerTier.nameEn && (
                                    <span
                                      className="text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center shrink-0"
                                      style={sellerTier.badgeStyle}
                                      title={`${sellerTier.nameEn} — earned from completed marketplace sales`}
                                    >
                                      {sellerTier.nameEn}
                                    </span>
                                  )}
                                  {l.seller_rating_avg != null && (l.seller_rating_count || 0) > 0 && (
                                    <span className="font-bold inline-flex items-center gap-0.5 shrink-0" style={{ color: 'var(--text-accent)' }}>
                                      <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                      </svg>
                                      <span>{l.seller_rating_avg.toFixed(1)}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </a>
                          </div>

                          {/* Description Column */}
                          <div className="min-w-0 text-xs leading-relaxed px-3 border-r text-center flex justify-center items-center" style={{ borderColor: 'var(--border-subtle)' }}>
                            {!description ? (
                              <span className="text-center block w-full" style={{ color: 'var(--text-placeholder)' }} aria-label="No description">&mdash;</span>
                            ) : (
                              <span
                                className="truncate block max-w-full text-center"
                                style={{ color: 'var(--text-secondary)' }}
                                title={description}
                              >
                                {description}
                              </span>
                            )}
                          </div>

                          {/* Condition Column */}
                          <div className="flex items-center gap-1.5 flex-wrap justify-center px-3 border-r" style={{ borderColor: 'var(--border-subtle)' }}>
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold border" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>{l.condition || 'Near Mint'}</span>
                            {l.is_foil && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">Foil</span>}
                            {hasPhotos && (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border cursor-pointer shadow-sm hover:brightness-125 transition-all"
                                style={{ background: 'rgba(59, 130, 246, 0.18)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.45)' }}
                                title={`${photoCount} real photo${photoCount > 1 ? 's' : ''} available. Click to view listing details and full photos.`}
                              >
                                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                                  <circle cx="12" cy="13" r="4" />
                                </svg>
                                <span>{photoCount > 1 ? `${photoCount} Photos` : 'Photos'}</span>
                              </span>
                            )}
                            {onHold && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold border" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}>On hold</span>}
                          </div>

                          {/* Amount Column */}
                          <div className="text-xs font-semibold text-center px-1.5 border-r" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                            {leftFor(l)}&times;
                          </div>

                          {/* Price Column */}
                          <div className="text-sm font-black text-[var(--positive)] text-center whitespace-nowrap px-2 border-r" style={{ borderColor: 'var(--border-subtle)' }}>
                            {l.price_huf ? formatPrice(l.price_huf) : 'N/A'}
                          </div>

                          {/* Add to Cart Column */}
                          <div className="pl-2 flex items-center justify-center gap-1.5 flex-wrap">
                            {renderCartAction(l)}
                            <div className="flex items-center gap-1">
                              <ListingLikeButton id={l.inventory_id} type="listing" initialCount={l.likes_count} alwaysShowCount size="sm" variant="surface" />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
