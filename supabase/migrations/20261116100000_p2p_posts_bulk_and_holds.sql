-- ==============================================================================
-- Migration: 20261116100000_p2p_posts_bulk_and_holds.sql
-- Description: Facebook-style P2P Marketplace Posts (Photo Posts + Card Tagging,
--              Bulk Lots), Post Likes (= Saved Bookmarks), Store vs. P2P
--              Conversation Separation, and Atomic Hold Reservation RPCs.
-- ==============================================================================

-- 1. Separate Store Support conversations from P2P Buyer/Seller conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS channel_type VARCHAR(20) NOT NULL DEFAULT 'p2p';

-- Existing conversations created during Store Support era default to store_support
UPDATE public.conversations
SET channel_type = 'store_support'
WHERE channel_type = 'p2p';

DROP INDEX IF EXISTS public.conversations_pair_key;
DROP INDEX IF EXISTS idx_conversations_pair;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair_channel ON public.conversations(
  LEAST(buyer_id, seller_id),
  GREATEST(buyer_id, seller_id),
  channel_type
);

CREATE INDEX IF NOT EXISTS idx_conversations_channel_type ON public.conversations(channel_type);

-- 2. Marketplace Photo Posts & Bulk Lots (Sell X for Y Price, No Swap Barter)
CREATE TABLE IF NOT EXISTS public.marketplace_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_type VARCHAR(20) NOT NULL DEFAULT 'photo_post' CHECK (post_type IN ('photo_post', 'bulk')),
  title VARCHAR(180),
  body TEXT NOT NULL DEFAULT '',
  lot_price_huf INTEGER CHECK (lot_price_huf IS NULL OR lot_price_huf >= 0),
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'held', 'sold_out', 'closed')),
  likes_count INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_mkt_posts_seller ON public.marketplace_posts(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_posts_type ON public.marketplace_posts(post_type);
CREATE INDEX IF NOT EXISTS idx_mkt_posts_status ON public.marketplace_posts(status);
CREATE INDEX IF NOT EXISTS idx_mkt_posts_created ON public.marketplace_posts(created_at DESC);

-- 3. Cards Tagged Inside Photo Posts & Highlighted Inside Bulk Lots
CREATE TABLE IF NOT EXISTS public.marketplace_post_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.marketplace_posts(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  is_highlight_only BOOLEAN NOT NULL DEFAULT false,
  condition VARCHAR(50) NOT NULL DEFAULT 'Near Mint',
  is_foil BOOLEAN NOT NULL DEFAULT false,
  price_huf INTEGER CHECK (price_huf IS NULL OR price_huf >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  held_quantity INTEGER NOT NULL DEFAULT 0 CHECK (held_quantity >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'sold')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mkt_post_cards_post ON public.marketplace_post_cards(post_id);
CREATE INDEX IF NOT EXISTS idx_mkt_post_cards_card ON public.marketplace_post_cards(card_id);
CREATE INDEX IF NOT EXISTS idx_mkt_post_cards_status ON public.marketplace_post_cards(status);

-- 4. Post Likes (= Saved Bookmarks for Photo Posts & Bulk Lots)
CREATE TABLE IF NOT EXISTS public.marketplace_post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.marketplace_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_mkt_post_user_like UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_post_likes_post ON public.marketplace_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_mkt_post_likes_user ON public.marketplace_post_likes(user_id);

CREATE OR REPLACE FUNCTION public.handle_marketplace_post_like()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  actual_count INTEGER;
BEGIN
  target_id := COALESCE(NEW.post_id, OLD.post_id);
  SELECT COUNT(*) INTO actual_count FROM public.marketplace_post_likes WHERE post_id = target_id;
  UPDATE public.marketplace_posts
  SET likes_count = actual_count
  WHERE id = target_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_marketplace_post_like ON public.marketplace_post_likes;
CREATE TRIGGER trg_marketplace_post_like
AFTER INSERT OR DELETE ON public.marketplace_post_likes
FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_post_like();

-- 5. Extend hold_requests to reference Photo Posts / Bulk Lots cleanly without requiring shipping forms
ALTER TABLE public.hold_requests
  DROP CONSTRAINT IF EXISTS hold_requests_inventory_id_fkey;

ALTER TABLE public.hold_requests
  ALTER COLUMN inventory_id DROP NOT NULL,
  ALTER COLUMN preferred_handover SET DEFAULT 'chat';

ALTER TABLE public.hold_requests
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES public.marketplace_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS order_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_hold_requests_post ON public.hold_requests(post_id);
CREATE INDEX IF NOT EXISTS idx_hold_requests_order_number ON public.hold_requests(order_number);

-- Also ensure user_reviews can reference hold_request_id for 1-review-per-party-per-hold verification
ALTER TABLE public.user_reviews
  ADD COLUMN IF NOT EXISTS hold_request_id UUID REFERENCES public.hold_requests(id) ON DELETE SET NULL,
  ALTER COLUMN order_number DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reviews_hold_direction
  ON public.user_reviews(hold_request_id, reviewer_id, direction)
  WHERE hold_request_id IS NOT NULL;

-- 6. RLS Policies
ALTER TABLE public.marketplace_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active marketplace posts" ON public.marketplace_posts;
CREATE POLICY "Public read active marketplace posts" ON public.marketplace_posts
  FOR SELECT USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "Sellers manage own marketplace posts" ON public.marketplace_posts;
CREATE POLICY "Sellers manage own marketplace posts" ON public.marketplace_posts
  FOR ALL TO authenticated
  USING (auth.uid() = seller_id OR public.is_admin_or_owner())
  WITH CHECK (auth.uid() = seller_id OR public.is_admin_or_owner());

ALTER TABLE public.marketplace_post_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active marketplace post cards" ON public.marketplace_post_cards;
CREATE POLICY "Public read active marketplace post cards" ON public.marketplace_post_cards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.marketplace_posts p
      WHERE p.id = marketplace_post_cards.post_id AND p.deleted_at IS NULL
    )
  );
DROP POLICY IF EXISTS "Sellers manage own marketplace post cards" ON public.marketplace_post_cards;
CREATE POLICY "Sellers manage own marketplace post cards" ON public.marketplace_post_cards
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketplace_posts p
      WHERE p.id = marketplace_post_cards.post_id
        AND (p.seller_id = auth.uid() OR public.is_admin_or_owner())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketplace_posts p
      WHERE p.id = marketplace_post_cards.post_id
        AND (p.seller_id = auth.uid() OR public.is_admin_or_owner())
    )
  );

