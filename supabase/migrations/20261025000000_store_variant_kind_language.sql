-- ==============================================================================
-- Migration: 20261025000000_store_variant_kind_language.sql
-- TCG_Vault - Allow 'language' variant_kind for store products (English, Japanese, Chinese, etc.)
-- ==============================================================================

ALTER TABLE public.store_products DROP CONSTRAINT IF EXISTS store_products_variant_kind_check;
ALTER TABLE public.store_products
    ADD CONSTRAINT store_products_variant_kind_check
    CHECK (variant_kind IS NULL OR variant_kind IN ('color', 'set', 'size', 'language', 'other'));
