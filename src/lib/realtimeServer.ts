import { getServerSupabaseUrl, getServerRealtimeKey } from './supabaseServer';
import {
  REALTIME_BROADCAST_EVENT,
  userRealtimeTopic,
  type RealtimeEventPayload,
} from './realtimeEvents';

/**
 * Publishes a realtime event to one or more Realtime topics in a single HTTP request.
 * Uses Supabase's stateless `/realtime/v1/api/broadcast` endpoint so serverless API routes
 * do not need to open or tear down WebSockets. Never throws so business mutations stay safe.
 */
export async function broadcastTopicsServer(
  topics: Array<string | null | undefined>,
  payload: RealtimeEventPayload
): Promise<void> {
  const uniqueTopics = [...new Set(topics.filter((t): t is string => Boolean(t && t.trim())))];
  if (uniqueTopics.length === 0) return;

  const baseUrl = getServerSupabaseUrl().replace(/\/+$/, '');
  const apiKey = getServerRealtimeKey();
  if (!baseUrl || !apiKey) return;

  const messages = uniqueTopics.map((topic) => ({
    topic,
    event: REALTIME_BROADCAST_EVENT,
    payload,
  }));

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`${baseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Non-fatal: clients still have reconnect/visibility sync as backup
    console.warn('Realtime server broadcast skipped:', err);
  }
}

/**
 * Broadcasts an event to each specified user's personal realtime channel (`user-events:<uid>`),
 * plus any optional extra topics (such as `marketplace:auctions`).
 */
export async function broadcastToUsersServer(
  userIds: Array<string | null | undefined>,
  payload: RealtimeEventPayload,
  extraTopics: string[] = []
): Promise<void> {
  const userTopics = userIds
    .filter((id): id is string => Boolean(id && id.trim()))
    .map((id) => userRealtimeTopic(id));
  await broadcastTopicsServer([...userTopics, ...extraTopics], payload);
}
