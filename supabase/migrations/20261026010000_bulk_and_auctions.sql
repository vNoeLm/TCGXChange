-- ==============================================================================
-- Migration: 20261026010000_bulk_and_auctions.sql
-- Description: Marketplace Bulk Listings and Auctions with Bid Minute Rules
-- ==============================================================================

-- 1. Update marketplace_trades status check if present to allow 'on_hold'
DO $$
BEGIN
    ALTER TABLE public.marketplace_trades DROP CONSTRAINT IF EXISTS marketplace_trades_status_check;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 2. Marketplace Bulk Listings Table
CREATE TABLE IF NOT EXISTS public.marketplace_bulk_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL DEFAULT 'Bulk Card Lot',
    game VARCHAR(50) NOT NULL DEFAULT 'riftbound',
    exact_card_count INTEGER CHECK (exact_card_count IS NULL OR exact_card_count > 0),
    approx_card_count INTEGER CHECK (approx_card_count IS NULL OR approx_card_count > 0),
    condition VARCHAR(50) NOT NULL DEFAULT 'Mixed',
    includes_foil BOOLEAN NOT NULL DEFAULT false,
    price_huf INTEGER NOT NULL CHECK (price_huf > 0),
    handover_methods TEXT[] NOT NULL DEFAULT ARRAY['personal', 'foxpost', 'packeta', 'other'],
    description TEXT,
    images JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'in_stock', -- 'in_stock', 'on_hold', 'sold'
    likes_count INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_bulk_card_count CHECK (exact_card_count IS NOT NULL OR approx_card_count IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_mkt_bulk_seller ON public.marketplace_bulk_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_bulk_status ON public.marketplace_bulk_listings(status);
CREATE INDEX IF NOT EXISTS idx_mkt_bulk_game ON public.marketplace_bulk_listings(game);
CREATE INDEX IF NOT EXISTS idx_mkt_bulk_created ON public.marketplace_bulk_listings(created_at DESC);

ALTER TABLE public.marketplace_bulk_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read bulk listings" ON public.marketplace_bulk_listings;
CREATE POLICY "Public can read bulk listings" ON public.marketplace_bulk_listings FOR SELECT USING (true);

-- 3. Marketplace Auctions Table
CREATE TABLE IF NOT EXISTS public.marketplace_auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    card_id UUID REFERENCES public.cards(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    game VARCHAR(50) NOT NULL DEFAULT 'riftbound',
    condition VARCHAR(50) NOT NULL DEFAULT 'Near Mint',
    is_foil BOOLEAN NOT NULL DEFAULT false,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    images JSONB NOT NULL DEFAULT '[]'::jsonb,
    base_price_huf INTEGER NOT NULL CHECK (base_price_huf > 0),
    bid_step_huf INTEGER NOT NULL DEFAULT 50 CHECK (bid_step_huf > 0),
    current_bid_huf INTEGER,
    bid_count INTEGER NOT NULL DEFAULT 0,
    highest_bidder_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    highest_bidder_name VARCHAR(120),
    extension_minutes INTEGER NOT NULL DEFAULT 5 CHECK (extension_minutes >= 0),
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    handover_methods TEXT[] NOT NULL DEFAULT ARRAY['personal', 'foxpost', 'packeta', 'other'],
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'ended', 'completed', 'cancelled', 'expired'
    conversation_id UUID,
    hold_request_id UUID,
    likes_count INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    bids JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mkt_auctions_seller ON public.marketplace_auctions(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_auctions_status ON public.marketplace_auctions(status);
CREATE INDEX IF NOT EXISTS idx_mkt_auctions_ends_at ON public.marketplace_auctions(ends_at);
CREATE INDEX IF NOT EXISTS idx_mkt_auctions_game ON public.marketplace_auctions(game);

ALTER TABLE public.marketplace_auctions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read auctions" ON public.marketplace_auctions;
CREATE POLICY "Public can read auctions" ON public.marketplace_auctions FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';
