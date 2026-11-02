import { supabase } from './supabase';
import { sellerCanCompleteFrom, type HoldAction, type HoldRole } from './holdFlow';
import { getLanguage } from './i18n';

/**
 * What the hold steps are called and say in the UI, and the call that takes one - shared by the
 * conversation panel (Messages) and the buyer's holds list (Profile) so both always match.
 */

export const HOLD_ACTION_LABEL: Record<HoldAction, string> = {
  hold: 'Accept hold',
  reject: 'Reject',
  release: 'Cancel',
  mark_handed_over: 'Mark handed over',
  confirm_received: 'I received it',
  confirm_sale: 'Complete sale',
  deny: 'Deny',
  update_tracking: 'Update tracking',
};

export function getHoldActionLabel(action: HoldAction, status?: string, role?: HoldRole, lang: string = 'en'): string {
  const isHu = lang === 'hu';
  if (action === 'deny') {
    if (status === 'handed_over' && role === 'buyer') return isHu ? 'Nem vettem át' : "Deny / Didn't receive";
    if (status === 'buyer_received' && role === 'seller') return isHu ? 'Átadás megtagadása' : 'Deny handover';
    return isHu ? 'Megtagadás' : 'Deny';
  }
  if (action === 'confirm_sale' && status === 'buyer_received') {
    return isHu ? 'Rendben és eladás lezárása' : 'OK & Complete sale';
  }
  if (isHu) {
    switch (action) {
      case 'hold': return 'Félretétel elfogadása';
      case 'mark_handed_over': return 'Átadva / Feladva';
      case 'confirm_received': return 'Átvétel megerősítése';
      case 'confirm_sale': return 'Eladás jóváhagyása';
      case 'reject': return 'Elutasítás';
      case 'release': return 'Félretétel feloldása';
      case 'update_tracking': return 'Csomagkövetés frissítése';
    }
  }
  return HOLD_ACTION_LABEL[action] || action;
}

export const HOLD_ACTION_CONFIRM: Partial<Record<HoldAction, string>> = {
  hold: 'Accept and reserve this for the buyer?',
  reject: 'Reject this hold request?',
  release: 'Cancel this hold? The card goes back on sale.',
  mark_handed_over: 'Mark as handed over / sent? The buyer then has 3 days to confirm or deny, after which the sale auto-completes.',
  confirm_received: 'Confirm you have received the card?',
  confirm_sale: 'Confirm handover and complete the sale now?',
  deny: 'Deny this transaction? This will cancel the hold and notify the other party.',
};

export const HOLD_ACTION_CONFIRM_HU: Partial<Record<HoldAction, string>> = {
  hold: 'Elfogadod és félreteszed ezt a vevőnek?',
  reject: 'Elutasítod ezt a félretételi kérelmet?',
  release: 'Törlöd a félretételt? A kártya visszakerül a piactérre.',
  mark_handed_over: 'Átadottnak / feladottnak jelölöd? A vevőnek ezután 3 napja van visszaigazolni vagy megtagadni, utána az eladás automatikusan lezárul.',
  confirm_received: 'Megerősíted, hogy megkaptad a kártyát?',
  confirm_sale: 'Megerősíted az átadást és lezárod az eladást most?',
  deny: 'Megtagadod ezt az ügyletet? Ezzel a félretétel törlődik, és a másik fél értesítést kap.',
};

/** The step forward, styled as the main button; the rest (reject, cancel, deny) are secondary. */
export const PRIMARY_HOLD_ACTIONS: HoldAction[] = ['hold', 'mark_handed_over', 'confirm_received', 'confirm_sale'];

export const HOLD_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for the seller',
  held: 'Reserved',
  handed_over: 'Handed over',
  buyer_received: 'Buyer received — awaiting seller OK',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
  expired: 'Expired',
};

export const HOLD_STATUS_LABEL_HU: Record<string, string> = {
  pending: 'Eladóra vár',
  held: 'Félretéve',
  handed_over: 'Átadva / Feladva',
  buyer_received: 'Vevő átvette — eladói jóváhagyásra vár',
  completed: 'Teljesítve',
  cancelled: 'Törölve',
  rejected: 'Elutasítva',
  expired: 'Lejárt',
};

export function getHoldStatusLabel(status: string, lang: string = 'en'): string {
  if (lang === 'hu') return HOLD_STATUS_LABEL_HU[status] || status;
  return HOLD_STATUS_LABEL[status] || status;
}

