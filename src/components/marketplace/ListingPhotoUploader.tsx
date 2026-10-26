import React, { useRef, useState } from 'react';
import { compressImages } from '../../lib/imageCompression';
import { supabase } from '../../lib/supabase';

export interface ListingPhotoUploaderProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  maxPhotos?: number;
  label?: string;
  subtitle?: string;
  required?: boolean;
  disabled?: boolean;
}

export function ListingPhotoUploader({
  photos,
  onPhotosChange,
  maxPhotos = 5,
  label = 'Condition Photos',
  subtitle,
  required = false,
  disabled = false,
}: ListingPhotoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = maxPhotos - photos.length;
    if (remainingSlots <= 0) return;

    const filesToUpload = files.slice(0, remainingSlots);

    setIsUploading(true);
    setUploadError(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error('Please sign in to upload photos.');
      }

      const compressed = await compressImages(filesToUpload);
      const formData = new FormData();
      compressed.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/marketplace/upload-image', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to upload photo.');
      }

      if (json.urls && Array.isArray(json.urls)) {
        onPhotosChange([...photos, ...json.urls].slice(0, maxPhotos));
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Error uploading photo.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = (indexToRemove: number) => {
    onPhotosChange(photos.filter((_, idx) => idx !== indexToRemove));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-bold block" style={{ color: 'var(--text-secondary)' }}>
          <span>{label}</span>{' '}
          {required && <span className="text-rose-400 font-bold">*</span>}
          {subtitle && (
            <span className="font-normal text-[11px] ml-1 lowercase" style={{ color: 'var(--text-tertiary)' }}>
              {subtitle}
            </span>
          )}
        </label>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
          {photos.length}/{maxPhotos}
        </span>
      </div>

      {uploadError && (
        <div className="mb-2 p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-semibold flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{uploadError}</span>
        </div>
      )}

      <div className="flex items-center gap-2.5 flex-wrap">
        {photos.map((url, idx) => (
          <div
            key={url + idx}
            className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl border overflow-hidden group bg-black/40 shadow-xs shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <img src={url} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              className="absolute inset-0 bg-black/70 text-rose-400 opacity-0 group-hover:opacity-100 flex items-center justify-center transition cursor-pointer"
              title="Remove image"
              aria-label="Remove image"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}

        {photos.length < maxPhotos && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition cursor-pointer hover:border-[var(--accent)] hover:text-[var(--text-accent)] disabled:opacity-50 shrink-0"
            style={{
              background: 'var(--bg-input)',
              borderColor: 'var(--border)',
              color: 'var(--text-tertiary)',
            }}
          >
            {isUploading ? (
              <>
                <svg className="w-5 h-5 animate-spin text-[var(--text-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
                <span className="text-[10px] font-bold">Uploading…</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span className="text-[10px] font-bold">+ Photo</span>
              </>
            )}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
          className="hidden"
        />
      </div>
    </div>
  );
}
