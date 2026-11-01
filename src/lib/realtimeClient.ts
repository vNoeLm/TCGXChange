import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import {
  REALTIME_BROADCAST_EVENT,
  ACTIVE_THREAD_WINDOW_EVENT,
  userRealtimeTopic,
  createEventDeduper,
  type RealtimeEventPayload,
} from './realtimeEvents';
import type { ChatMessage } from '../types';

type RealtimeListener = (event: RealtimeEventPayload) => void;

interface ChannelEntry {
  channel: RealtimeChannel;
  listeners: Set<RealtimeListener>;
  deduper: ReturnType<typeof createEventDeduper>;
}

const userChannels = new Map<string, ChannelEntry>();
const topicChannels = new Map<string, ChannelEntry>();

let currentActiveConversationId: string | null = null;

/**
 * Records which conversation thread is actively open on `/messages` in this tab
 * so global toast notices stay silent for the thread the user is already reading.
 */
export function setActiveConversationId(conversationId: string | null): void {
  currentActiveConversationId = conversationId;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(ACTIVE_THREAD_WINDOW_EVENT, { detail: { conversationId } })
    );
  }
}

export function getActiveConversationId(): string | null {
  return currentActiveConversationId;
}

function dedupeKeyFor(evt: RealtimeEventPayload): string {
  const id = evt.message?.id || evt.event_id;
  return `${evt.type}:${id}`;
}

function dispatchToEntry(entry: ChannelEntry, evt: RealtimeEventPayload): void {
  if (!evt || !evt.type) return;
  if (!entry.deduper.markIfNew(dedupeKeyFor(evt))) return;
  entry.listeners.forEach((fn) => {
    try {
      fn(evt);
    } catch (err) {
      console.warn('Realtime listener error:', err);
    }
  });
}

/**
 * Immediately notifies all active in-tab listeners for `userId` (e.g. clearing the navbar
 * unread badge the instant `markThreadRead` runs) while recording the event ID so any
 * subsequent WebSocket echo is ignored.
 */
export function emitLocalRealtimeEvent(userId: string, event: RealtimeEventPayload): void {
  const entry = userChannels.get(userId);
  if (!entry) return;
  dispatchToEntry(entry, event);
}

/**
 * Subscribes to real-time events for `userId`. Multiple components (`Navigation`, `MessagesApp`)
 * share a single underlying WebSocket channel per signed-in user.
 */
export function subscribeUserRealtime(
  userId: string,
  listener: RealtimeListener
): () => void {
  if (!userId || typeof window === 'undefined') {
    return () => {};
  }

  let entry = userChannels.get(userId);
  if (!entry) {
    const topic = userRealtimeTopic(userId);
    const deduper = createEventDeduper(400);
    const listeners = new Set<RealtimeListener>();

    const channel = supabase
      .channel(topic, {
        config: {
          broadcast: { self: true },
        },
      })
      .on('broadcast', { event: REALTIME_BROADCAST_EVENT }, (msg) => {
        const payload = msg?.payload as RealtimeEventPayload | undefined;
        if (payload && entry) {
          dispatchToEntry(entry, payload);
        }
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'hold_request_messages',
        },
        (change) => {
          const row = change?.new as ChatMessage | undefined;
          if (!row?.id || !entry) return;
          dispatchToEntry(entry, {
            event_id: row.id,
            type: row.message_type === 'system' ? 'system_notice' : 'chat_message',
            conversation_id: row.conversation_id,
            hold_request_id: row.hold_request_id || null,
            sender_id: row.sender_id,
            message: row,
            created_at: row.created_at || new Date().toISOString(),
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'hold_requests',
          filter: `seller_id=eq.${userId}`,
        },
        (change) => {
          const row = (change?.new || change?.old) as Record<string, any> | undefined;
          if (!row?.id || !entry) return;
          dispatchToEntry(entry, {
            event_id: `hold:${row.id}:${row.updated_at || Date.now()}`,
            type: 'hold_changed',
            conversation_id: row.conversation_id || null,
            hold_request_id: row.id,
            created_at: row.updated_at || new Date().toISOString(),
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'hold_requests',
          filter: `buyer_id=eq.${userId}`,
        },
        (change) => {
          const row = (change?.new || change?.old) as Record<string, any> | undefined;
          if (!row?.id || !entry) return;
          dispatchToEntry(entry, {
            event_id: `hold:${row.id}:${row.updated_at || Date.now()}`,
            type: 'hold_changed',
            conversation_id: row.conversation_id || null,
            hold_request_id: row.id,
            created_at: row.updated_at || new Date().toISOString(),
          });
        }
      );

    entry = { channel, listeners, deduper };
    userChannels.set(userId, entry);
    channel.subscribe();
  }

  entry.listeners.add(listener);

  return () => {
    const current = userChannels.get(userId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      userChannels.delete(userId);
      supabase.removeChannel(current.channel).catch(() => {});
    }
  };
}

/**
 * Subscribes to a shared public realtime topic (e.g. `marketplace:auctions` for live bidding).
 */
export function subscribeTopicRealtime(
  topic: string,
  listener: RealtimeListener
): () => void {
  if (!topic || typeof window === 'undefined') {
    return () => {};
  }

  let entry = topicChannels.get(topic);
  if (!entry) {
    const deduper = createEventDeduper(300);
    const listeners = new Set<RealtimeListener>();
    const channel = supabase
      .channel(topic, {
        config: {
          broadcast: { self: true },
        },
      })
      .on('broadcast', { event: REALTIME_BROADCAST_EVENT }, (msg) => {
        const payload = msg?.payload as RealtimeEventPayload | undefined;
        if (payload && entry) {
          dispatchToEntry(entry, payload);
        }
      });

    entry = { channel, listeners, deduper };
    topicChannels.set(topic, entry);
    channel.subscribe();
  }

  entry.listeners.add(listener);

  return () => {
    const current = topicChannels.get(topic);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      topicChannels.delete(topic);
      supabase.removeChannel(current.channel).catch(() => {});
    }
  };
}

/**
 * Publishes an event from the browser to one or more users' realtime channels
 * via Supabase Realtime's HTTP broadcast endpoint.
 */
export async function broadcastClientRealtime(
  userIds: Array<string | null | undefined>,
  payload: RealtimeEventPayload,
  extraTopics: string[] = []
): Promise<void> {
  const topics = [
    ...userIds
      .filter((id): id is string => Boolean(id && id.trim()))
      .map((id) => userRealtimeTopic(id)),
    ...extraTopics.filter((t): t is string => Boolean(t && t.trim())),
  ];
  const uniqueTopics = [...new Set(topics)];
  if (uniqueTopics.length === 0) return;

  const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
  if (!baseUrl || !SUPABASE_ANON_KEY) return;

  try {
    const { data } = await supabase.auth.getSession();
    const bearer = data?.session?.access_token || SUPABASE_ANON_KEY;
    const messages = uniqueTopics.map((topic) => ({
      topic,
      event: REALTIME_BROADCAST_EVENT,
      payload,
    }));

    await fetch(`${baseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    });
  } catch (err) {
    // Non-fatal: recipient reconnect/visibility sync still catches up
    console.warn('Client realtime broadcast skipped:', err);
  }
}