export function holdStepText(
  h: { status: string; buyer_name?: string | null; updated_at: string },
  role: HoldRole,
  actions: HoldAction[],
  lang: string = 'en',
): string {
  const isHu = lang === 'hu';
  if (h.status === 'expired') {
    return isHu
      ? 'Ez a félretételi kérelem lejárt, mert az eladó nem válaszolt időben. A kártyák felszabadultak.'
      : 'This hold request expired because the seller did not respond in time. The cards were released.';
  }
  const deadline = sellerCanCompleteFrom(h.updated_at).toLocaleDateString(isHu ? 'hu-HU' : 'en-GB', { day: 'numeric', month: 'short' });
  if (role === 'buyer') {
    if (h.status === 'pending') return isHu ? 'Várakozás az eladó jóváhagyására.' : 'Waiting for the seller to accept your hold.';
    if (h.status === 'held') {
      return isHu
        ? 'Félretéve számodra. Miután átvetted a kártyát, kattints az „Átvétel megerősítése” gombra — ezután az eladó lezárja az adásvételt.'
        : 'Reserved for you. Once the card is in your hands, click "I received it" — the seller will then OK it to complete the sale.';
    }
    if (h.status === 'buyer_received') {
      return actions.includes('confirm_sale')
        ? (isHu ? 'Eltelt 3 nap eladói válasz nélkül — most már lezárhatod az adásvételt.' : '3 days passed with no seller reply — you can complete the sale now.')
        : (isHu ? `Megerősítetted az átvételt — várakozás az eladó jóváhagyására (automatikus lezárás: ${deadline}).` : `You confirmed receipt — waiting for seller OK or denial (auto-completes on ${deadline}).`);
    }
    return isHu
      ? `Az eladó átadottnak / feladottnak jelölte. Kérjük, erősítsd meg vagy tagadd meg 3 napon belül (automatikus lezárás: ${deadline}).`
      : `The seller marked it as handed over / sent. Please confirm or deny within 3 days (auto-completes on ${deadline}).`;
  }
  if (h.status === 'pending') return isHu ? `${h.buyer_name || 'A vevő'} félretételt kért erre a tételre.` : `${h.buyer_name || 'The buyer'} asked you to hold this.`;
  if (h.status === 'held') {
    return isHu
      ? 'Félretéve. Jelöld átadottnak / feladottnak a találkozó vagy feladás után — ezután a vevő visszaigazolja az átvételt.'
      : "Reserved. Mark it handed over once you've met up or sent it — the buyer then confirms they got it.";
  }
  if (h.status === 'buyer_received') {
    return isHu
      ? `${h.buyer_name || 'A vevő'} visszaigazolta az átvételt. Kattints a „Rendben és eladás lezárása” gombra vagy tagadd meg 3 napon belül (automatikus lezárás: ${deadline}).`
      : `${h.buyer_name || 'The buyer'} confirmed receiving the card. Click "OK & Complete sale" or deny within 3 days (auto-completes on ${deadline}).`;
  }
  return actions.includes('confirm_sale')
    ? (isHu ? 'Eltelt 3 nap vevői válasz nélkül — most már lezárhatod az adásvételt.' : '3 days passed with no buyer reply — you can complete the sale now.')
    : (isHu ? `Várakozás a vevő visszaigazolására. Ha nem válaszol, automatikusan lezárul ekkor: ${deadline}.` : `Waiting for the buyer to confirm or deny. If they don't, it auto-completes on ${deadline}.`);
}

/** Asks (for the steps that need it), then takes the step. Returns an error message, or null. */
export async function performHoldAction(
  holdId: string,
  action: HoldAction,
  currentStatus?: string,
  trackingNumber?: string | null,
  opts?: { isAuction?: boolean; role?: HoldRole }
): Promise<string | null | 'cancelled'> {
  const isHu = getLanguage() === 'hu';
  let prompt = isHu ? HOLD_ACTION_CONFIRM_HU[action] : HOLD_ACTION_CONFIRM[action];
  if (opts?.isAuction && opts?.role === 'seller' && (action === 'release' || action === 'reject' || action === 'deny')) {
    prompt = isHu
      ? 'FIGYELEM: Ha törlöd ezt a lezárult aukciót vagy megtagadod a nyertes licitár teljesítését, a rendszer automatikusan 1 csillagos értékelést helyez el az eladói profilodon, miszerint törölted az aukciót és nem teljesítetted az árat.\n\nBiztosan törlöd és vállalod az 1 csillagos rendszerértékelést?'
      : 'WARNING: If you cancel this completed auction or refuse to honor the winning bid price, the system will automatically issue a mandatory 1-star review on your seller profile stating that you cancelled the auction and did not honor the price.\n\nAre you sure you want to cancel and receive a 1-star system review?';
  } else if (action === 'confirm_received' && currentStatus === 'held') {
    prompt = isHu
      ? 'Megerősíted, hogy átvetted a kártyát? Az eladónak ezután 3 napja van jóváhagyni, különben automatikusan lezárul.'
      : 'Confirm you have the card? The seller then has 3 days to OK it, or it auto-completes.';
  } else if (action === 'confirm_received' && currentStatus === 'handed_over') {
    prompt = isHu
      ? 'Megerősíted, hogy átvetted a kártyát? Ezzel az adásvétel lezárul.'
      : 'Confirm you have the card? This completes the sale.';
  } else if (action === 'confirm_sale' && currentStatus === 'buyer_received') {
    prompt = isHu
      ? 'A vevő visszaigazolta a kártya átvételét. Jóváhagyod és lezárod az eladást most?'
      : 'The buyer confirmed they received the card. OK and complete the sale now?';
  } else if (action === 'deny' && currentStatus === 'handed_over') {
    prompt = isHu
      ? 'Megtagadod, hogy átvetted a kártyát? Ezzel a félretétel törlődik, és az eladó értesítést kap.'
      : 'Deny that you received the card? This will cancel the hold and notify the seller.';
  } else if (action === 'deny' && currentStatus === 'buyer_received') {
    prompt = isHu
      ? 'Megtagadod, hogy átadtad ezt a kártyát? Ezzel a félretétel törlődik, és a vevő értesítést kap.'
      : 'Deny that this card was handed over? This will cancel the hold and notify the buyer.';
  }
  if (prompt && !confirm(prompt)) return 'cancelled';
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch('/api/marketplace/hold-request', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ id: holdId, action, ...(trackingNumber ? { tracking_number: trackingNumber } : {}) }),
  });
  const json = await res.json().catch(() => ({}));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
  return res.ok && json.success ? null : (json.error || (isHu ? 'Nem sikerült — próbáld újra.' : 'That did not work - try again.'));
}
