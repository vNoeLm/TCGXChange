import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    console.error('>>> [CLIENT ERROR CAUGHT]:', JSON.stringify(body, null, 2));
    const logPath = path.resolve(process.cwd(), 'client_errors.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${JSON.stringify(body, null, 2)}\n\n`);
  } catch (err) {}
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
