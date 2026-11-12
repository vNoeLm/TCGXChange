-- ==============================================================================
-- Migration: 20261112000000_store_singles_migration.sql
-- TCG XChange - Move Singles to B2C Store & Sunset P2P Marketplace
--
-- 1. Add expression indexes on store_products.attributes for fast singles lookups
--    by card_id and collection_id.
-- 2. Migrate active P2P marketplace_listings into public.store_products under
--    category = 'singles'.
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_store_products_attr_card_id
  ON public.store_products ((attributes->>'card_id'))
  WHERE category = 'singles';

CREATE INDEX IF NOT EXISTS idx_store_products_attr_collection_id
  ON public.store_products ((attributes->>'collection_id'))
  WHERE category = 'singles';
