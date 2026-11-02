import { useState } from 'react';
import {
  useWishlists,
  setWishlistQuantity,
  createWishlist,
  wishlistKey,
  MAX_WISHLIST_NAME,
} from '../../lib/wishlists';
import { useLanguage } from '../../lib/i18n';

interface WishlistControlsProps {
  cardId: string;
  game: string;
  /** Show a separate Foil amount (cards that come in both finishes). */
  hasFoil: boolean;
  signedIn: boolean;
  onRequireSignIn: () => void;
}

/** On a card's detail: how many copies each of your wishlists wants, and a quick new list. */
export function WishlistControls({ cardId, game, hasFoil, signedIn, onRequireSignIn }: WishlistControlsProps) {
  const { t, lang } = useLanguage();
  const { lists: allLists, error } = useWishlists();
  const lists = allLists.filter((l) => l.game === game);
  const [newName, setNewName] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const change = async (listId: string, foil: boolean, qty: number) => {
    const key = `${listId}:${foil}`;
    setBusyKey(key);
    setActionError(null);
    try {
      await setWishlistQuantity(listId, cardId, foil, qty);
    } catch (e: any) {
      setActionError(e?.message || t('Could not update the wishlist.', 'Nem sikerült frissíteni a kívánságlistát.'));
    } finally {
      setBusyKey(null);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusyKey('new');
    setActionError(null);
    try {
      await createWishlist(name, game, { [wishlistKey(cardId, false)]: 1 });
      setNewName('');
    } catch (e: any) {
      setActionError(e?.message || t('Could not create the wishlist.', 'Nem sikerült létrehozni a kívánságlistát.'));
    } finally {
      setBusyKey(null);
    }
  };

  const stepper = (listId: string, foil: boolean, qty: number, label: string) => {
    const busy = busyKey === `${listId}:${foil}`;
    const btn = 'w-7 h-7 rounded-md border flex items-center justify-center text-sm font-bold cursor-pointer hover:brightness-110 disabled:opacity-40 disabled:cursor-default';
    const btnStyle = { borderColor: 'var(--border)', background: 'var(--bg-raised)', color: 'var(--text-secondary)' };
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide w-11 text-right" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
        <button
          type="button"
          aria-label={lang === 'hu' ? `Egyel kevesebb: ${label}` : `One fewer ${label.toLowerCase()} copy`}
          className={btn}
          style={btnStyle}
          disabled={busy || qty === 0}
          onClick={() => change(listId, foil, qty - 1)}
        >
          −
        </button>
        <span className="w-5 text-center text-sm font-black" style={{ color: qty > 0 ? 'var(--text-accent)' : 'var(--text-muted)' }}>{qty}</span>
        <button
          type="button"
          aria-label={lang === 'hu' ? `Egyel több: ${label}` : `One more ${label.toLowerCase()} copy`}
          className={btn}
          style={btnStyle}
          disabled={busy}
          onClick={() => change(listId, foil, qty + 1)}
        >
          +
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-4 border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-black uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
          </svg>
          <span>{t('Wishlists', 'Kívánságlisták')}</span>
        </div>
        {signedIn && lists.length > 0 && (
          <a href="/wishlists" className="text-xs font-bold hover:underline" style={{ color: 'var(--text-accent)' }}>{t('Manage', 'Kezelés')}</a>
        )}
      </div>

      {!signedIn ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('Keep lists of cards you want, then shop for them in one go.', 'Vezess listákat a keresett kártyáidról, majd vásárold meg őket egyszerre.')}</p>
          <button
            type="button"
            onClick={onRequireSignIn}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer hover:brightness-110"
            style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
          >
            {t('Sign in to use wishlists', 'Jelentkezz be a kívánságlisták használatához')}
          </button>
        </div>
      ) : error ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('Wishlists aren\'t available right now.', 'A kívánságlisták jelenleg nem érhetők el.')}</p>
      ) : (
        <div className="space-y-2">
          {lists.map((list) => (
            <div key={list.id} className="flex items-center justify-between gap-3 flex-wrap p-2.5 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
              <a href={`/wishlists?list=${list.id}`} className="text-sm font-bold truncate min-w-0 hover:underline" style={{ color: 'var(--text-primary)' }}>
                {list.name}
              </a>
              <div className="flex items-center gap-3 flex-wrap">
                {stepper(list.id, false, list.items[wishlistKey(cardId, false)] || 0, hasFoil ? t('Normal', 'Normál') : t('Copies', 'Példány'))}
                {hasFoil && stepper(list.id, true, list.items[wishlistKey(cardId, true)] || 0, 'Foil')}
              </div>
            </div>
          ))}

          <form
            onSubmit={(e) => { e.preventDefault(); create(); }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={newName}
              maxLength={MAX_WISHLIST_NAME}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={lists.length === 0 ? t('Name your first wishlist', 'Nevezd el az első kívánságlistádat') : t('New wishlist', 'Új kívánságlista')}
              className="flex-1 min-w-0 rounded-lg px-3 py-2 text-xs border outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            <button
              type="submit"
              disabled={!newName.trim() || busyKey === 'new'}
              className="px-3 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              {busyKey === 'new' ? t('Creating…', 'Létrehozás…') : t('Create & add', 'Létrehozás és hozzáadás')}
            </button>
          </form>
          {actionError && <p role="alert" className="text-xs font-semibold" style={{ color: 'var(--negative)' }}>{actionError}</p>}
        </div>
      )}
    </div>
  );
}
