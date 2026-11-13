import type { APIRoute } from 'astro';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { processImageUpload } from '../../../lib/serverUpload';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized: Missing or invalid token.' }, 401);
    }
    if (caller.isBanned) {
      return jsonResponse({ success: false, error: 'Forbidden: Your account is suspended.' }, 403);
    }

    const formData = await request.formData();
    const rawFiles = formData.getAll('files');
    const files = (rawFiles.length > 0 ? rawFiles : formData.getAll('file')) as File[];

    const result = await processImageUpload(files, `messages/${caller.user.id}`, { maxFiles: 8 });
    return jsonResponse(
      result.success
        ? { success: true, urls: result.urls, count: result.count }
        : { success: false, error: result.error },
      result.status
    );
  } catch (err: any) {
    console.error('Error in messages upload-image:', err);
    return jsonResponse({ success: false, error: err.message || 'Internal server error.' }, 500);
  }
};