ALTER TABLE public.marketplace_post_likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read marketplace post likes" ON public.marketplace_post_likes;
CREATE POLICY "Users read marketplace post likes" ON public.marketplace_post_likes
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users manage own marketplace post likes" ON public.marketplace_post_likes;
CREATE POLICY "Users manage own marketplace post likes" ON public.marketplace_post_likes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 7. Atomic Hold Reservation RPCs (row-locked stock reservation)
CREATE OR REPLACE FUNCTION public.rpc_accept_hold_request(p_request_id UUID, p_actor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.hold_requests%ROWTYPE;
  v_item JSONB;
  v_listing_id UUID;
  v_post_card_id UUID;
  v_qty INTEGER;
  v_listing RECORD;
  v_post_card RECORD;
  v_post RECORD;
BEGIN
  SELECT * INTO v_req FROM public.hold_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hold request not found.');
  END IF;
  IF v_req.seller_id <> p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden: only the seller can accept.');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hold request is no longer pending.');
  END IF;

  -- Bulk lot post hold
  IF v_req.post_id IS NOT NULL AND (v_req.items IS NULL OR jsonb_array_length(v_req.items) = 0) THEN
    SELECT * INTO v_post FROM public.marketplace_posts WHERE id = v_req.post_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_post.status <> 'open' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Bulk lot is no longer available.');
    END IF;
    UPDATE public.marketplace_posts SET status = 'held', updated_at = timezone('utc'::text, now()) WHERE id = v_req.post_id;
  ELSIF v_req.items IS NOT NULL AND jsonb_array_length(v_req.items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_req.items) LOOP
      v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::INTEGER, 1));
      IF v_item ? 'listing_id' AND NULLIF(v_item->>'listing_id', '') IS NOT NULL THEN
        v_listing_id := (v_item->>'listing_id')::UUID;
        SELECT * INTO v_listing FROM public.marketplace_listings WHERE id = v_listing_id AND deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND OR v_listing.quantity < v_qty THEN
          RAISE EXCEPTION 'Insufficient quantity on listing %', v_listing_id;
        END IF;
        UPDATE public.marketplace_listings
        SET quantity = quantity - v_qty,
            status = CASE WHEN (quantity - v_qty) <= 0 THEN 'Held' ELSE status END,
            updated_at = timezone('utc'::text, now())
        WHERE id = v_listing_id;
      ELSIF v_item ? 'post_card_id' AND NULLIF(v_item->>'post_card_id', '') IS NOT NULL THEN
        v_post_card_id := (v_item->>'post_card_id')::UUID;
        SELECT * INTO v_post_card FROM public.marketplace_post_cards WHERE id = v_post_card_id FOR UPDATE;
        IF NOT FOUND OR v_post_card.is_highlight_only OR (v_post_card.quantity - v_post_card.held_quantity) < v_qty THEN
          RAISE EXCEPTION 'Insufficient quantity on post card %', v_post_card_id;
        END IF;
        UPDATE public.marketplace_post_cards
        SET held_quantity = held_quantity + v_qty,
            status = CASE WHEN (held_quantity + v_qty) >= quantity THEN 'held' ELSE 'available' END
        WHERE id = v_post_card_id;
      END IF;
    END LOOP;
  ELSIF v_req.listing_id IS NOT NULL THEN
    v_qty := GREATEST(1, COALESCE(v_req.quantity, 1));
    SELECT * INTO v_listing FROM public.marketplace_listings WHERE id = v_req.listing_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_listing.quantity < v_qty THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Listing does not have enough available copies.');
    END IF;
    UPDATE public.marketplace_listings
    SET quantity = quantity - v_qty,
        status = CASE WHEN (quantity - v_qty) <= 0 THEN 'Held' ELSE status END,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_req.listing_id;
  END IF;

  UPDATE public.hold_requests
  SET status = 'accepted',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'status', 'accepted');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_release_hold_request(p_request_id UUID, p_actor_id UUID, p_next_status TEXT DEFAULT 'cancelled')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.hold_requests%ROWTYPE;
  v_item JSONB;
  v_listing_id UUID;
  v_post_card_id UUID;
  v_qty INTEGER;
  v_was_reserved BOOLEAN;
