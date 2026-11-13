import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';
import { backdropCloseProps } from '../../lib/modalBackdrop';

export interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  type: 'listing' | 'profile' | 'message';
  targetId: string;
  targetName: string;
  targetLink?: string;
  onSubmitted?: () => void;
}

interface ReportReasonOption {
  en: string;
  hu: string;
}

const REASONS_BY_TYPE: Record<'listing' | 'profile' | 'message', ReportReasonOption[]> = {
  listing: [
    { en: 'Misleading Condition or Damaged', hu: 'Félrevezető állapot vagy sérült kártya' },
    { en: 'Suspected Counterfeit or Fake', hu: 'Gyanúsan hamis kártya' },
    { en: 'Scam or Price Manipulation', hu: 'Csalás vagy ármanipuláció' },
    { en: 'Inappropriate Notes or Photos', hu: 'Nem megfelelő megjegyzés vagy fotók' },
    { en: 'Wrong Card or Edition Listed', hu: 'Hibás kártya vagy kiadás megadva' },
    { en: 'Other Issue', hu: 'Egyéb probléma' },
  ],
  profile: [
    { en: 'Suspected Scammer or Fraud', hu: 'Gyanús csaló vagy visszaélés' },
    { en: 'Harassment or Abusive Behavior', hu: 'Zaklatás vagy sértő viselkedés' },
    { en: 'Offensive Display Name or Avatar', hu: 'Sértő név vagy profilkép' },
    { en: 'Impersonation of Another Collector', hu: 'Más gyűjtő megszemélyesítése' },
    { en: 'Refusal to Honor Agreed Trade', hu: 'Megbeszélt üzlet megtagadása' },
    { en: 'Other Issue', hu: 'Egyéb probléma' },
  ],
  message: [
    { en: 'Harassment or Offensive Language', hu: 'Zaklatás vagy sértő nyelvezet' },
    { en: 'Scam or Phishing Attempt', hu: 'Csalás vagy adathalász kísérlet' },
    { en: 'Unsolicited Spam or Advertising', hu: 'Kéretlen spam vagy reklám' },
    { en: 'Off-platform Payment Coercion', hu: 'Platformon kívüli fizetés erőltetése' },
    { en: 'Threats or Intimidation', hu: 'Fenyegetés vagy megfélemlítés' },
    { en: 'Other Issue', hu: 'Egyéb probléma' },
  ],
};

export function ReportModal({
  open,
  onClose,
  type,
  targetId,
  targetName,
  targetLink,
  onSubmitted,
}: ReportModalProps) {
  const { t, lang } = useLanguage();
  const reasons = REASONS_BY_TYPE[type] || REASONS_BY_TYPE.listing;
  const [selectedReason, setSelectedReason] = useState<string>(reasons[0].en);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const titleByType: Record<'listing' | 'profile' | 'message', string> = {
    listing: t('Report Listing', 'Hirdetés jelentése'),
    profile: t('Report Profile', 'Profil jelentése'),
    message: t('Report Conversation', 'Beszélgetés jelentése'),
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/reports/submit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type,
          target_id: targetId,
          target_name: targetName,
          target_link: targetLink || (typeof window !== 'undefined' ? window.location.pathname + window.location.search : ''),
          reason: selectedReason,
          details: details.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(
          data.error || t('Failed to submit report. Please try again.', 'A jelentés elküldése nem sikerült. Kérjük, próbáld újra.'),
        );
      }

      setSubmitted(true);
      if (onSubmitted) onSubmitted();
      setTimeout(() => {
        setSubmitted(false);
        setDetails('');
        onClose();
      }, 1600);
    } catch (err: any) {
      console.error('Report submission error:', err);
      setError(err.message || t('Failed to submit report.', 'A jelentés elküldése nem sikerült.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      {...backdropCloseProps(onClose, { disabled: submitting })}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border p-5 sm:p-6 shadow-2xl relative flex flex-col gap-4"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border shrink-0"
              style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
                {titleByType[type]}
              </h3>
              <p className="text-xs truncate max-w-[240px]" style={{ color: 'var(--text-tertiary)' }}>
                {targetName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer hover:brightness-110 transition"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            title={t('Cancel', 'Mégse')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {submitted ? (
          <div className="py-8 text-center flex flex-col items-center justify-center gap-2">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center border"
              style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h4 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
              {t('Report Submitted', 'Jelentés elküldve')}
            </h4>
            <p className="text-xs max-w-xs" style={{ color: 'var(--text-secondary)' }}>
              {t(
                'Thank you for helping keep TCG XChange safe. Our moderators will review this promptly.',
                'Köszönjük, hogy segítesz biztonságban tartani a TCG XChange közösségét. Moderátoraink hamarosan átnézik a bejelentést.',
              )}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            {error && (
              <div className="p-2.5 rounded-xl border text-xs font-semibold" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}>
                {error}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('Reason for report', 'Jelentés oka')}
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {reasons.map((r) => {
                  const isChecked = selectedReason === r.en;
                  return (
                    <label
                      key={r.en}
                      onClick={() => setSelectedReason(r.en)}
                      className="flex items-center gap-2.5 p-2 rounded-xl border cursor-pointer transition text-xs font-medium"
                      style={{
                        background: isChecked ? 'var(--accent-muted)' : 'var(--bg-surface-2)',
                        borderColor: isChecked ? 'var(--accent)' : 'var(--border-subtle)',
                        color: isChecked ? 'var(--text-accent)' : 'var(--text-primary)',
                      }}
                    >
                      <input
                        type="radio"
                        name="reportReason"
                        value={r.en}
                        checked={isChecked}
                        onChange={() => setSelectedReason(r.en)}
                        className="sr-only"
                      />
                      <span
                        className="w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0"
                        style={{
                          borderColor: isChecked ? 'var(--accent)' : 'var(--border)',
                          background: isChecked ? 'var(--accent)' : 'transparent',
                        }}
                      >
                        {isChecked && <span className="w-1.5 h-1.5 rounded-full bg-black" />}
                      </span>
                      <span>{lang === 'hu' ? r.hu : r.en}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Additional details', 'További részletek')}{' '}
                <span className="font-normal normal-case text-zinc-400">{t('(optional)', '(opcionális)')}</span>
              </label>
              <textarea
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={t(
                  'Provide any relevant context to help moderators evaluate this report...',
                  'Adj meg minden fontos részletet, ami segít a moderátoroknak a bejelentés elbírálásában...',
                )}
                className="w-full px-3 py-2 rounded-xl text-xs outline-none border resize-none"
                style={{
                  background: 'var(--bg-input)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:brightness-110"
                style={{
                  background: 'var(--bg-surface-2)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                {t('Cancel', 'Mégse')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl text-xs font-black cursor-pointer transition disabled:opacity-50 inline-flex items-center gap-1.5"
                style={{
                  background: 'var(--negative-muted)',
                  borderColor: 'var(--negative-border)',
                  color: 'var(--negative)',
                  borderWidth: '1px',
                }}
              >
                {submitting ? t('Submitting…', 'Küldés…') : t('Submit Report', 'Jelentés küldése')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
