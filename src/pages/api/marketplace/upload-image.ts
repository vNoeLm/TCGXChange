import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/requestAuth';
import { requireP2PUser } from '../../../lib/p2pServer';
import { processImageUpload } from '../../../lib/serverUpload';
import { P2P_MAX_POST_IMAGES } from '../../../lib/p2pConstants';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const files = [...formData.getAll('files'), ...formData.getAll('file')].filter(Boolean);

    if (files.length === 0) {
      return jsonResponse({ success: false, error: 'Please choose at least one image to upload.' }, 400);
    }

    const result = await processImageUpload(files, `marketplace/${auth.caller.user.id}`, {
      maxFiles: P2P_MAX_POST_IMAGES,
    });

    if (!result.success) {
      return jsonResponse({ success: false, error: result.error }, result.status);
    }

    return jsonResponse({ success: true, urls: result.urls, count: result.count }, 200);
  } catch (err: any) {
    console.error('Marketplace image upload error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Image upload failed.' }, 500);
  }
};
