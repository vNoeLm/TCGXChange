import { useRef, useState } from 'react';
import { uploadMarketplacePhotos } from '../../lib/p2pClient';
import { P2P_MAX_POST_IMAGES } from '../../lib/p2pConstants';
import { useLanguage } from '../../lib/i18n';

interface PhotoUploaderProps {
  images: string[];
  onChange: (next: string[]) => void;
  maxImages?: number;
  required?: boolean;
}

export function PhotoUploader({
  images,
  onChange,
  maxImages = P2P_MAX_POST_IMAGES,
  required = false,
}: PhotoUploaderProps) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const remaining = maxImages - images.length;
    if (remaining <= 0) {
      setError(t(`Maximum ${maxImages} photos allowed.`, `Legfeljebb ${maxImages} fotó tölthető fel.`));
      return;
    }

    const picked = Array.from(fileList).slice(0, remaining);
    setUploading(true);
    try {
      const urls = await uploadMarketplacePhotos(picked);
      onChange([...images, ...urls].slice(0, maxImages));
    } catch (e: any) {
      setError(e?.message || t('Upload failed.', 'Sikertelen feltöltés.'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          {t('Photos', 'Fotók')} ({images.length}/{maxImages})
          {required ? ' *' : ''}
        </span>
        {images.length < maxImages && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer hover:border-[var(--accent)] disabled:opacity-50"
            style={{
              background: 'var(--bg-surface-2)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>{uploading ? t('Uploading...', 'Feltöltés...') : t('Add Photos', 'Fotó hozzáadása')}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />

      {images.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {images.map((url, idx) => (
            <div
              key={`${url}-${idx}`}
              className="relative aspect-square rounded-xl overflow-hidden border group"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
            >
              <img src={url} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(images.filter((_, i) => i !== idx))}
                aria-label={t('Remove photo', 'Fotó törlése')}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center opacity-85 hover:opacity-100 transition cursor-pointer"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full py-5 px-4 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1.5 text-center transition cursor-pointer hover:border-[var(--accent)]"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-tertiary)' }}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {uploading ? t('Uploading images...', 'Képek feltöltése...') : t('Click to upload PNG, JPG, or WebP photos', 'Kattints PNG, JPG vagy WebP fotók feltöltéséhez')}
          </span>
        </button>
      )}

      {error && (
        <p className="text-[11px] font-semibold text-rose-400">{error}</p>
      )}
    </div>
  );
}
