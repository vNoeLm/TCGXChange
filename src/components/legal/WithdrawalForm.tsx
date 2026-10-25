import React, { useState, useEffect, useRef } from 'react';

interface WithdrawalFormProps {
  lang?: 'hu' | 'en';
}

interface OrderLookupItem {
  id: string;
  inventory_id?: string | null;
  name: string;
  quantity: number;
  price_huf: number;
  image_path?: string | null;
  condition?: string | null;
  set_name?: string | null;
}

interface OrderLookupResult {
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  order_date: string;
  total_price_huf: number;
  items: OrderLookupItem[];
}

interface SelectedItemState {
  selected: boolean;
  returnQty: number;
  maxQty: number;
  name: string;
  price_huf: number;
}

function formatItemsSummary(itemsMap: Record<string, SelectedItemState>, userNotes: string = ''): string {
  const lines: string[] = [];
  Object.values(itemsMap).forEach((it) => {
    if (it.selected && it.returnQty > 0) {
      const priceFormatted = it.price_huf > 0 ? ` (${(it.price_huf * it.returnQty).toLocaleString('hu-HU')} Ft)` : '';
      lines.push(`${it.returnQty}x ${it.name}${priceFormatted}`);
    }
  });

  if (userNotes.trim()) {
    lines.push(`\nMegjegyzés / Notes: ${userNotes.trim()}`);
  }

  return lines.join('\n');
}

