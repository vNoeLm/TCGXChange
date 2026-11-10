import type { APIRoute } from 'astro';
import { sanitizePlainText } from '../../lib/sanitize';

export const prerender = false;

const errorRateMap = new Map<string, { count: number; resetAt: number }>();

export const POST: APIRoute = async ({ request }) => {
  try {
    const ip =
      request.headers.get('cf-connecting-ip')?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';

    const now = Date.now();
    if (errorRateMap.size > 2000) {
      for (const [k, v] of errorRateMap.entries()) {
        if (v.resetAt < now) errorRateMap.delete(k);
      }
    }
    const rate = errorRateMap.get(ip);
    if (rate && rate.resetAt > now) {
      if (rate.count >= 10) {
        return new Response(JSON.stringify({ ok: false, error: 'Too many requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      rate.count += 1;
    } else {
      errorRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    }

    const rawText = await request.text();
    if (rawText.length > 4096) {
      return new Response(JSON.stringify({ ok: false, error: 'Payload too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = JSON.parse(rawText);
    const message = sanitizePlainText(body?.message || body?.error || 'Client error', 500);
    const url = sanitizePlainText(body?.url || '', 200);
    console.error('>>> [CLIENT ERROR CAUGHT]:', { message, url });
  } catch {}
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
