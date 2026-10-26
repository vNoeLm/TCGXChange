-- ==============================================================================
-- Migration: 20261026000000_marketplace_trades_and_likes.sql
-- Description: Marketplace Trades, Persistent Likes & Triggers Setup (Idempotent)
--
-- Adds:
-- 1. likes_count column to marketplace_listings
-- 2. marketplace_listing_likes table + DB trigger for atomic counter sync
-- 3. marketplace_trades table (Card X to Card Y trade listings) + RLS
-- 4. marketplace_trade_likes table + DB trigger for atomic counter sync
-- 5. marketplace_listing_saves & marketplace_trade_saves tables (compat)
-- 6. Comprehensive RLS policies and PostgREST schema reload
-- ==============================================================================

-- 1. Add likes_count column to marketplace_listings if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'marketplace_listings' AND column_name = 'likes_count'
    ) THEN
        ALTER TABLE public.marketplace_listings ADD COLUMN likes_count INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- 2. Listing Likes Table (Persistent likes on individual seller listings)
CREATE TABLE IF NOT EXISTS public.marketplace_listing_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_listing_user_like UNIQUE (listing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_listing_likes_listing ON public.marketplace_listing_likes(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_listing_likes_user ON public.marketplace_listing_likes(user_id);

-- 3. Atomic Trigger to keep marketplace_listings.likes_count in sync
CREATE OR REPLACE FUNCTION public.handle_marketplace_listing_like()
RETURNS TRIGGER AS $$
DECLARE
    target_id UUID;
    actual_count INTEGER;
BEGIN
    target_id := COALESCE(NEW.listing_id, OLD.listing_id);
    SELECT COUNT(*) INTO actual_count FROM public.marketplace_listing_likes WHERE listing_id = target_id;
    UPDATE public.marketplace_listings
    SET likes_count = actual_count
    WHERE id = target_id;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_marketplace_listing_like ON public.marketplace_listing_likes;
CREATE TRIGGER trg_marketplace_listing_like
AFTER INSERT OR DELETE ON public.marketplace_listing_likes
FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_listing_like();

-- 4. Marketplace Trades Table (Trade Card X for Card Y)
CREATE TABLE IF NOT EXISTS public.marketplace_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trader_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Card offered (Card X)
    offered_card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
    offered_condition VARCHAR(50) NOT NULL DEFAULT 'Near Mint',
    offered_is_foil BOOLEAN NOT NULL DEFAULT false,
    offered_quantity INTEGER NOT NULL DEFAULT 1 CHECK (offered_quantity >= 1),
    offered_images JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Card wanted (Card Y)
    wanted_card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
    wanted_min_condition VARCHAR(50) NOT NULL DEFAULT 'Near Mint',
    wanted_is_foil BOOLEAN, -- NULL means any finish, true = foil only, false = non-foil only
    wanted_quantity INTEGER NOT NULL DEFAULT 1 CHECK (wanted_quantity >= 1),

    -- Terms & Handover
    cash_difference_huf INTEGER NOT NULL DEFAULT 0,
    handover_methods TEXT[] NOT NULL DEFAULT ARRAY['personal', 'foxpost', 'packeta', 'other'],
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'open', -- 'open', 'completed', 'cancelled'
    likes_count INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_mkt_trades_trader ON public.marketplace_trades(trader_id);
CREATE INDEX IF NOT EXISTS idx_mkt_trades_offered ON public.marketplace_trades(offered_card_id);
CREATE INDEX IF NOT EXISTS idx_mkt_trades_wanted ON public.marketplace_trades(wanted_card_id);
CREATE INDEX IF NOT EXISTS idx_mkt_trades_status ON public.marketplace_trades(status);
CREATE INDEX IF NOT EXISTS idx_mkt_trades_created ON public.marketplace_trades(created_at DESC);

-- 5. Trade Likes Table
CREATE TABLE IF NOT EXISTS public.marketplace_trade_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES public.marketplace_trades(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_trade_user_like UNIQUE (trade_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_trade_likes_trade ON public.marketplace_trade_likes(trade_id);
CREATE INDEX IF NOT EXISTS idx_mkt_trade_likes_user ON public.marketplace_trade_likes(user_id);

-- 6. Atomic Trigger to keep marketplace_trades.likes_count in sync
CREATE OR REPLACE FUNCTION public.handle_marketplace_trade_like()
RETURNS TRIGGER AS $$
DECLARE
    target_id UUID;
    actual_count INTEGER;
BEGIN
    target_id := COALESCE(NEW.trade_id, OLD.trade_id);
    SELECT COUNT(*) INTO actual_count FROM public.marketplace_trade_likes WHERE trade_id = target_id;
    UPDATE public.marketplace_trades
    SET likes_count = actual_count
    WHERE id = target_id;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_marketplace_trade_like ON public.marketplace_trade_likes;
CREATE TRIGGER trg_marketplace_trade_like
AFTER INSERT OR DELETE ON public.marketplace_trade_likes
FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_trade_like();

-- 7. Saves compatibility tables (if needed by legacy bookmarking)
CREATE TABLE IF NOT EXISTS public.marketplace_listing_saves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_listing_user_save UNIQUE (listing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_listing_saves_user ON public.marketplace_listing_saves(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_listing_saves_listing ON public.marketplace_listing_saves(listing_id);

CREATE TABLE IF NOT EXISTS public.marketplace_trade_saves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES public.marketplace_trades(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_trade_user_save UNIQUE (trade_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_trade_saves_user ON public.marketplace_trade_saves(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_trade_saves_trade ON public.marketplace_trade_saves(trade_id);

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.marketplace_listing_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_trade_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listing_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_trade_saves ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies: Listing Likes
DROP POLICY IF EXISTS "Public read listing likes" ON public.marketplace_listing_likes;
CREATE POLICY "Public read listing likes" ON public.marketplace_listing_likes
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users like listings" ON public.marketplace_listing_likes;
CREATE POLICY "Authenticated users like listings" ON public.marketplace_listing_likes
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users remove own listing likes" ON public.marketplace_listing_likes;
CREATE POLICY "Users remove own listing likes" ON public.marketplace_listing_likes
FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 10. RLS Policies: Trades
DROP POLICY IF EXISTS "Public read open trades" ON public.marketplace_trades;
CREATE POLICY "Public read open trades" ON public.marketplace_trades
FOR SELECT USING (status = 'open' AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Traders manage own trades" ON public.marketplace_trades;
CREATE POLICY "Traders manage own trades" ON public.marketplace_trades
FOR ALL TO authenticated
USING (trader_id = auth.uid())
WITH CHECK (trader_id = auth.uid());

-- 11. RLS Policies: Trade Likes
DROP POLICY IF EXISTS "Public read trade likes" ON public.marketplace_trade_likes;
CREATE POLICY "Public read trade likes" ON public.marketplace_trade_likes
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users like trades" ON public.marketplace_trade_likes;
CREATE POLICY "Authenticated users like trades" ON public.marketplace_trade_likes
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users remove own trade likes" ON public.marketplace_trade_likes;
CREATE POLICY "Users remove own trade likes" ON public.marketplace_trade_likes
FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 12. RLS Policies: Saves Compatibility
DROP POLICY IF EXISTS "Users view own listing saves" ON public.marketplace_listing_saves;
CREATE POLICY "Users view own listing saves" ON public.marketplace_listing_saves
FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own listing saves" ON public.marketplace_listing_saves;
CREATE POLICY "Users insert own listing saves" ON public.marketplace_listing_saves
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own listing saves" ON public.marketplace_listing_saves;
CREATE POLICY "Users delete own listing saves" ON public.marketplace_listing_saves
FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own trade saves" ON public.marketplace_trade_saves;
CREATE POLICY "Users view own trade saves" ON public.marketplace_trade_saves
FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own trade saves" ON public.marketplace_trade_saves;
CREATE POLICY "Users insert own trade saves" ON public.marketplace_trade_saves
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own trade saves" ON public.marketplace_trade_saves;
CREATE POLICY "Users delete own trade saves" ON public.marketplace_trade_saves
FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 13. Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
