import { useState, useEffect, useRef } from 'react';
import { getCurrentProfile, signOut, onSignedInUserChange } from '../lib/auth';
import type { UserProfile } from '../types';
import { AuthModal } from './auth/AuthModal';
import { fetchUnreadCount } from '../lib/messages';
import { useExitTransition } from '../lib/useExitTransition';
import { useCurrency } from '../lib/currency';
import { useLanguage } from '../lib/i18n';

const MESSAGES_POLL_MS = 5 * 60 * 1000; // 5 min — a basic timer check, not realtime

interface NavigationProps {
  currentPath: string;
}

export function Navigation({ currentPath }: NavigationProps) {
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const { currency, setCurrency } = useCurrency();
  const { lang, setLanguage, t } = useLanguage();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownAnim = useExitTransition(dropdownOpen, 200);

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

  useEffect(() => {
    getCurrentProfile().then(p => {
      setUserProfile(p);
      setLoading(false);
    });

    // Only a real change of who's signed in - not the session the call above is already loading,
    // nor the SIGNED_IN supabase-js repeats every time the tab is shown again.
    const unsubscribeAuth = onSignedInUserChange((session) => {
      if (session) {
        getCurrentProfile().then(p => setUserProfile(p));
      } else {
        setUserProfile(null);
      }
    });

    // Close dropdown on outside click
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      unsubscribeAuth();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Unread messages badge — a plain timer poll, not realtime.
  // Keyed on the id, not the profile object: a re-fetched profile for the same user is a new
  // object, and used to restart the poll (and re-query the count) for nothing.
  const signedInId = userProfile?.id;
  useEffect(() => {
    if (!signedInId) {
      setUnreadMessages(0);
      return;
    }
    const check = () => fetchUnreadCount().then(setUnreadMessages);
    check();
    const timer = setInterval(check, MESSAGES_POLL_MS);
    return () => clearInterval(timer);
  }, [signedInId]);

  const isActive = (path: string) => {
    if (path === '/' && currentPath === '/') return true;
    if (path !== '/' && currentPath.startsWith(path)) return true;
    return false;
  };

  const NavLink = ({ href, label }: { href: string; label: string }) => {
    const active = isActive(href);
    return (
      <a
        href={href}
        className={`text-xs font-semibold px-2 xl:px-3 py-1.5 rounded-lg border transition whitespace-nowrap ${
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
      </a>
    );
  };

  return (
    <>
      {/* Desktop Navigation (>= 1024px) */}
      <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
        <NavLink href="/" label={t('Catalog', 'Katalógus')} />

        <NavLink href="/store" label={t('Store', 'Bolt')} />
        <NavLink href="/marketplace" label={t('Marketplace', 'Piactér')} />

        {userProfile && (
          <NavLink href="/seller" label={t('Seller Hub', 'Eladói felület')} />
        )}

        {userProfile && (
          <a
            href="/messages"
            className={`relative text-xs font-semibold px-2 xl:px-3 py-1.5 rounded-lg border transition whitespace-nowrap ${
              isActive('/messages')
                ? 'font-bold shadow-sm border-[var(--accent-border)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-accent)] hover:bg-[var(--accent-muted)] hover:border-[var(--border-hover)]'
            }`}
            style={
              isActive('/messages')
                ? { background: 'var(--accent-muted)', color: 'var(--text-accent)' }
                : undefined
            }
          >
            {t('Messages', 'Üzenetek')}
            {unreadMessages > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black bg-amber-500 text-zinc-950">
                {unreadMessages > 99 ? '99+' : unreadMessages}
              </span>
            )}
          </a>
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
                onClick={() => setDropdownOpen(o => !o)}
                className="flex items-center gap-1.5 xl:gap-2 py-1 pl-1.5 pr-2 xl:pr-2.5 rounded-full text-xs font-bold transition cursor-pointer shadow-sm border bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--accent-muted)] hover:border-[var(--border-hover)] hover:text-[var(--text-accent)]"
              >
                {userProfile.avatar_url ? (
                  <img
                    src={userProfile.avatar_url}
                    alt={userProfile.display_name || 'User'}
                    className="w-6 h-6 rounded-full object-cover shrink-0"
                    style={{ border: '1px solid var(--border)' }}
                  />
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
                <span className="truncate max-w-[70px] xl:max-w-[120px] 2xl:max-w-none">{userProfile.display_name || "Account"}</span>
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
                    boxShadow: '0 16px 40px rgba(0,0,0,0.8), 0 0 24px var(--accent-glow)'
                  }}
                >
                  <div 
                    className="p-2 mb-1"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{userProfile.display_name || "Account"}</div>
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
          onClick={() => setMobileMenuOpen(prev => !prev)}
          className="h-9 px-2.5 flex items-center justify-center rounded-xl transition cursor-pointer shadow-sm active:scale-95 border bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] hover:border-[var(--border-hover)] hover:text-[var(--text-accent)]"
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
              borderBottom: '1px solid var(--border)'
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
                    <img
                      src={userProfile.avatar_url}
                      alt={userProfile.display_name || 'User'}
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                      style={{ border: '1px solid var(--border)' }}
                    />
                  ) : (
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                      style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent)'
                      }}
                    >
                      {(userProfile.display_name || userProfile.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{userProfile.display_name || "Account"}</div>
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
                onClick={() => { setMobileMenuOpen(false); setShowAuthModal(true); }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer"
                style={{
                  background: 'var(--accent-strong)',
                  color: 'var(--text-on-accent, #000)',
                  boxShadow: '0 0 16px var(--accent-glow)'
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
                        color: 'var(--text-accent)'
                      }
                    : {
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)'
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
                        color: 'var(--text-accent)'
                      }
                    : {
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)'
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

              <a
                href="/marketplace"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition border"
                style={
                  isActive('/marketplace')
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent)',
                        color: 'var(--text-accent)'
                      }
                    : {
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)'
                      }
                }
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 01-8 0" />
                  </svg>
                  <span>{t('Marketplace', 'Piactér')}</span>
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>→</span>
              </a>

              {userProfile && (
                <a
                  href="/seller"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition border"
                  style={
                    isActive('/seller')
                      ? {
                          background: 'var(--accent-muted)',
                          borderColor: 'var(--accent)',
                          color: 'var(--text-accent)'
                        }
                      : {
                          background: 'var(--bg-surface-2)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-secondary)'
                        }
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21h18M3 10h18M5 10V21M19 10V21M9 21v-4a2 2 0 012-2h2a2 2 0 012 2v4M3 10l2-6h14l2 6" />
                    </svg>
                    <span>{t('Seller Hub', 'Eladói felület')}</span>
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                </a>
              )}

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
                          color: 'var(--text-accent)'
                        }
                      : {
                          background: 'var(--bg-surface-2)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-secondary)'
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

            </div>

            {/* Footer: Legal (the page footer is out of reach on infinitely scrolling pages like the
                catalog, so it's here too) + Sign Out */}
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


    </>
  );
}