BEGIN
  IF p_next_status NOT IN ('cancelled', 'declined', 'released') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid release status.');
  END IF;

  SELECT * INTO v_req FROM public.hold_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hold request not found.');
  END IF;

  IF p_actor_id <> v_req.seller_id AND p_actor_id <> v_req.buyer_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden.');
  END IF;
  IF p_next_status IN ('declined', 'released') AND p_actor_id <> v_req.seller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only the seller can decline or release a hold.');
  END IF;
  IF v_req.status NOT IN ('pending', 'accepted', 'handed_over') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hold cannot be released from current status.');
  END IF;

  v_was_reserved := v_req.status IN ('accepted', 'handed_over');

  IF v_was_reserved THEN
    IF v_req.post_id IS NOT NULL AND (v_req.items IS NULL OR jsonb_array_length(v_req.items) = 0) THEN
      UPDATE public.marketplace_posts
      SET status = CASE WHEN status = 'held' THEN 'open' ELSE status END,
          updated_at = timezone('utc'::text, now())
      WHERE id = v_req.post_id;
    ELSIF v_req.items IS NOT NULL AND jsonb_array_length(v_req.items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_req.items) LOOP
        v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::INTEGER, 1));
        IF v_item ? 'listing_id' AND NULLIF(v_item->>'listing_id', '') IS NOT NULL THEN
          v_listing_id := (v_item->>'listing_id')::UUID;
          UPDATE public.marketplace_listings
          SET quantity = quantity + v_qty,
              status = 'In Stock',
              updated_at = timezone('utc'::text, now())
          WHERE id = v_listing_id;
        ELSIF v_item ? 'post_card_id' AND NULLIF(v_item->>'post_card_id', '') IS NOT NULL THEN
          v_post_card_id := (v_item->>'post_card_id')::UUID;
          UPDATE public.marketplace_post_cards
          SET held_quantity = GREATEST(0, held_quantity - v_qty),
              status = CASE WHEN GREATEST(0, held_quantity - v_qty) < quantity AND status <> 'sold' THEN 'available' ELSE status END
          WHERE id = v_post_card_id;
        END IF;
      END LOOP;
    ELSIF v_req.listing_id IS NOT NULL THEN
      v_qty := GREATEST(1, COALESCE(v_req.quantity, 1));
      UPDATE public.marketplace_listings
      SET quantity = quantity + v_qty,
          status = 'In Stock',
          updated_at = timezone('utc'::text, now())
      WHERE id = v_req.listing_id;
    END IF;
  END IF;

  UPDATE public.hold_requests
  SET status = p_next_status,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'status', p_next_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_complete_hold_request(p_request_id UUID, p_actor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.hold_requests%ROWTYPE;
  v_item JSONB;
  v_post_card_id UUID;
  v_qty INTEGER;
  v_post_id UUID;
BEGIN
  SELECT * INTO v_req FROM public.hold_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hold request not found.');
  END IF;
  IF p_actor_id <> v_req.buyer_id AND p_actor_id <> v_req.seller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden.');
  END IF;
  IF v_req.status NOT IN ('accepted', 'handed_over') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hold must be accepted or handed over to complete.');
  END IF;

  -- Buyer may confirm anytime after accept/handover; seller may confirm after handover (14d safeguard checked in API)
  IF p_actor_id = v_req.seller_id AND v_req.status <> 'handed_over' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mark handed over first before seller completion.');
  END IF;

  IF v_req.post_id IS NOT NULL AND (v_req.items IS NULL OR jsonb_array_length(v_req.items) = 0) THEN
    UPDATE public.marketplace_posts SET status = 'sold_out', updated_at = timezone('utc'::text, now()) WHERE id = v_req.post_id;
  ELSIF v_req.items IS NOT NULL AND jsonb_array_length(v_req.items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_req.items) LOOP
      v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::INTEGER, 1));
      IF v_item ? 'post_card_id' AND NULLIF(v_item->>'post_card_id', '') IS NOT NULL THEN
        v_post_card_id := (v_item->>'post_card_id')::UUID;
        UPDATE public.marketplace_post_cards
        SET quantity = GREATEST(0, quantity - v_qty),
            held_quantity = GREATEST(0, held_quantity - v_qty),
            status = CASE
              WHEN GREATEST(0, quantity - v_qty) = 0 THEN 'sold'
              WHEN GREATEST(0, held_quantity - v_qty) >= GREATEST(0, quantity - v_qty) THEN 'held'
              ELSE 'available'
            END
        WHERE id = v_post_card_id
        RETURNING post_id INTO v_post_id;

        IF v_post_id IS NOT NULL THEN
          UPDATE public.marketplace_posts p
          SET status = CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM public.marketplace_post_cards c
              WHERE c.post_id = p.id AND c.is_highlight_only = false AND c.quantity > 0
            ) THEN 'sold_out'
            ELSE p.status
          END,
          updated_at = timezone('utc'::text, now())
          WHERE p.id = v_post_id;
        END IF;
      ELSIF v_item ? 'listing_id' AND NULLIF(v_item->>'listing_id', '') IS NOT NULL THEN
        UPDATE public.marketplace_listings
        SET status = CASE WHEN quantity <= 0 THEN 'Sold Out' ELSE 'In Stock' END,
            updated_at = timezone('utc'::text, now())
        WHERE id = (v_item->>'listing_id')::UUID;
      END IF;
    END LOOP;
  ELSIF v_req.listing_id IS NOT NULL THEN
    UPDATE public.marketplace_listings
    SET status = CASE WHEN quantity <= 0 THEN 'Sold Out' ELSE 'In Stock' END,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_req.listing_id;
  END IF;

  UPDATE public.hold_requests
  SET status = 'completed',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'status', 'completed');
END;
$$;

-- Best-effort Realtime publication registration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_posts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_post_cards;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
