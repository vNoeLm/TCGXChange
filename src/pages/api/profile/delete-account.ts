import type { APIRoute } from 'astro';
import { OWNER_ID } from '../../../lib/constants';
import { deleteUserAccount } from '../../../lib/deleteUserAccount';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';

export const prerender = false;

const OWNER_EMAILS = ['vnoel05@gmail.com', 'support@tcgxchange.net'];

/**
 * POST /api/profile/delete-account - the signed-in user closes their own account.
 *
 * This is deliberately not an admin route: the caller can only ever delete themselves. The owner
 * account is protected, and an open order or marketplace deal blocks the deletion until it is
 * finished so the other side is never left with a erased transaction.
 */
export const POST: APIRoute = async ({ request }) => {
  const caller = await getRequestUser(request);
  if (!caller) return jsonResponse({ success: false, error: 'Sign in to delete your account.' }, 401);

  const userId = caller.user.id;
  const email = (caller.user.email || '').toLowerCase();
  if (userId === OWNER_ID || OWNER_EMAILS.includes(email)) {
    return jsonResponse({ success: false, error: 'The owner account cannot be deleted from here.' }, 400);
  }

  const result = await deleteUserAccount(userId);

  if (result.blocked) {
    return jsonResponse({ success: false, error: result.blocked }, 409);
  }
  if (!result.deleted) {
    console.error('Account deletion failed for', userId, result.errors);
    return jsonResponse(
      {
        success: false,
        error: 'Your account could not be deleted completely. Please try again in a moment, or contact support@tcgxchange.net so we can finish it.',
      },
      500
    );
  }

  return jsonResponse({ success: true });
};
