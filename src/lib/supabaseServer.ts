import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Synchronously load .env file into process.env in Node.js server environment
if (typeof process !== 'undefined') {
  try {
    dotenv.config();
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  } catch (e) {}
}

function readKeyFromEnvFile(name: string): string {
  try {
    const envPaths = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '.env.local'),
      path.join(process.cwd(), '..', '.env'),
    ];
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const idx = trimmed.indexOf('=');
          const key = trimmed.slice(0, idx).trim();
          if (key === name) {
            let val = trimmed.slice(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (val) return val;
          }
        }
      }
    }
  } catch (e) {}
  return '';
}

export function getServerSupabaseUrl(): string {
  return (
    process.env.PUBLIC_SUPABASE_URL ||
    (import.meta as any).env?.PUBLIC_SUPABASE_URL ||
    readKeyFromEnvFile('PUBLIC_SUPABASE_URL') ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://xtyfzkqubmzrsvduvzcl.supabase.co'
  );
}

export function getServerRealtimeKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY ||
    readKeyFromEnvFile('SUPABASE_SERVICE_ROLE_KEY') ||
    process.env.PUBLIC_SUPABASE_ANON_KEY ||
    (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY ||
    readKeyFromEnvFile('PUBLIC_SUPABASE_ANON_KEY') ||
    ''
  );
}

function getServiceRoleKey(): string {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY ||
    readKeyFromEnvFile('SUPABASE_SERVICE_ROLE_KEY');

  if (!key) {
    console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing! Admin operations will fail.');
    // Never fall back to anon key for admin client, because doing so causes silent RLS violations
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured in server environment.');
  }
  return key;
}

let _adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const url = getServerSupabaseUrl();
    const key = getServiceRoleKey();
    if (!url || !key) {
      console.warn('Supabase server client initialized without URL or key. Check environment variables.');
    }
    _adminClient = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder-key', {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _adminClient;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    const val = (client as any)[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  },
});
