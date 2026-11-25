import { verifyImageMagicBytes, sanitizeFileName } from './sanitize';
import { uploadObjectToR2 } from './r2Storage';

export interface UploadOptions {
  maxFiles?: number;
  maxSizeBytes?: number;
  cacheControl?: string;
}

export interface UploadResult {
  success: boolean;
  urls: string[];
  count: number;
  error?: string;
  status: number;
}

/**
 * Validates, inspects magic bytes, sanitizes filename, and uploads images
 * directly to Cloudflare R2 (never Supabase Storage).
 */
export async function processImageUpload(
  files: (File | unknown)[],
  folderPrefix: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const maxFiles = options.maxFiles ?? 10;
  const maxSizeBytes = options.maxSizeBytes ?? 10 * 1024 * 1024; // 10MB
  const cacheControl = options.cacheControl || 'public, max-age=31536000, immutable';

  if (!files || files.length === 0) {
    return { success: false, urls: [], count: 0, error: 'No files provided for upload.', status: 400 };
  }

  if (files.length > maxFiles) {
    return {
      success: false,
      urls: [],
      count: 0,
      error: `Maximum ${maxFiles} photos allowed per upload.`,
      status: 400,
    };
  }

  const uploadedUrls: string[] = [];
  const timestamp = Date.now();
  const cleanPrefix = folderPrefix.replace(/^\/+|\/+$/g, '');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!(file instanceof File) && typeof (file as any)?.arrayBuffer !== 'function') continue;
    const realFile = file as File;

    if (realFile.size > maxSizeBytes) {
      return {
        success: false,
        urls: [],
        count: 0,
        error: `File ${realFile.name} exceeds ${Math.round(maxSizeBytes / (1024 * 1024))}MB limit.`,
        status: 400,
      };
    }

    const buffer = Buffer.from(await realFile.arrayBuffer());
    const verified = verifyImageMagicBytes(buffer);
    if (!verified.valid) {
      return {
        success: false,
        urls: [],
        count: 0,
        error: `Invalid file format for ${realFile.name}. Only genuine WebP, JPEG, and PNG images are allowed.`,
        status: 400,
      };
    }

    const safeBase = sanitizeFileName(realFile.name.substring(0, realFile.name.lastIndexOf('.')) || 'image');
    const filePath = `${cleanPrefix}/${timestamp}_${i}_${safeBase}.${verified.ext}`;

    const publicUrl = await uploadObjectToR2(filePath, buffer, verified.mime, cacheControl);
    uploadedUrls.push(publicUrl);
  }

  return {
    success: true,
    urls: uploadedUrls,
    count: uploadedUrls.length,
    status: 200,
  };
}

function isBlockedHostForFetch(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return true;
  }
  const m172 = h.match(/^172\.(\d{1,3})\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(?:fc|fd|fe8|fe9|fea|feb)/i.test(h)) return true;
  return false;
}

/**
 * Downloads an external card artwork URL and re-hosts it inside our own Cloudflare R2
 * bucket so saved cards always point to our R2 CDN rather than hotlinking external sites.
 */
export async function mirrorExternalCardImage(
  externalUrl: string,
  folderPrefix: string,
  slugHint = 'card',
  options: { maxSizeBytes?: number } = {}
): Promise<{ success: true; url: string; key: string } | { success: false; error: string }> {
  const maxSizeBytes = options.maxSizeBytes ?? 10 * 1024 * 1024;

  let parsed: URL;
  try {
    parsed = new URL(externalUrl.trim());
  } catch {
    return { success: false, error: 'Invalid image URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { success: false, error: 'Only http(s) image URLs are allowed.' };
  }
  if (isBlockedHostForFetch(parsed.hostname)) {
    return { success: false, error: 'Blocked image host.' };
  }

  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'image/webp,image/png,image/jpeg,image/*,*/*;q=0.8' },
    });
  } catch {
    return { success: false, error: 'Could not download the external image. Try uploading the file directly.' };
  }

  if (!res.ok) {
    return { success: false, error: `External image returned HTTP ${res.status}. Try uploading the file directly.` };
  }

  // Re-check final redirect target host
  try {
    const finalUrl = new URL(res.url || parsed.toString());
    if (isBlockedHostForFetch(finalUrl.hostname)) {
      return { success: false, error: 'Blocked redirect target.' };
    }
  } catch {}

  const contentLength = Number(res.headers.get('content-length') || '0');
  if (contentLength > maxSizeBytes) {
    return { success: false, error: `Image exceeds ${Math.round(maxSizeBytes / (1024 * 1024))}MB limit.` };
  }

  const arrBuf = await res.arrayBuffer();
  if (arrBuf.byteLength > maxSizeBytes) {
    return { success: false, error: `Image exceeds ${Math.round(maxSizeBytes / (1024 * 1024))}MB limit.` };
  }

  const buffer = Buffer.from(arrBuf);
  const verified = verifyImageMagicBytes(buffer);
  if (!verified.valid) {
    return { success: false, error: 'External URL did not return a valid WebP, PNG, or JPEG image.' };
  }

  const cleanPrefix = folderPrefix.replace(/^\/+|\/+$/g, '');
  const safeSlug = sanitizeFileName(slugHint || 'card').replace(/\.[^.]+$/, '') || 'card';
  const filePath = `${cleanPrefix}/${Date.now()}_${safeSlug}.${verified.ext}`;

  try {
    const publicUrl = await uploadObjectToR2(filePath, buffer, verified.mime);
    return { success: true, url: publicUrl, key: filePath };
  } catch (err: any) {
    console.error('Mirror image R2 upload error:', err);
    return { success: false, error: err?.message || 'Failed to store imported image in R2.' };
  }
}
