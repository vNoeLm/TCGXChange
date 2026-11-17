-- Add One Piece TCG & multi-game metadata fields to public.cards
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attribute VARCHAR(100),
  ADD COLUMN IF NOT EXISTS counter INTEGER,
  ADD COLUMN IF NOT EXISTS block_icon VARCHAR(16),
  ADD COLUMN IF NOT EXISTS illustration_type VARCHAR(60),
  ADD COLUMN IF NOT EXISTS is_reprint BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cards_onepiece_attribute
  ON public.cards (attribute)
  WHERE game = 'onepiece';

CREATE INDEX IF NOT EXISTS idx_cards_onepiece_counter
  ON public.cards (counter)
  WHERE game = 'onepiece';

CREATE INDEX IF NOT EXISTS idx_cards_onepiece_block_icon
  ON public.cards (block_icon)
  WHERE game = 'onepiece';

CREATE INDEX IF NOT EXISTS idx_cards_onepiece_illustration_type
  ON public.cards (illustration_type)
  WHERE game = 'onepiece';
