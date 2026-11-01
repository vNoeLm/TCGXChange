-- Enable Supabase Realtime postgres_changes publication for messaging, holds, and order notices.
-- Note: Application code also uses Supabase Realtime Broadcast so real-time updates work
-- immediately even before this migration is applied; client event deduplication handles both cleanly.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.hold_request_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.hold_requests;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
