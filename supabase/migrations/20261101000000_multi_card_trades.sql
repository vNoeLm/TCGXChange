-- Add multi-card support to marketplace_trades while preserving backward compatibility
ALTER TABLE public.marketplace_trades
  ADD COLUMN IF NOT EXISTS offered_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS wanted_items JSONB NOT NULL DEFAULT '[]'::jsonb;
