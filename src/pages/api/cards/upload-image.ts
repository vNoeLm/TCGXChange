import type { APIRoute } from 'astro';
import { bannedResponse, getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { canCallerModerateGame } from '../../../lib/cardUpdateServer';
import { processImageUpload } from '../../../lib/serverUpload';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized — Sign in required.' }, 401);
    if (caller.isBanned) return bannedResponse();
    if (!caller.isAdmin && !caller.isModerator) {
      return jsonResponse({ success: false, error: 'Forbidden — Moderator or Admin access required.' }, 403);
    }

    const formData = await request.formData();
    const game = String(formData.get('game') || 'riftbound').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!canCallerModerateGame(caller, game)) {
      return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
    }

    const rawFiles = formData.getAll('files');
    const files = (rawFiles.length > 0 ? rawFiles : formData.getAll('file')) as File[];

    const result = await processImageUpload(files, `custom-cards/${game}`, { maxFiles: 2 });
    return jsonResponse(
      result.success
        ? { success: true, urls: result.urls, count: result.count }
        : { success: false, error: result.error },
      result.status
    );
  } catch (err: any) {
    console.error('Card upload-image error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Internal server error.' }, 500);
  }
};
