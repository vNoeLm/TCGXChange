/**
 * Email & Owner Notification Dispatcher (Resend API + optional Discord/Webhook fallback).
 * Gracefully no-ops in local/dev environments when RESEND_API_KEY is not configured.
 */

import { escapeHtml, sanitizePlainText } from './sanitize';

const RESEND_API_URL = 'https://api.resend.com/emails';

function getEnv(key: string): string | undefined {
  try {
    return (import.meta as any).env?.[key] || process.env?.[key];
  } catch {
    return process.env?.[key];
  }
}

export async function sendTransactionalEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getEnv('RESEND_FROM_EMAIL') || 'TCGXchange <notifications@tcgxchange.net>';
  if (!apiKey || !params.to) return false;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn('Failed to send transactional email:', e);
    return false;
  }
}

export async function notifySellerHoldRequest(params: {
  sellerEmail?: string | null;
  sellerName?: string;
  buyerName: string;
  cardSummary: string;
  totalHuf: number;
  handoverLabel: string;
}): Promise<void> {
  if (!params.sellerEmail) return;
  const totalFormatted = `${params.totalHuf.toLocaleString('hu-HU')} Ft`;
  const safeSellerName = escapeHtml(params.sellerName || 'Seller');
  const safeBuyerName = escapeHtml(params.buyerName);
  const safeCardSummary = escapeHtml(params.cardSummary);
  const safeHandover = escapeHtml(params.handoverLabel);
  const safeSubjectBuyer = sanitizePlainText(params.buyerName, 80);
  await sendTransactionalEmail({
    to: params.sellerEmail,
    subject: `New Hold Request from ${safeSubjectBuyer} — TCGXchange`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; color: #111;">
        <h2 style="margin-bottom: 8px;">New Hold Request Received</h2>
        <p>Hi ${safeSellerName},</p>
        <p><strong>${safeBuyerName}</strong> requested a hold on your marketplace listing(s):</p>
        <div style="background: #f4f4f5; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
          <div><strong>Items:</strong> ${safeCardSummary}</div>
          <div><strong>Total:</strong> ${totalFormatted}</div>
          <div><strong>Handover:</strong> ${safeHandover}</div>
        </div>
        <p>Open your <a href="https://tcgxchange.net/seller">Seller Dashboard</a> or <a href="https://tcgxchange.net/messages">Messages</a> within 48 hours to accept or decline the request.</p>
      </div>
    `,
  });
}

export async function notifyBuyerHoldDecision(params: {
  buyerEmail?: string | null;
  buyerName?: string;
  sellerName?: string;
  decision: 'accepted' | 'rejected' | 'shipped';
  cardSummary: string;
  trackingNumber?: string | null;
}): Promise<void> {
  if (!params.buyerEmail) return;
  const statusTitle =
    params.decision === 'accepted'
      ? 'Your Hold Request Was Accepted'
      : params.decision === 'shipped'
        ? 'Your Cards Are on the Way'
        : 'Your Hold Request Was Declined';

  const safeBuyerName = escapeHtml(params.buyerName || 'Collector');
  const safeSellerName = escapeHtml(params.sellerName || 'The seller');
  const safeCardSummary = escapeHtml(params.cardSummary);
  const safeDecision = escapeHtml(params.decision);
  const safeTracking = params.trackingNumber ? escapeHtml(params.trackingNumber) : '';

  await sendTransactionalEmail({
    to: params.buyerEmail,
    subject: `${statusTitle} — TCGXchange`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; color: #111;">
        <h2 style="margin-bottom: 8px;">${statusTitle}</h2>
        <p>Hi ${safeBuyerName},</p>
        <p><strong>${safeSellerName}</strong> updated your hold request for <strong>${safeCardSummary}</strong> (${safeDecision}).</p>
        ${safeTracking ? `<p><strong>Tracking Number:</strong> <code>${safeTracking}</code></p>` : ''}
        <p>View the latest status and chat in <a href="https://tcgxchange.net/messages">TCGXchange Messages</a>.</p>
      </div>
    `,
  });
}

export async function notifyOwnerStoreOrder(params: {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  totalHuf: number;
  shippingMethod: string;
  itemCount: number;
}): Promise<void> {
  const ownerEmail = getEnv('OWNER_NOTIFICATION_EMAIL') || getEnv('ADMIN_EMAIL');
  const webhookUrl = getEnv('OWNER_WEBHOOK_URL');
  const totalFormatted = `${params.totalHuf.toLocaleString('hu-HU')} Ft`;
  const safeOrderNumber = escapeHtml(params.orderNumber);
  const safeCustomerName = escapeHtml(params.customerName);
  const safeCustomerEmail = escapeHtml(params.customerEmail);
  const safeShippingMethod = escapeHtml(params.shippingMethod);

  if (ownerEmail) {
    await sendTransactionalEmail({
      to: ownerEmail,
      subject: `[TCGXchange Store] New Order #${sanitizePlainText(params.orderNumber, 40)} (${totalFormatted})`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; color: #111;">
          <h2 style="margin-bottom: 8px;">New Official Store Order #${safeOrderNumber}</h2>
          <p><strong>Customer:</strong> ${safeCustomerName} (${safeCustomerEmail})</p>
          <p><strong>Items:</strong> ${Number(params.itemCount) || 0}</p>
          <p><strong>Total:</strong> ${totalFormatted}</p>
          <p><strong>Delivery:</strong> ${safeShippingMethod}</p>
          <p><a href="https://tcgxchange.net/admin">Open Admin Console</a></p>
        </div>
      `,
    });
  }

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `New Store Order **#${sanitizePlainText(params.orderNumber, 40)}** from **${sanitizePlainText(params.customerName, 80)}** — **${totalFormatted}** (${Number(params.itemCount) || 0} item(s), ${sanitizePlainText(params.shippingMethod, 120)})`,
        }),
      });
    } catch {}
  }
}
