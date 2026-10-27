-- ==============================================================================
-- Migration: ban enforcement
--
-- A ban used to be a flag on public.profiles that nothing read. This makes it real at the
-- database level too: a suspended account keeps read access to the catalog, cards, sets and the
-- official store, but loses the marketplace, the seller hub and messages. The pages and APIs
-- enforce the same rule (AccountAccessGate, middleware); these policies close the direct
-- Supabase route.
--
-- Run once in the Supabase SQL editor.
-- ==============================================================================

-- Reads profiles as its owner, so a policy on profiles cannot recurse into itself.
CREATE OR REPLACE FUNCTION public.is_active_account()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT NOT is_banned FROM public.profiles WHERE id = auth.uid()), false);
$$;

REVOKE ALL ON FUNCTION public.is_active_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_account() TO authenticated;

-- ------------------------------------------------------------------------------
-- Marketplace listings: sellers manage their own only while not suspended.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Sellers insert own marketplace listings" ON public.marketplace_listings;
CREATE POLICY "Sellers insert own marketplace listings" ON public.marketplace_listings
FOR INSERT TO authenticated
WITH CHECK ((seller_id = auth.uid() AND public.is_active_account()) OR public.is_admin_or_owner());

DROP POLICY IF EXISTS "Sellers update own marketplace listings" ON public.marketplace_listings;
CREATE POLICY "Sellers update own marketplace listings" ON public.marketplace_listings
FOR UPDATE TO authenticated
USING ((seller_id = auth.uid() AND public.is_active_account()) OR public.is_admin_or_owner())
WITH CHECK ((seller_id = auth.uid() AND public.is_active_account()) OR public.is_admin_or_owner());

DROP POLICY IF EXISTS "Sellers delete own marketplace listings" ON public.marketplace_listings;
CREATE POLICY "Sellers delete own marketplace listings" ON public.marketplace_listings
FOR DELETE TO authenticated
USING ((seller_id = auth.uid() AND public.is_active_account()) OR public.is_admin_or_owner());

-- ------------------------------------------------------------------------------
-- Likes & saves
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users like listings" ON public.marketplace_listing_likes;
CREATE POLICY "Authenticated users like listings" ON public.marketplace_listing_likes
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_active_account());

DROP POLICY IF EXISTS "Users remove own listing likes" ON public.marketplace_listing_likes;
CREATE POLICY "Users remove own listing likes" ON public.marketplace_listing_likes
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND public.is_active_account());

DROP POLICY IF EXISTS "Authenticated users like trades" ON public.marketplace_trade_likes;
CREATE POLICY "Authenticated users like trades" ON public.marketplace_trade_likes
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_active_account());

DROP POLICY IF EXISTS "Users remove own trade likes" ON public.marketplace_trade_likes;
CREATE POLICY "Users remove own trade likes" ON public.marketplace_trade_likes
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND public.is_active_account());

DROP POLICY IF EXISTS "Users insert own listing saves" ON public.marketplace_listing_saves;
CREATE POLICY "Users insert own listing saves" ON public.marketplace_listing_saves
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_active_account());

DROP POLICY IF EXISTS "Users delete own listing saves" ON public.marketplace_listing_saves;
CREATE POLICY "Users delete own listing saves" ON public.marketplace_listing_saves
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND public.is_active_account());

DROP POLICY IF EXISTS "Users insert own trade saves" ON public.marketplace_trade_saves;
CREATE POLICY "Users insert own trade saves" ON public.marketplace_trade_saves
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_active_account());

DROP POLICY IF EXISTS "Users delete own trade saves" ON public.marketplace_trade_saves;
CREATE POLICY "Users delete own trade saves" ON public.marketplace_trade_saves
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND public.is_active_account());

-- ------------------------------------------------------------------------------
-- Trades
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Traders manage own trades" ON public.marketplace_trades;
CREATE POLICY "Traders manage own trades" ON public.marketplace_trades
FOR ALL TO authenticated
USING ((trader_id = auth.uid() AND public.is_active_account()) OR public.is_admin_or_owner())
WITH CHECK ((trader_id = auth.uid() AND public.is_active_account()) OR public.is_admin_or_owner());

