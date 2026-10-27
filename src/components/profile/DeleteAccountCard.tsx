import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Self-service account deletion. Kept out of the appearance modal on purpose: this is not a
 * cosmetic change, and it asks the user to type their email before the button becomes usable.
 */
export function DeleteAccountCard({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = email || 'DELETE';
  const matches = confirm.trim().toLowerCase() === required.toLowerCase();

  const remove = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Your session has ended. Sign in again and retry.');

      const res = await fetch('/api/profile/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Your account could not be deleted. Please try again.');
      }

      try {
        await supabase.auth.signOut();
      } catch {}
      window.location.replace('/account-deleted');
    } catch (e: any) {
      setError(e?.message || 'Your account could not be deleted. Please try again.');
      setBusy(false);
    }
  };

  return (
    <section
      id="danger-zone"
      className="mt-6 scroll-mt-24 rounded-2xl border p-4 sm:p-5"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--negative-border)' }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: 'var(--negative)' }}>
            Danger zone
          </h2>
          <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Deleting your account removes your profile, listings, collections, wishlists, decks, messages and reviews.
            Finished store orders are kept for accounting, without your name or delivery details.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setError(null); }}
            className="px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:brightness-110 shrink-0"
            style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
          >
            Delete my account
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 rounded-xl border p-3.5 space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-semibold leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            This cannot be undone. Type <span className="font-mono font-black">{required}</span> to confirm.
          </p>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Type ${required} to confirm`}
            placeholder={required}
            className="w-full rounded-xl px-3 py-2 text-sm border outline-none focus:border-[var(--negative)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
          {error && (
            <p role="alert" className="text-xs font-semibold leading-relaxed" style={{ color: 'var(--negative)' }}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirm(''); setError(null); }}
              disabled={busy}
              className="px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:brightness-110 disabled:opacity-50"
              style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={!matches || busy}
              className="px-3.5 py-2 rounded-xl text-xs font-black border cursor-pointer transition disabled:opacity-40 disabled:cursor-default"
              style={{ background: 'var(--negative)', borderColor: 'var(--negative)', color: '#fff' }}
            >
              {busy ? 'Deleting…' : 'Delete account permanently'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
