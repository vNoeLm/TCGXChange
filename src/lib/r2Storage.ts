import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { IMAGE_CDN_URL } from './supabase';

interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Uint8Array | Buffer | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
    }
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

let cachedS3Client: S3Client | null | undefined;

async function getWorkersR2Binding(): Promise<R2BucketLike | null> {
  try {
    const modName = 'cloudflare:workers';
    const mod: any = await import(/* @vite-ignore */ modName);
    const bucket = mod?.env?.CARD_IMAGES_R2;
    if (bucket && typeof bucket.put === 'function') {
      return bucket as R2BucketLike;
    }
  } catch {
    // Not running inside Cloudflare Workers runtime (e.g. local Node / Vitest)
  }
  return null;
}

function getEnv(key: string): string {
  const fromImportMeta = (import.meta as any)?.env?.[key];
  if (typeof fromImportMeta === 'string' && fromImportMeta.trim()) return fromImportMeta.trim();
  if (typeof process !== 'undefined' && process.env?.[key]) return String(process.env[key]).trim();
  return '';
}

function getS3FallbackClient(): { client: S3Client; bucket: string } | null {
  const accountId = getEnv('R2_ACCOUNT_ID');
  const accessKeyId = getEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = getEnv('R2_SECRET_ACCESS_KEY');
  const bucket = getEnv('R2_BUCKET_NAME') || 'tcg-cards';

  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  if (!cachedS3Client) {
    cachedS3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return { client: cachedS3Client, bucket };
}

export function r2PublicUrl(key: string): string {
  const cleanKey = key.replace(/^\/+/, '');
  return `${IMAGE_CDN_URL}/${cleanKey}`;
}

/**
 * Uploads binary object directly to Cloudflare R2 (native Workers binding first,
 * S3 API fallback for local Node dev). Never writes to Supabase Storage.
 */
export async function uploadObjectToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  cacheControl = DEFAULT_CACHE_CONTROL
): Promise<string> {
  const cleanKey = key.replace(/^\/+/, '');
  const isDev = Boolean((import.meta as any)?.env?.DEV);

  // In local `astro dev`, `@astrojs/cloudflare` binds a local Miniflare R2 simulator
  // whose writes are invisible at the public `r2.dev` CDN URL. Prefer the real S3 API
  // client in dev when `.env` credentials are present, and use the native binding in prod.
  if (isDev) {
    const s3 = getS3FallbackClient();
    if (s3) {
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: cleanKey,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
        })
      );
      return r2PublicUrl(cleanKey);
    }
  }

  const binding = await getWorkersR2Binding();
  if (binding) {
    await binding.put(cleanKey, body, {
      httpMetadata: {
        contentType,
        cacheControl,
      },
    });
    return r2PublicUrl(cleanKey);
  }

  const s3 = getS3FallbackClient();
  if (s3) {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: cleanKey,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      })
    );
    return r2PublicUrl(cleanKey);
  }

  throw new Error(
    'Cloudflare R2 storage is not configured. Bind CARD_IMAGES_R2 in wrangler.jsonc or set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env.'
  );
}

/**
 * Deletes an explicit list of object keys from Cloudflare R2 in safe batches.
 */
export async function deleteObjectsFromR2(keys: string[]): Promise<{ deleted: number; errors: string[] }> {
  const cleanKeys = [...new Set(keys.map((k) => k.replace(/^\/+/, '')).filter(Boolean))];
  if (cleanKeys.length === 0) return { deleted: 0, errors: [] };

  const errors: string[] = [];
  let deleted = 0;
  const isDev = Boolean((import.meta as any)?.env?.DEV);

  if (isDev) {
    const s3 = getS3FallbackClient();
    if (s3) {
      const chunkSize = 500;
      for (let i = 0; i < cleanKeys.length; i += chunkSize) {
        const batch = cleanKeys.slice(i, i + chunkSize);
        try {
          await s3.client.send(
            new DeleteObjectsCommand({
              Bucket: s3.bucket,
              Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            })
          );
          deleted += batch.length;
        } catch (e: any) {
          errors.push(e?.message || String(e));
        }
      }
      return { deleted, errors };
    }
  }

  const binding = await getWorkersR2Binding();
  if (binding) {
    const chunkSize = 500;
    for (let i = 0; i < cleanKeys.length; i += chunkSize) {
      const batch = cleanKeys.slice(i, i + chunkSize);
      try {
        await binding.delete(batch);
        deleted += batch.length;
      } catch (e: any) {
        errors.push(e?.message || String(e));
      }
    }
    return { deleted, errors };
  }

  const s3 = getS3FallbackClient();
  if (s3) {
    const chunkSize = 500;
    for (let i = 0; i < cleanKeys.length; i += chunkSize) {
      const batch = cleanKeys.slice(i, i + chunkSize);
      try {
        await s3.client.send(
          new DeleteObjectsCommand({
            Bucket: s3.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          })
        );
        deleted += batch.length;
      } catch (e: any) {
        errors.push(e?.message || String(e));
      }
    }
    return { deleted, errors };
  }

  return { deleted: 0, errors: ['Cloudflare R2 storage is not configured.'] };
}

/**
 * Deletes every object in Cloudflare R2 under `folder/` (optionally filtered by filename prefix).
 */
export async function deletePrefixFromR2(folder: string, namePrefix?: string): Promise<{ error: { message: string } | null }> {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
  const prefix = namePrefix ? `${cleanFolder}/${namePrefix}` : `${cleanFolder}/`;

  const keys: string[] = [];

  const binding = await getWorkersR2Binding();
  if (binding) {
    try {
      let cursor: string | undefined;
      do {
        const res = await binding.list({ prefix, cursor, limit: 1000 });
        for (const obj of res.objects || []) {
          keys.push(obj.key);
        }
        cursor = res.truncated ? res.cursor : undefined;
      } while (cursor);
    } catch (e: any) {
      return { error: { message: e?.message || String(e) } };
    }
  } else {
    const s3 = getS3FallbackClient();
    if (!s3) return { error: null };
    try {
      let token: string | undefined;
      do {
        const res = await s3.client.send(
          new ListObjectsV2Command({
            Bucket: s3.bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: 1000,
          })
        );
        for (const obj of res.Contents || []) {
          if (obj.Key) keys.push(obj.Key);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
    } catch (e: any) {
      return { error: { message: e?.message || String(e) } };
    }
  }

  if (keys.length === 0) return { error: null };
  const result = await deleteObjectsFromR2(keys);
  return { error: result.errors.length > 0 ? { message: result.errors.join('; ') } : null };
}