-- ------------------------------------------------------------------------------
-- Hold requests: participants only, and only while active.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants view hold requests" ON public.hold_requests;
CREATE POLICY "Participants view hold requests" ON public.hold_requests
FOR SELECT TO authenticated
USING (
  ((auth.uid() = buyer_id OR auth.uid() = seller_id) AND public.is_active_account())
  OR public.is_admin_or_owner()
);

DROP POLICY IF EXISTS "Buyers can insert hold request" ON public.hold_requests;
CREATE POLICY "Buyers can insert hold request" ON public.hold_requests
FOR INSERT TO authenticated
WITH CHECK (
  (auth.uid() = buyer_id AND public.is_active_account())
  OR public.is_admin_or_owner()
);

DROP POLICY IF EXISTS "Participants update hold requests" ON public.hold_requests;
CREATE POLICY "Participants update hold requests" ON public.hold_requests
FOR UPDATE TO authenticated
USING (
  ((auth.uid() = buyer_id OR auth.uid() = seller_id) AND public.is_active_account())
  OR public.is_admin_or_owner()
)
WITH CHECK (
  ((auth.uid() = buyer_id OR auth.uid() = seller_id) AND public.is_active_account())
  OR public.is_admin_or_owner()
);

DROP POLICY IF EXISTS "Participants delete hold requests" ON public.hold_requests;
CREATE POLICY "Participants delete hold requests" ON public.hold_requests
FOR DELETE TO authenticated
USING (
  ((auth.uid() = buyer_id OR auth.uid() = seller_id) AND public.is_active_account())
  OR public.is_admin_or_owner()
);

-- ------------------------------------------------------------------------------
-- Conversations & messages: no access at all while suspended.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants access conversations" ON public.conversations;
CREATE POLICY "Participants access conversations" ON public.conversations
FOR ALL TO authenticated
USING (
  ((auth.uid() = buyer_id OR auth.uid() = seller_id) AND public.is_active_account())
  OR public.is_admin_or_owner()
)
WITH CHECK (
  ((auth.uid() = buyer_id OR auth.uid() = seller_id) AND public.is_active_account())
  OR public.is_admin_or_owner()
);

DROP POLICY IF EXISTS "Participants read messages" ON public.hold_request_messages;
CREATE POLICY "Participants read messages" ON public.hold_request_messages
FOR SELECT TO authenticated
USING (
  (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = hold_request_messages.conversation_id
        AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
    )
    AND public.is_active_account()
  )
  OR public.is_admin_or_owner()
);

DROP POLICY IF EXISTS "Participants send messages" ON public.hold_request_messages;
CREATE POLICY "Participants send messages" ON public.hold_request_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_active_account()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = hold_request_messages.conversation_id
      AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Participants can mark messages read" ON public.hold_request_messages;
CREATE POLICY "Participants can mark messages read" ON public.hold_request_messages
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = hold_request_messages.conversation_id
      AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
  )
  AND public.is_active_account()
);

-- ------------------------------------------------------------------------------
-- Seller shipping (seller hub)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Sellers insert own shipping options" ON public.seller_shipping;
CREATE POLICY "Sellers insert own shipping options" ON public.seller_shipping
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = seller_id AND public.is_active_account());

DROP POLICY IF EXISTS "Sellers update own shipping options" ON public.seller_shipping;
CREATE POLICY "Sellers update own shipping options" ON public.seller_shipping
FOR UPDATE TO authenticated
USING (auth.uid() = seller_id AND public.is_active_account())
WITH CHECK (auth.uid() = seller_id AND public.is_active_account());

-- ------------------------------------------------------------------------------
-- Reviews (the server writes them; this is the direct route)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users create own reviews" ON public.user_reviews;
CREATE POLICY "Users create own reviews" ON public.user_reviews
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = reviewer_id
  AND reviewer_id <> reviewee_id
  AND public.is_active_account()
);
