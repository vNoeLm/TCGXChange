import { supabaseAdmin } from './supabaseServer';
import { verifyImageMagicBytes, sanitizeFileName } from './sanitize';

export interface UploadOptions {
  maxFiles?: number;
  maxSizeBytes?: number;
  bucket?: string;
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
 * to Supabase Storage with defensive security checks.
 */
export async function processImageUpload(
  files: (File | unknown)[],
  folderPrefix: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const maxFiles = options.maxFiles ?? 10;
  const maxSizeBytes = options.maxSizeBytes ?? 10 * 1024 * 1024; // 10MB
  const bucket = options.bucket || 'card-images';

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

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: verified.mime,
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw uploadError;
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(filePath);

    if (publicData?.publicUrl) {
      uploadedUrls.push(publicData.publicUrl);
    }
  }

  return {
    success: true,
    urls: uploadedUrls,
    count: uploadedUrls.length,
    status: 200,
  };
}
