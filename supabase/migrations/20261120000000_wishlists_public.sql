-- Add public visibility option to wishlists so users can showcase wanted cards on their profile
ALTER TABLE public.wishlists
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Public wishlists are readable by anyone" ON public.wishlists;
CREATE POLICY "Public wishlists are readable by anyone"
  ON public.wishlists FOR SELECT
  USING (is_public = true);
