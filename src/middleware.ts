import { defineMiddleware } from 'astro:middleware';
import { getRequestUser, bannedResponse } from './lib/requestAuth';
import { isRestrictedApiPath } from './lib/accountAccess';

export const onRequest = defineMiddleware(async (context, next) => {
  // A suspended account can still read the catalog and use the store, but not the community
  // features. The pages redirect in AccountAccessGate; this is the part a direct API write hits.
  // Reads stay open because the marketplace's public data is readable by guests too.
  const method = context.request.method.toUpperCase();
  let response: Response;
  if (isRestrictedApiPath(context.url.pathname) && method !== 'GET' && method !== 'HEAD') {
    try {
      const caller = await getRequestUser(context.request);
      response = caller?.isBanned ? bannedResponse() : await next();
    } catch (err) {
      // Never take the marketplace down over a failed ban lookup; the route's own auth still runs.
      console.error('Ban check failed:', err);
      response = await next();
    }
  } else {
    response = await next();
  }

  // Enforce defensive security headers on all responses
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content-Security-Policy on HTML responses (blocks clickjacking & unauthorized external scripts)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.supabase.co",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://pub-fc12cf26538b49798ca89e43c2bf3c4a.r2.dev https://api.frankfurter.dev",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
  }

  return response;
});
