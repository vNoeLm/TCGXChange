import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getCurrentProfile, signOut, onSignedInUserChange } from '../lib/auth';
import type { UserProfile } from '../types';
import { AuthModal } from './auth/AuthModal';
import { fetchUnreadCount } from '../lib/messages';
import { subscribeUserRealtime, getActiveConversationId } from '../lib/realtimeClient';
import { STORAGE_KEYS, EVENTS } from '../lib/constants';
import {
  shouldShowLiveNoticeToast,
  buildLiveNoticeToast,
  ACTIVE_THREAD_WINDOW_EVENT,
  type LiveNoticeToast,
} from '../lib/realtimeEvents';
import { useExitTransition } from '../lib/useExitTransition';
import { useCurrency } from '../lib/currency';
import { useLanguage } from '../lib/i18n';
import { resolveAvatarImageStyle } from './profile/AvatarBannerModal';

const SAFETY_SYNC_MS = 3 * 60 * 1000; // Gentle safety net alongside live WebSocket subscription
const TOAST_AUTO_DISMISS_MS = 6500;

interface NavigationProps {
  currentPath: string;
}

export function Navigation({ currentPath }: NavigationProps) {
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [activeGame, setActiveGame] = useState('riftbound');
  const [liveToasts, setLiveToasts] = useState<LiveNoticeToast[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const { setCurrency } = useCurrency();
  const { lang, setLanguage, t } = useLanguage();
  const langRef = useRef(lang);
  langRef.current = lang;

  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownAnim = useExitTransition(dropdownOpen, 200);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsAnim = useExitTransition(toolsOpen, 200);

  const switchLocale = (target: 'hu' | 'en') => {
    if (target === 'hu') {
      setLanguage('hu');
      setCurrency('HUF');
    } else {
      setLanguage('en');
      setCurrency('EUR');
    }
  };

  // 250ms, not the sheet's own 200ms - the backdrop (.tv-overlay) shares this timer and transitions
  // over 250ms, so unmounting at the sheet's shorter duration would cut the backdrop fade off early.
  const mobileMenuAnim = useExitTransition(mobileMenuOpen, 250);

  const dismissLiveToast = useCallback((id: string) => {
    const existingTimer = toastTimersRef.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      toastTimersRef.current.delete(id);
    }
    setLiveToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushLiveToast = useCallback(
    (toast: LiveNoticeToast) => {
      setLiveToasts((prev) => {
        const filtered = prev.filter((item) => item.id !== toast.id);
        return [...filtered, toast].slice(-3);
      });
      const prevTimer = toastTimersRef.current.get(toast.id);
      if (prevTimer) clearTimeout(prevTimer);
      const timer = setTimeout(() => {
        toastTimersRef.current.delete(toast.id);
        setLiveToasts((prev) => prev.filter((item) => item.id !== toast.id));
      }, TOAST_AUTO_DISMISS_MS);
      toastTimersRef.current.set(toast.id, timer);
    },
    []
  );

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timer) => clearTimeout(timer));
      toastTimersRef.current.clear();
    };
  }, []);

  // Automatically clear any visible toast for a conversation as soon as the user opens that thread
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onActiveThread = (e: Event) => {
      const convId = (e as CustomEvent)?.detail?.conversationId as string | null | undefined;
      if (!convId) return;
      setLiveToasts((prev) =>
        prev.filter((item) => !item.conversationId || item.conversationId !== convId)
      );
    };
    window.addEventListener(ACTIVE_THREAD_WINDOW_EVENT, onActiveThread);
    return () => window.removeEventListener(ACTIVE_THREAD_WINDOW_EVENT, onActiveThread);
  }, []);

  useEffect(() => {
    getCurrentProfile().then((p) => {
      setUserProfile(p);
      setLoading(false);
    });

    // Only a real change of who's signed in - not the session the call above is already loading,
    // nor the SIGNED_IN supabase-js repeats every time the tab is shown again.
    const unsubscribeAuth = onSignedInUserChange((session) => {
      if (session) {
        getCurrentProfile().then((p) => setUserProfile(p));
      } else {
        setUserProfile(null);
      }
    });

    // Close dropdown on outside click
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    const syncGame = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME);
        if (saved) setActiveGame(saved);
      } catch {}
    };
    syncGame();
    const handleGameChange = (e: Event) => {
      const next = (e as CustomEvent)?.detail?.game;
      if (typeof next === 'string' && next) setActiveGame(next);
    };
    window.addEventListener(EVENTS.GAME_CHANGE, handleGameChange);

    return () => {
      unsubscribeAuth();
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener(EVENTS.GAME_CHANGE, handleGameChange);
    };
  }, []);

  // Real-time subscription for unread Messages badge and floating toast notifications.
  const signedInId = userProfile?.id;
  useEffect(() => {
    if (!signedInId) {
      setUnreadMessages(0);
      setLiveToasts([]);
      return;
    }

    const syncCounts = () => {
      fetchUnreadCount().then(setUnreadMessages);
    };

    syncCounts();

    const unsubscribeRealtime = subscribeUserRealtime(signedInId, (evt) => {
      const activeConvId = getActiveConversationId();
      const pathname = typeof window !== 'undefined' ? window.location.pathname : currentPath;

      if (
        (evt.type === 'chat_message' || evt.type === 'system_notice') &&
        evt.sender_id &&
        evt.sender_id !== signedInId &&
        !(pathname.startsWith('/messages') && activeConvId && activeConvId === evt.conversation_id)
      ) {
        setUnreadMessages((c) => c + 1);
      }

      if (
        evt.type === 'chat_message' ||
        evt.type === 'system_notice' ||
        evt.type === 'thread_read'
      ) {
        syncCounts();
      }

      if (
        shouldShowLiveNoticeToast({
          event: evt,
          myUserId: signedInId,
          pathname,
          activeConversationId: activeConvId,
        })
      ) {
        const toast = buildLiveNoticeToast(evt, signedInId, langRef.current);
        if (toast) {
          pushLiveToast(toast);
        }
      }
    });

    const handleVisibilityOrOnline = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        syncCounts();
      }
    };

    window.addEventListener('online', handleVisibilityOrOnline);
    document.addEventListener('visibilitychange', handleVisibilityOrOnline);

    const safetyTimer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        syncCounts();
      }
    }, SAFETY_SYNC_MS);

    return () => {
      unsubscribeRealtime();
      window.removeEventListener('online', handleVisibilityOrOnline);
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      clearInterval(safetyTimer);
    };
  }, [signedInId, currentPath, pushLiveToast]);

  const isActive = (path: string) => {
    if (path === '/' && currentPath === '/') return true;
    if (path !== '/' && currentPath.startsWith(path)) return true;
    return false;
  };

  const NavLink = ({
    href,
    label,
    badgeCount = 0,
  }: {
    href: string;
    label: string;
    badgeCount?: number;
  }) => {
    const active = isActive(href);
    return (
      <a
        href={href}
        className={`relative text-xs font-semibold px-2 xl:px-3 py-1.5 rounded-lg border transition whitespace-nowrap ${
          active
            ? 'font-bold shadow-sm border-[var(--accent-border)]'
            : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-accent)] hover:bg-[var(--accent-muted)] hover:border-[var(--border-hover)]'
        }`}
        style={
          active
            ? {
                background: 'var(--accent-muted)',
                color: 'var(--text-accent)',
              }
            : undefined
        }
      >
        {label}
        {badgeCount > 0 && (
          <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black bg-amber-500 text-zinc-950">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </a>
    );
  };

  const totalMobileBadge = unreadMessages;

  const isToolsActive = isActive('/deck-builder') || isActive('/decks') || isActive('/binder') || isActive('/wishlists');

  const renderToastIcon = (toast: LiveNoticeToast) => {
    if (toast.avatarUrl) {
      return (
        <img
          src={toast.avatarUrl}
          alt={toast.title}
          className="w-8 h-8 rounded-full object-cover shrink-0 border"
          style={{ borderColor: 'var(--border)' }}
        />
      );
    }

    if (toast.kind === 'auction') {
      return (
        <span
          className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(168, 85, 247, 0.16)',
            borderColor: 'rgba(168, 85, 247, 0.4)',
            color: '#c084fc',
          }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 5.5l4 4" />
            <path d="M13 7l-7.5 7.5a2.12 2.12 0 0 0 3 3L16 10" />
            <path d="M16 4l4 4" />
            <path d="M3 21h9" />
          </svg>
        </span>
      );
    }

    if (toast.kind === 'review') {
      return (
        <span
          className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
          style={{
            background: 'var(--accent-muted)',
            borderColor: 'var(--accent-border)',
            color: 'var(--text-accent)',
          }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </span>
      );
    }

    if (toast.kind === 'notice') {
      return (
        <span
          className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(59, 130, 246, 0.15)',
            borderColor: 'rgba(59, 130, 246, 0.4)',
            color: '#60a5fa',
          }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </span>
      );
    }

    return (
      <span
        className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
        style={{
          background: 'var(--accent-muted)',
          borderColor: 'var(--accent-border)',
          color: 'var(--text-accent)',
        }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </span>
    );
  };

  return (
    <>
      {/* Desktop Navigation (>= 1024px) */}
      <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
        <NavLink href="/" label={t('Catalog', 'Katalógus')} />

        <NavLink href="/store" label={t('Store', 'Bolt')} />

        {/* Tools dropdown */}
        <div className="relative" ref={toolsRef}>
          <button
            type="button"
            onClick={() => setToolsOpen((o) => !o)}
            aria-expanded={toolsOpen}
            aria-haspopup="menu"
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 xl:px-3 py-1.5 rounded-lg border transition cursor-pointer whitespace-nowrap ${
              isToolsActive
                ? 'font-bold shadow-sm border-[var(--accent-border)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-accent)] hover:bg-[var(--accent-muted)] hover:border-[var(--border-hover)]'
            }`}
            style={
              isToolsActive
                ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' }
                : undefined
            }
          >
            <span>{t('Tools', 'Eszközök')}</span>
            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${toolsOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {toolsAnim.rendered && (
            <div
              role="menu"
              data-state={toolsAnim.state}
              className="tv-menu absolute left-0 mt-2 w-56 rounded-xl shadow-2xl border p-1.5 z-50 flex flex-col gap-0.5"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              {[
                { href: '/deck-builder', label: t('Deck Builder', 'Pakliépítő'), riftboundOnly: true, desc: t('Build & test Riftbound decks', 'Riftbound paklik építése') },
                { href: '/decks', label: t('Decks', 'Paklik'), riftboundOnly: true, desc: t('Browse community & saved decks', 'Mentett paklik böngészése') },
                { href: '/binder', label: t('Binder', 'Album térkép'), riftboundOnly: false, desc: t('Organize cards into binder pages', 'Lapok elrendezése mappanézetben') },
                { href: '/wishlists', label: t('Wishlists', 'Kívánságlisták'), riftboundOnly: false, desc: t('Manage your wanted cards', 'Keresett lapok kezelése') },
              ].map((item) => {
                const itemActive = isActive(item.href);
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setToolsOpen(false)}
                    className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg text-left transition hover:bg-[var(--bg-raised)]"
                    style={itemActive ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' } : { color: 'var(--text-primary)' }}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>{item.label}</span>
                        {item.riftboundOnly && activeGame !== 'riftbound' && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                            Riftbound
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{item.desc}</div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {userProfile && (
          <NavLink
            href="/messages"
            label={t('Messages', 'Üzenetek')}
            badgeCount={unreadMessages}
          />
        )}

        {/* Unified Language & Currency Switcher */}
        <div className="inline-flex items-center rounded-lg p-0.5 border text-[11px] font-bold shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => switchLocale('hu')}
            className={`px-2.5 py-1 rounded-md transition cursor-pointer ${lang === 'hu' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            title="Magyar felület & Forint (HUF)"
          >
            HU
          </button>
          <button
            type="button"
            onClick={() => switchLocale('en')}
            className={`px-2.5 py-1 rounded-md transition cursor-pointer ${lang === 'en' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            title="English interface & Euro (€)"
          >
            EN
          </button>
        </div>

        {/* Auth Section */}
        <div className="relative" ref={dropdownRef}>
          {loading ? (
            <div className="w-20 h-7 rounded-lg animate-pulse" style={{ background: 'var(--bg-raised)' }} />
          ) : userProfile ? (
            <div>
              <button
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex items-center gap-1.5 xl:gap-2 py-1 pl-1.5 pr-2 xl:pr-2.5 rounded-full text-xs font-bold transition cursor-pointer shadow-sm border bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--accent-muted)] hover:border-[var(--border-hover)] hover:text-[var(--text-accent)]"
              >
                {userProfile.avatar_url ? (
                  <div
                    className="w-6 h-6 rounded-full overflow-hidden shrink-0"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    <img
                      src={userProfile.avatar_url}
                      alt={userProfile.display_name || 'User'}
                      className="w-full h-full object-cover"
                      style={resolveAvatarImageStyle(userProfile.avatar_url)}
                    />
                  </div>
                ) : (
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--accent)',
                    }}
                  >
                    {(userProfile.display_name || userProfile.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <span className="truncate max-w-[70px] xl:max-w-[120px] 2xl:max-w-none">{userProfile.display_name || 'Account'}</span>
                <svg className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* User Dropdown Menu */}
              {dropdownAnim.rendered && (
                <div
                  data-state={dropdownAnim.state}
                  className="tv-popover tv-origin-top-right absolute top-[calc(100%+8px)] right-0 w-52 rounded-xl p-1.5 z-50 flex flex-col gap-0.5"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.8), 0 0 24px var(--accent-glow)',
                  }}
                >
                  <div
                    className="p-2 mb-1"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{userProfile.display_name || 'Account'}</div>
                    <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-tertiary)' }}>{userProfile.email}</div>
                  </div>

                  <a
                    href="/profile"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--accent-muted)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                  >
                    <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {t('My Profile', 'Profilom')}
                  </a>

                  <a
                    href="/legal/privacy"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer text-left hover:bg-[var(--bg-raised)]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" />
                    </svg>
                    {t('Legal & Privacy', 'Jogi tudnivalók')}
                  </a>

                  <button
                    onClick={async () => {
                      setDropdownOpen(false);
                      await signOut();
                      window.location.reload();
                    }}
                    className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer text-left mt-1 pt-1.5"
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    {t('Sign Out', 'Kijelentkezés')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm whitespace-nowrap border bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] hover:border-[var(--border-hover)] hover:text-[var(--text-accent)]"
            >
              <svg className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>{t('Sign In', 'Belépés')}</span>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Controls (< 1024px) */}
      <div className="flex lg:hidden items-center gap-2">
        {/* Mobile Hamburger Button */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="relative h-9 px-2.5 flex items-center justify-center rounded-xl transition cursor-pointer shadow-sm active:scale-95 border bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] hover:border-[var(--border-hover)] hover:text-[var(--text-accent)]"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation-menu"
        >
          {mobileMenuOpen ? (
            <svg className="w-5 h-5" style={{ color: 'var(--text-primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
          {!mobileMenuOpen && totalMobileBadge > 0 && (
            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black bg-amber-500 text-zinc-950 shadow-sm">
              {totalMobileBadge > 99 ? '99+' : totalMobileBadge}
            </span>
          )}
        </button>
      </div>

      {/* Mobile Menu Dropdown / Overlay */}
      {mobileMenuAnim.rendered && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          data-state={mobileMenuAnim.state}
          style={{ position: 'fixed', inset: 0, top: 58, zIndex: 120, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
          className="tv-overlay lg:hidden"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-state={mobileMenuAnim.state}
            id="mobile-navigation-menu"
            className="tv-sheet-down w-full p-4 shadow-2xl flex flex-col gap-3.5"
            style={{
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {/* User Profile (Clickable container to open Profile page) / Sign In Section */}
            {userProfile ? (
              <a
                href="/profile"
                onClick={() => setMobileMenuOpen(false)}
                className="p-3 rounded-xl flex items-center justify-between transition cursor-pointer group shadow-sm border"
                style={{
                  background: 'var(--bg-surface-2)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {userProfile.avatar_url ? (
                    <div
                      className="w-8 h-8 rounded-full overflow-hidden shrink-0"
                      style={{ border: '1px solid var(--border)' }}
                    >
                      <img
                        src={userProfile.avatar_url}
                        alt={userProfile.display_name || 'User'}
                        className="w-full h-full object-cover"
                        style={resolveAvatarImageStyle(userProfile.avatar_url)}
                      />
                    </div>
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                      style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent)',
                      }}
                    >
                      {(userProfile.display_name || userProfile.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{userProfile.display_name || 'Account'}</div>
                    <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-tertiary)' }}>{userProfile.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 pl-2" style={{ color: 'var(--text-secondary)' }}>
                  <span className="text-[11px] font-semibold">{t('My Profile', 'Profilom')}</span>
                  <span className="text-xs">→</span>
                </div>
              </a>
            ) : (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setShowAuthModal(true);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer"
                style={{
                  background: 'var(--accent-strong)',
                  color: 'var(--text-on-accent, #000)',
                  boxShadow: '0 0 16px var(--accent-glow)',
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>{t('Sign In', 'Belépés')}</span>
              </button>
            )}

            {/* Mobile Unified Language & Currency Switcher */}
            <div className="px-3 py-2 flex items-center justify-between rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{t('Language & Currency', 'Nyelv és pénznem')}</span>
              <div className="inline-flex items-center rounded-lg p-0.5 border text-[11px] font-bold" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  onClick={() => switchLocale('hu')}
                  className={`px-3 py-1 rounded-md transition cursor-pointer ${lang === 'hu' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  HU
                </button>
                <button
                  type="button"
                  onClick={() => switchLocale('en')}
                  className={`px-3 py-1 rounded-md transition cursor-pointer ${lang === 'en' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  EN
                </button>
              </div>
            </div>

            {/* Navigation Links */}
            <div className="flex flex-col gap-1">
              <a
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition border"
                style={
                  isActive('/')
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent)',
                        color: 'var(--text-accent)',
                      }
                    : {
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)',
                      }
                }
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                  <span>{t('Catalog', 'Katalógus')}</span>
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>→</span>
              </a>

              <a
                href="/store"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition border"
                style={
                  isActive('/store')
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent)',
                        color: 'var(--text-accent)',
                      }
                    : {
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)',
                      }
                }
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 01-8 0" />
                  </svg>
                  <span>{t('Store', 'Bolt')}</span>
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>→</span>
              </a>

              {userProfile && (
                <a
                  href="/messages"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition border"
                  style={
                    isActive('/messages')
                      ? {
                          background: 'var(--accent-muted)',
                          borderColor: 'var(--accent)',
                          color: 'var(--text-accent)',
                        }
                      : {
                          background: 'var(--bg-surface-2)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                    <span>{t('Messages', 'Üzenetek')}</span>
                    {unreadMessages > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black bg-amber-500 text-zinc-950">
                        {unreadMessages > 99 ? '99+' : unreadMessages}
                      </span>
                    )}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                </a>
              )}

              {/* Tools section */}
              <div className="mt-2 pt-2 border-t flex flex-col gap-1" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="px-2 pb-1 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Tools', 'Eszközök')}
                </div>
                {[
                  { href: '/deck-builder', label: t('Deck Builder', 'Pakliépítő'), riftboundOnly: true },
                  { href: '/decks', label: t('Decks', 'Paklik'), riftboundOnly: true },
                  { href: '/binder', label: t('Binder', 'Album térkép'), riftboundOnly: false },
                  { href: '/wishlists', label: t('Wishlists', 'Kívánságlisták'), riftboundOnly: false },
                ].map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-bold transition border"
                    style={
                      isActive(item.href)
                        ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }
                        : { background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span>{item.label}</span>
                      {item.riftboundOnly && activeGame !== 'riftbound' && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                          Riftbound
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                  </a>
                ))}
              </div>
            </div>

            {/* Footer: Legal + Sign Out */}
            <div
              className="flex items-center justify-between pt-2.5"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <a
                href="/legal/privacy"
                onClick={() => setMobileMenuOpen(false)}
                className="text-xs font-semibold underline underline-offset-2 cursor-pointer"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {t('Legal & Privacy', 'Jogi tudnivalók')}
              </a>
              {userProfile && (
                <button
                  onClick={async () => {
                    setMobileMenuOpen(false);
                    await signOut();
                    window.location.reload();
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-950/30 border border-rose-800/40 transition cursor-pointer"
                >
                  {t('Sign Out', 'Kijelentkezés')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            getCurrentProfile().then(setUserProfile);
          }}
        />
      )}

      {/* Real-time floating notice stack */}
      {typeof document !== 'undefined' &&
        liveToasts.length > 0 &&
        createPortal(
          <div
            className="fixed bottom-4 right-4 z-[9000] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))] pointer-events-none"
            aria-live="polite"
          >
            {liveToasts.map((toast) => (
              <div
                key={toast.id}
                className="pointer-events-auto rounded-2xl border p-3 shadow-2xl flex items-start gap-3 transition hover:border-[var(--accent)]"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border)',
                  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.72)',
                }}
              >
                <a
                  href={toast.href}
                  onClick={() => dismissLiveToast(toast.id)}
                  className="flex items-start gap-2.5 flex-1 min-w-0"
                >
                  {renderToastIcon(toast)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-400"
                        aria-hidden="true"
                      />
                      <span
                        className="text-xs font-black truncate"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {toast.title}
                      </span>
                    </div>
                    <p
                      className="text-[11px] font-medium line-clamp-2 mt-0.5 leading-snug"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {toast.body}
                    </p>
                  </div>
                </a>
                <button
                  type="button"
                  onClick={() => dismissLiveToast(toast.id)}
                  aria-label="Dismiss notification"
                  className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 cursor-pointer transition hover:bg-[var(--bg-raised)]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
