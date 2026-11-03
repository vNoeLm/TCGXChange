-- Support sharing and public visibility for collections
ALTER TABLE public.card_collections
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Index for public collections lookup
CREATE INDEX IF NOT EXISTS idx_card_collections_public ON public.card_collections(user_id, is_public);
