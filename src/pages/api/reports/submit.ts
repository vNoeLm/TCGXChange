import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';

export const prerender = false;

// Cooldown tracking to prevent automated report flooding
const recentReportsMap = new Map<string, number>();

export interface ModerationReport {
  id: string;
  type: 'listing' | 'profile' | 'message';
  target_id: string;
  target_name: string;
  target_link: string;
  reason: string;
  details?: string;
  reporter_id?: string | null;
  reporter_name?: string;
  status: 'pending' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await getRequestUser(request);
    const user = auth?.user || null;
    const body = await request.json().catch(() => null);

    if (!body || !body.type || !body.target_id || !body.reason) {
      return jsonResponse({ success: false, error: 'Missing required report fields (type, target_id, reason).' }, 400);
    }

    const validTypes = ['listing', 'profile', 'message'];
    if (!validTypes.includes(body.type)) {
      return jsonResponse({ success: false, error: 'Invalid report type.' }, 400);
    }

    // Flood protection: max 1 report every 5 seconds per user or IP
    const ip =
      request.headers.get('cf-connecting-ip')?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const rateKey = user?.id || ip;
    const nowMs = Date.now();
    if (recentReportsMap.size > 2000) {
      for (const [k, v] of recentReportsMap.entries()) {
        if (nowMs - v > 60_000) recentReportsMap.delete(k);
      }
    }
    const lastReportTime = recentReportsMap.get(rateKey);
    if (lastReportTime && (nowMs - lastReportTime) < 5000) {
      return jsonResponse({ success: false, error: 'Please wait a few seconds before submitting another report.' }, 429);
    }
    recentReportsMap.set(rateKey, nowMs);

    let reporterName = 'Anonymous Collector';
    if (user) {
      const { data: prof } = await supabaseAdmin.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      reporterName = prof?.display_name || user.user_metadata?.display_name || user.email || 'Collector';
    }

    const newReport: ModerationReport = {
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: body.type,
      target_id: sanitizePlainText(body.target_id, 100),
      target_name: sanitizePlainText(body.target_name || body.target_id, 150),
      target_link: sanitizePlainText(body.target_link || '', 300),
      reason: sanitizePlainText(body.reason, 100),
      details: body.details ? sanitizePlainText(body.details, 1000) : undefined,
      reporter_id: user?.id || null,
      reporter_name: sanitizePlainText(reporterName, 100),
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    // Load existing reports from settings key 'moderation_reports'
    const { data: settingsRow } = await supabaseAdmin.from('settings').select('value').eq('key', 'moderation_reports').maybeSingle();
    let existingReports: ModerationReport[] = [];
    if (settingsRow?.value) {
      try {
        const parsed = typeof settingsRow.value === 'string' ? JSON.parse(settingsRow.value) : settingsRow.value;
        if (Array.isArray(parsed)) existingReports = parsed;
      } catch {
        existingReports = [];
      }
    }

    existingReports.unshift(newReport);
    // Keep up to 500 reports
    if (existingReports.length > 500) {
      existingReports = existingReports.slice(0, 500);
    }

    await supabaseAdmin.from('settings').upsert({
      key: 'moderation_reports',
      value: JSON.stringify(existingReports),
    });

    return jsonResponse({ success: true, report: newReport }, 201);
  } catch (err: any) {
    console.error('Error submitting report:', err);
    return jsonResponse({ success: false, error: 'Internal server error.' }, 500);
  }
};