export function WithdrawalForm({ lang = 'hu' }: WithdrawalFormProps) {
  const isHu = lang === 'hu';

  // Form inputs
  const [orderNumber, setOrderNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [itemsSummary, setItemsSummary] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [reason, setReason] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Order lookup states
  const [lookupState, setLookupState] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');
  const [orderData, setOrderData] = useState<OrderLookupResult | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<string, SelectedItemState>>({});
  const [sendAllBack, setSendAllBack] = useState(true);
  const [itemsUserNotes, setItemsUserNotes] = useState('');
  const [showNotesField, setShowNotesField] = useState(false);

  // Submission state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  // Track the last looked up order string to avoid repeated requests
  const lastLookupRef = useRef<string>('');
  const debounceTimerRef = useRef<any>(null);

  const performOrderLookup = async (inputNum: string) => {
    const clean = inputNum.trim().replace(/^#/, '');
    if (!clean || clean.length < 3) {
      setLookupState('idle');
      setOrderData(null);
      return;
    }

    if (clean.toLowerCase() === lastLookupRef.current.toLowerCase() && lookupState !== 'idle') {
      return;
    }

    lastLookupRef.current = clean;
    setLookupState('searching');
    setError(null);

    try {
      const res = await fetch(`/api/store/withdrawals?lookup_order=${encodeURIComponent(clean)}`);
      const data = await res.json();

      if (res.ok && data.success && data.found && data.order) {
        const ord: OrderLookupResult = data.order;
        setOrderData(ord);
        setLookupState('found');

        // Auto-fill customer details from order
        if (ord.customer_name) setCustomerName(ord.customer_name);
        if (ord.customer_email) setCustomerEmail(ord.customer_email);
        if (ord.customer_phone) setCustomerPhone(ord.customer_phone);
        if (ord.order_date) setOrderDate(ord.order_date);

        // Populate items selection (default all selected with max quantity)
        const initialMap: Record<string, SelectedItemState> = {};
        ord.items.forEach((it) => {
          initialMap[it.id] = {
            selected: true,
            returnQty: it.quantity,
            maxQty: it.quantity,
            name: it.name,
            price_huf: it.price_huf,
          };
        });
        setSelectedItems(initialMap);
        setSendAllBack(true);
        setItemsSummary(formatItemsSummary(initialMap, itemsUserNotes));
      } else {
        setLookupState('not_found');
        setOrderData(null);
      }
    } catch (err) {
      console.warn('Order lookup error:', err);
      setLookupState('not_found');
      setOrderData(null);
    }
  };

  // Debounced lookup while typing
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const clean = orderNumber.trim().replace(/^#/, '');
    if (clean.length >= 6 && clean.toLowerCase() !== lastLookupRef.current.toLowerCase()) {
      debounceTimerRef.current = setTimeout(() => {
        performOrderLookup(clean);
      }, 600);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [orderNumber]);

  // Handle master checkbox: "Minden termék visszaküldése"
  const handleToggleSendAll = (checked: boolean) => {
    setSendAllBack(checked);
    if (!orderData) return;

    const nextMap: Record<string, SelectedItemState> = {};
    orderData.items.forEach((it) => {
      nextMap[it.id] = {
        selected: checked,
        returnQty: checked ? it.quantity : 0,
        maxQty: it.quantity,
        name: it.name,
        price_huf: it.price_huf,
      };
    });
    setSelectedItems(nextMap);
    setItemsSummary(formatItemsSummary(nextMap, itemsUserNotes));
  };

  // Handle individual item checkbox
  const handleToggleItem = (id: string, checked: boolean) => {
    setSelectedItems((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const nextItem: SelectedItemState = {
        ...current,
        selected: checked,
        returnQty: checked ? (current.returnQty > 0 ? current.returnQty : current.maxQty) : 0,
      };
      const nextMap = { ...prev, [id]: nextItem };

      // Update sendAllBack state: true if every item is selected with full quantity
      const allSelected = Object.values(nextMap).every((it) => it.selected && it.returnQty === it.maxQty);
      setSendAllBack(allSelected);
      setItemsSummary(formatItemsSummary(nextMap, itemsUserNotes));
      return nextMap;
    });
  };

  // Handle quantity changes for items with quantity > 1
  const handleUpdateItemQty = (id: string, newQty: number) => {
    setSelectedItems((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const clamped = Math.max(1, Math.min(newQty, current.maxQty));
      const nextItem: SelectedItemState = {
        ...current,
        selected: true,
        returnQty: clamped,
      };
      const nextMap = { ...prev, [id]: nextItem };
      const allSelected = Object.values(nextMap).every((it) => it.selected && it.returnQty === it.maxQty);
      setSendAllBack(allSelected);
      setItemsSummary(formatItemsSummary(nextMap, itemsUserNotes));
      return nextMap;
    });
  };

  // Handle custom user note changes
  const handleNotesChange = (text: string) => {
    setItemsUserNotes(text);
    if (orderData) {
      setItemsSummary(formatItemsSummary(selectedItems, text));
    }
  };

  // Reset order lookup
  const handleResetLookup = () => {
    setOrderNumber('');
    setLookupState('idle');
    setOrderData(null);
    setSelectedItems({});
    setSendAllBack(true);
    setItemsSummary('');
    setItemsUserNotes('');
    lastLookupRef.current = '';
  };

  // Submission handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!termsAccepted) {
      setError(
        isHu
          ? 'Kérjük, fogadd el a törvényi feltételekre vonatkozó megerősítő nyilatkozatot.'
          : 'Please accept the statutory return declaration checkbox.'
      );
      return;
    }

    // If order was loaded, ensure at least one product is selected
    if (orderData && orderData.items.length > 0) {
      const hasAnySelected = Object.values(selectedItems).some((it) => it.selected && it.returnQty > 0);
      if (!hasAnySelected) {
        setError(
          isHu
            ? 'Kérjük, válassz ki legalább egy visszaküldendő terméket a listából, vagy pipáld be a "Minden termék visszaküldése" lehetőséget.'
            : 'Please select at least one product to return, or check "Send all back".'
        );
        return;
      }
    } else if (!itemsSummary.trim()) {
      setError(
        isHu
          ? 'Kérjük, add meg a visszaküldeni kívánt termékek megnevezését és darabszámát.'
          : 'Please specify the items and quantities to be returned.'
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/store/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_number: orderNumber,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          order_date: orderDate,
          items_summary: itemsSummary,
          bank_account: bankAccount,
          reason,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || (isHu ? 'A nyilatkozat elküldése nem sikerült.' : 'Failed to submit withdrawal request.'));
      }

      setSubmittedRef(data.id || orderNumber);
    } catch (err: any) {
      setError(err.message || (isHu ? 'Hiba történt a beküldés során.' : 'An error occurred while submitting.'));
    } finally {
      setLoading(false);
    }
  };

  // Compute selected stats when items are loaded
  const selectedEntries = Object.values(selectedItems).filter((it) => it.selected && it.returnQty > 0);
  const selectedCount = selectedEntries.length;
  const selectedUnits = selectedEntries.reduce((acc, it) => acc + it.returnQty, 0);
  const selectedTotalHuf = selectedEntries.reduce((acc, it) => acc + it.returnQty * it.price_huf, 0);

  if (submittedRef) {
    return (
      <div
        className="rounded-2xl border p-6 my-6 text-center space-y-4 shadow-sm"
        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--positive-border)' }}
      >
        <div
          className="w-12 h-12 rounded-full mx-auto flex items-center justify-center border"
          style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>
          {isHu ? 'Elállási Nyilatkozat Sikeresen Rögzítve' : 'Withdrawal Request Recorded'}
        </h3>
        <p className="text-xs sm:text-sm max-w-md mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {isHu
            ? `Köszönjük! Az elállási igényedet (${orderNumber}) közvetlenül rögzítettük az adminisztrációs rendszerünkben.`
            : `Thank you! Your withdrawal request (${orderNumber}) has been recorded directly in our store administration console.`}
        </p>
        <div
          className="p-3.5 rounded-xl border text-xs text-left max-w-md mx-auto space-y-1.5"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <div className="font-bold" style={{ color: 'var(--text-primary)' }}>
            {isHu ? 'Következő lépések a termék visszaküldéséhez:' : 'Next steps for returning the item(s):'}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {isHu
              ? '1. Csomagold be biztonságosan a bontatlan / sértetlen terméket.'
              : '1. Pack the unopened / undamaged item(s) securely.'}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {isHu
              ? '2. Küldd el a visszáru raktárunk címére 14 napon belül:'
              : '2. Send the package to our returns address within 14 days:'}
            <code className="block mt-1 font-mono p-1 rounded bg-[var(--bg-raised)] text-[var(--text-primary)]">
              1000 Budapest, Minta utca 1. (Store Returns)
            </code>
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {isHu
              ? '3. A csomag beérkezése és ellenőrzése után az összeget 14 napon belül visszautaljuk a megadott bankszámlára.'
              : '3. Once received and inspected, we will refund the amount to your IBAN within 14 days.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSubmittedRef(null);
            handleResetLookup();
            setCustomerName('');
            setCustomerEmail('');
            setCustomerPhone('');
            setOrderDate('');
            setBankAccount('');
            setReason('');
            setTermsAccepted(false);
          }}
          className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)] transition"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          {isHu ? 'Új elállási nyilatkozat kitöltése' : 'Submit another withdrawal request'}
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-5 sm:p-6 my-6 shadow-sm"
      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2.5 mb-4 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div
          className="w-8 h-8 rounded-lg border flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-black" style={{ color: 'var(--text-primary)' }}>
            {isHu ? 'Online Elállási Nyilatkozat és Bejelentés' : 'Online Withdrawal & Return Form'}
          </h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {isHu
              ? 'Add meg a rendelésszámodat az adatok és tételek automatikus betöltéséhez, majd válaszd ki a visszaküldendő termékeket.'
              : 'Enter your order number to look up your order, auto-fill your details, and select which items to return.'}
          </p>
        </div>
      </div>

      {error && (
        <div
          className="p-3 mb-4 rounded-xl border text-xs flex items-center gap-2"
          style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Order lookup status notifications */}
      {lookupState === 'found' && orderData && (
        <div
          className="p-3 mb-4 rounded-xl border text-xs flex items-center justify-between gap-3"
          style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="truncate">
              {isHu
                ? `Rendelés megtalálva (${orderData.order_number})! Adatok és megrendelt tételek automatikusan betöltve.`
                : `Order found (${orderData.order_number})! Customer details and items successfully loaded.`}
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetLookup}
            className="text-[11px] font-bold underline shrink-0 cursor-pointer hover:opacity-80"
          >
            {isHu ? 'Másik keresése' : 'Search another'}
          </button>
        </div>
      )}

      {lookupState === 'not_found' && (
        <div
          className="p-3 mb-4 rounded-xl border text-xs flex items-center gap-2"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-primary)' }}
        >
          <svg className="w-4 h-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            {isHu
              ? 'Nem található rendelés ezzel a számmal. Kérjük, ellenőrizd az e-mailben kapott azonosítót, vagy töltsd ki az adatokat manuálisan.'
              : 'No order found with this number. Please check the order confirmation email or enter details manually.'}
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Order Number Row with Integrated Lookup Action */}
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {isHu ? 'Rendelésszám *' : 'Order Number *'}
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                required
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onBlur={() => {
                  if (orderNumber.trim().length >= 4) {
                    performOrderLookup(orderNumber);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    performOrderLookup(orderNumber);
                  }
                }}
                placeholder={isHu ? 'pl. ORD-20261025-C101' : 'e.g. ORD-20261025-C101'}
                className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition font-mono"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
              {lookupState === 'searching' && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--accent)]">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={lookupState === 'searching' || !orderNumber.trim()}
              onClick={() => performOrderLookup(orderNumber)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer disabled:opacity-40 inline-flex items-center gap-1.5 shrink-0"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              {lookupState === 'searching' ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>{isHu ? 'Keresés…' : 'Checking…'}</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <span>{isHu ? 'Ellenőrzés' : 'Look up'}</span>
                </>
              )}
            </button>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {isHu
              ? 'A beírás után a rendszer automatikusan megkeresi a rendelést és betölti az adataidat.'
              : 'The system automatically verifies the order number and loads items upon entry.'}
          </p>
        </div>

        {/* Customer Information Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {isHu ? 'Rendelés / Átvétel dátuma *' : 'Order / Delivery Date *'}
            </label>
            <input
              type="date"
              required
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {isHu ? 'Teljes név (Fogyasztó neve) *' : 'Full Name (Consumer) *'}
            </label>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={isHu ? 'pl. Kiss János' : 'e.g. John Doe'}
              className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {isHu ? 'Kapcsolattartási e-mail cím *' : 'Contact Email *'}
            </label>
            <input
              type="email"
              required
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {isHu ? 'Telefonszám (opcionális)' : 'Phone Number (optional)'}
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+36 30 123 4567"
              className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Product Selection from Order OR Fallback Manual Textarea */}
        {orderData && orderData.items && orderData.items.length > 0 ? (
          <div className="rounded-2xl border p-3.5 sm:p-4 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <svg className="w-4 h-4 text-[var(--accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  <span>{isHu ? 'Visszaküldendő termékek kiválasztása *' : 'Select Products to Return *'}</span>
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {isHu
                    ? 'Jelöld be a visszaküldeni kívánt termékeket, vagy küldd vissza a teljes rendelést:'
                    : 'Check the items you want to return, or choose to return all items:'}
                </div>
              </div>

              {/* Master Checkbox: Send All Back */}
              <label
                className="flex items-center gap-2 cursor-pointer text-xs font-bold px-3 py-1.5 rounded-xl border select-none transition"
                style={{
                  background: sendAllBack ? 'var(--accent-muted)' : 'var(--bg-surface-2)',
                  borderColor: sendAllBack ? 'var(--accent-border)' : 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={sendAllBack}
                  onChange={(e) => handleToggleSendAll(e.target.checked)}
                  className="rounded cursor-pointer accent-[var(--accent)]"
                />
                <span>{isHu ? 'Minden termék visszaküldése' : 'Send all back'}</span>
              </label>
            </div>

            {/* List of order items */}
            <div className="space-y-2">
              {orderData.items.map((item) => {
                const itemState = selectedItems[item.id] || {
                  selected: false,
                  returnQty: item.quantity,
                  maxQty: item.quantity,
                  name: item.name,
                  price_huf: item.price_huf,
                };

                return (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition"
                    style={{
                      background: itemState.selected ? 'var(--bg-surface-2)' : 'transparent',
                      borderColor: itemState.selected ? 'var(--accent-border)' : 'var(--border-subtle)',
                      opacity: itemState.selected ? 1 : 0.65,
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={itemState.selected}
                        onChange={(e) => handleToggleItem(item.id, e.target.checked)}
                        className="w-4 h-4 rounded cursor-pointer accent-[var(--accent)] shrink-0"
                      />
                      {item.image_path ? (
                        <img
                          src={item.image_path}
                          alt={item.name}
                          className="w-10 h-10 object-contain rounded-lg border bg-black/5 shrink-0"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-lg border flex items-center justify-center shrink-0"
                          style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}
                        >
                          <svg className="w-5 h-5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                            <line x1="12" y1="22.08" x2="12" y2="12" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }} title={item.name}>
                          {item.name}
                        </div>
                        <div className="text-[11px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                          {item.condition && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}>
                              {item.condition}
                            </span>
                          )}
                          {item.set_name && <span>{item.set_name}</span>}
                          {item.price_huf > 0 && <span>{item.price_huf.toLocaleString('hu-HU')} Ft / db</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-7 sm:pl-0 shrink-0">
                      {item.quantity > 1 ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {isHu ? 'Visszaküldés:' : 'Qty:'}
                          </span>
                          <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                            <button
                              type="button"
                              disabled={!itemState.selected || itemState.returnQty <= 1}
                              onClick={() => handleUpdateItemQty(item.id, itemState.returnQty - 1)}
                              className="px-2 py-0.5 hover:bg-[var(--bg-raised)] disabled:opacity-30 cursor-pointer font-bold select-none"
                              aria-label="Csökkentés"
                            >
                              -
                            </button>
                            <span className="px-2 py-0.5 font-bold text-center min-w-[28px]" style={{ background: 'var(--bg-input)' }}>
                              {itemState.returnQty}
                            </span>
                            <button
                              type="button"
                              disabled={!itemState.selected || itemState.returnQty >= item.quantity}
                              onClick={() => handleUpdateItemQty(item.id, itemState.returnQty + 1)}
                              className="px-2 py-0.5 hover:bg-[var(--bg-raised)] disabled:opacity-30 cursor-pointer font-bold select-none"
                              aria-label="Növelés"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            / {item.quantity} {isHu ? 'db' : 'pcs'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                          1 {isHu ? 'db' : 'pc'}
                        </span>
                      )}

                      {item.price_huf > 0 && (
                        <div className="text-right min-w-[70px]">
                          <div className="text-xs font-black" style={{ color: itemState.selected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {((itemState.selected ? itemState.returnQty : 0) * item.price_huf).toLocaleString('hu-HU')} Ft
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selection Totals */}
            <div className="pt-2 flex items-center justify-between text-xs font-bold border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {isHu
                  ? `Kiválasztva: ${selectedCount} tétel (${selectedUnits} db)`
                  : `Selected: ${selectedCount} item(s) (${selectedUnits} pcs)`}
              </span>
              {selectedTotalHuf > 0 && (
                <span className="font-black" style={{ color: 'var(--text-primary)' }}>
                  {isHu ? 'Becsült visszatérítés:' : 'Est. refund:'} {selectedTotalHuf.toLocaleString('hu-HU')} Ft
                </span>
              )}
            </div>

            {/* Toggle custom notes */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowNotesField(!showNotesField)}
                className="text-[11px] font-semibold text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span>{showNotesField ? (isHu ? 'Megjegyzés mező elrejtése' : 'Hide custom notes') : (isHu ? '+ Szöveges megjegyzés hozzáadása a tételekhez' : '+ Add custom note to items')}</span>
              </button>

              {showNotesField && (
                <div className="mt-2 space-y-1">
                  <textarea
                    rows={2}
                    value={itemsUserNotes}
                    onChange={(e) => handleNotesChange(e.target.value)}
                    placeholder={isHu ? 'Opcionális megjegyzés (pl. bontatlan, hibátlan állapotban)...' : 'Optional note (e.g. factory sealed, untouched)...'}
                    className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition resize-none"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {isHu ? 'Visszaküldeni kívánt termékek megnevezése és darabszáma *' : 'Items & Quantities to Return *'}
            </label>
            <textarea
              required
              rows={3}
              value={itemsSummary}
              onChange={(e) => setItemsSummary(e.target.value)}
              placeholder={isHu ? 'pl. 1x Riftbound Origins Booster Box (bontatlan)' : 'e.g. 1x Riftbound Origins Booster Box (factory sealed)'}
              className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition resize-none leading-relaxed"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              {isHu
                ? 'Sorold fel a termék(ek) nevét és a visszaküldeni kívánt darabszámot.'
                : 'List the names and quantities of the items you wish to return.'}
            </p>
          </div>
        )}

        {/* Bank Account for Refund */}
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {isHu ? 'Visszatérítési bankszámlaszám (IBAN) *' : 'Refund Bank Account (IBAN) *'}
          </label>
          <input
            type="text"
            required
            value={bankAccount}
            onChange={(e) => setBankAccount(e.target.value)}
            placeholder="HU42 1177 3016 1234 5678 0000 0000"
            className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition font-mono"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {isHu
              ? 'Erre a bankszámlára utaljuk vissza a vételárat a termék visszaérkezését és ellenőrzését követően.'
              : 'The refund will be wired to this bank account upon physical receipt and inspection.'}
          </p>
        </div>

        {/* Reason (optional) */}
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
            {isHu ? 'Elállás indoka (opcionális, jogszabály szerint nem kötelező)' : 'Reason for Withdrawal (optional, not required by law)'}
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isHu ? 'pl. Téves rendelés, meggondoltam magam' : 'e.g. Ordered by mistake, changed my mind'}
            className="w-full px-3 py-2 text-xs rounded-xl border outline-none focus:border-[var(--accent)] transition"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </div>

        {/* Terms acceptance declaration */}
        <div className="pt-2">
          <label className="flex items-start gap-2.5 cursor-pointer text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              required
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 rounded cursor-pointer accent-[var(--accent)]"
            />
            <span className="leading-snug">
              {isHu
                ? 'Kijelentem, hogy a visszaküldeni kívánt gyűjtői termékeket nem bontottam fel (a gyári fóliacsomagolás sértetlen), és a terméke(ke)t a nyilatkozat megtételétől számított 14 napon belül saját költségemen visszajuttatom a vállalkozás raktárába.'
                : 'I declare that the collectible items to be returned are unopened (factory seal intact) and that I will return the item(s) at my own expense within 14 days of submitting this notice.'}
            </span>
          </label>
        </div>

        {/* Submit Button */}
        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 rounded-xl text-xs font-black transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-2 shadow-sm"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            <span>
              {loading
                ? (isHu ? 'Küldés folyamatban…' : 'Submitting…')
                : (isHu ? 'Elállási Nyilatkozat Beküldése' : 'Submit Withdrawal Request')}
            </span>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
