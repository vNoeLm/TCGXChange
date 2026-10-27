import type { APIRoute } from 'astro';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { processImageUpload } from '../../../lib/serverUpload';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) {
      return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
    }
    if (!caller.isAdmin) {
      return jsonResponse({ success: false, error: 'Forbidden: Admin access required.' }, 403);
    }

    const formData = await request.formData();
    const rawFiles = formData.getAll('files');
    const files = (rawFiles.length > 0 ? rawFiles : formData.getAll('file')) as File[];

    const result = await processImageUpload(files, 'showcase', { maxFiles: 10 });
    return jsonResponse(
      result.success
        ? { success: true, urls: result.urls, count: result.count }
        : { success: false, error: result.error },
      result.status
    );
  } catch (err: any) {
    console.error('Error in admin upload-image:', err);
    return jsonResponse({ success: false, error: err.message || 'Internal server error.' }, 500);
  }
};
