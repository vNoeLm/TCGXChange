-- Drop legacy 1-per-pair unique index so (LEAST(buyer_id, seller_id), GREATEST(buyer_id, seller_id), channel_type) applies cleanly.
DROP INDEX IF EXISTS public.conversations_pair_key;
DROP INDEX IF EXISTS idx_conversations_pair;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair_channel ON public.conversations(
  LEAST(buyer_id, seller_id),
  GREATEST(buyer_id, seller_id),
  channel_type
);
