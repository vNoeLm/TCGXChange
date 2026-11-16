-- Drop legacy 1-per-pair unique constraint & index so a user pair can have both
-- a 'store_support' conversation and a separate 'p2p' Marketplace conversation.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_buyer_id_seller_id_key;

DROP INDEX IF EXISTS public.conversations_pair_key;
DROP INDEX IF EXISTS public.idx_conversations_pair;
DROP INDEX IF EXISTS conversations_pair_key;
DROP INDEX IF EXISTS idx_conversations_pair;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair_channel ON public.conversations(
  LEAST(buyer_id, seller_id),
  GREATEST(buyer_id, seller_id),
  channel_type
);
