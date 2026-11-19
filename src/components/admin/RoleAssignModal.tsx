import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { Modal } from '../ui/Modal';
import { MODERATOR_GAMES, formatModeratorRoleLabel, normalizeModeratorGames } from '../../lib/roles';
import type { UserRole } from '../../types';

export interface RoleAssignTargetUser {
  id: string;
  display_name: string;
  email?: string | null;
  role: UserRole;
  is_owner?: boolean;
  is_admin?: boolean;
  is_moderator?: boolean;
  moderator_games?: string[];
}

interface RoleAssignModalProps {
  open: boolean;
  onClose: () => void;
  targetUser: RoleAssignTargetUser | null;
  callerIsOwner: boolean;
  busy?: boolean;
  onSave: (role: UserRole, moderatorGames: string[]) => Promise<void> | void;
}

export function RoleAssignModal({
  open,
  onClose,
  targetUser,
  callerIsOwner,
  busy = false,
  onSave,
}: RoleAssignModalProps) {
  const { t, lang } = useLanguage();
  const [selectedRole, setSelectedRole] = useState<UserRole>('user');
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !targetUser) return;
    setError(null);
    const currentRole: UserRole =
      targetUser.is_owner || targetUser.role === 'owner'
        ? 'owner'
        : targetUser.is_admin || targetUser.role === 'admin'
        ? 'admin'
        : targetUser.is_moderator || targetUser.role === 'moderator'
        ? 'moderator'
        : 'user';
    setSelectedRole(currentRole);
    setSelectedGames(normalizeModeratorGames(targetUser.moderator_games));
  }, [open, targetUser?.id]);

  if (!targetUser) return null;

  const toggleGame = (gameId: string) => {
    setSelectedGames((prev) =>
      prev.includes(gameId) ? prev.filter((g) => g !== gameId) : [...prev, gameId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (selectedRole === 'moderator' && selectedGames.length === 0) {
      setError(t('Select at least one game for a moderator.', 'Válassz legalább egy játékot a moderátorhoz.'));
      return;
    }
    await onSave(selectedRole, selectedRole === 'moderator' ? selectedGames : []);
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeDisabled={busy}
      title={`${t('Manage Role', 'Jogosultság kezelése')} — ${targetUser.display_name}`}
      maxWidth="max-w-lg"
      zIndexClass="z-[200]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-xl border text-xs font-semibold" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}>
            {error}
          </div>
        )}

        <div className="space-y-2">
          {([
            {
              id: 'user' as const,
              title: t('Standard User', 'Sima felhasználó'),
              desc: t('Can browse, trade, and submit card update requests.', 'Böngészhet, kereskedhet, és kártyafrissítést kérhet.'),
            },
            {
              id: 'moderator' as const,
              title: t('Game Moderator', 'Játék Moderátor'),
              desc: t('Below Admin. Can directly edit cards & approve update requests for assigned game(s).', 'Admin alatti rang. A kijelölt játék(ok)ban szerkesztheti a kártyákat és jóváhagyhat kérelmeket.'),
            },
            {
              id: 'admin' as const,
              title: 'Admin',
              desc: t('Full store, support, user & all-game card control. Cannot demote/ban admins or owner.', 'Teljes hozzáférés minden játékhoz és bolthoz, de más admint és ownert nem tud lefokozni vagy kitiltani.'),
            },
            ...(callerIsOwner
              ? [{
                  id: 'owner' as const,
                  title: 'Owner',
                  desc: t('Unrestricted platform control, including managing admins.', 'Teljes korlátlan jogosultság, beleértve az adminok kezelését.'),
                }]
              : []),
          ]).map((opt) => {
            const active = selectedRole === opt.id;
            return (
              <label
                key={opt.id}
                className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition"
                style={{
                  background: active ? 'var(--accent-muted)' : 'var(--bg-input)',
                  borderColor: active ? 'var(--accent-border)' : 'var(--border-subtle)',
                }}
              >
                <input
                  type="radio"
                  name="target_role"
                  value={opt.id}
                  checked={active}
                  onChange={() => setSelectedRole(opt.id)}
                  className="mt-1 shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-xs font-black" style={{ color: active ? 'var(--text-accent)' : 'var(--text-primary)' }}>
                    {opt.title}
                  </div>
                  <div className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {opt.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {selectedRole === 'moderator' && (
          <div className="rounded-xl border p-3.5 space-y-2.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {t('Assigned Game Scope', 'Moderált játékok kiválasztása')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MODERATOR_GAMES.map((g) => {
                const checked = selectedGames.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className="flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition"
                    style={{
                      background: checked ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-input)',
                      borderColor: checked ? 'rgba(16, 185, 129, 0.45)' : 'var(--border-subtle)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGame(g.id)}
                      className="shrink-0"
                    />
                    <span className="text-xs font-bold" style={{ color: checked ? '#34d399' : 'var(--text-primary)' }}>
                      {formatModeratorRoleLabel(g.id, lang)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-9 px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Cancel', 'Mégse')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-9 px-5 py-2 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {busy ? t('Saving...', 'Mentés...') : t('Save Role', 'Jogosultság mentése')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
