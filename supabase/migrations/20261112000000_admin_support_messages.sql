-- Migration: Allow all admins access to support messages and update status
-- Ensures messages are not tied to a single admin account and can be handled by any admin/owner.

DROP POLICY IF EXISTS "Participants send messages" ON public.hold_request_messages;
CREATE POLICY "Participants send messages" ON public.hold_request_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_active_account()
  AND (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = hold_request_messages.conversation_id
        AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
    )
    OR public.is_admin_or_owner()
  )
);

DROP POLICY IF EXISTS "Participants can mark messages read" ON public.hold_request_messages;
CREATE POLICY "Participants can mark messages read" ON public.hold_request_messages
FOR UPDATE TO authenticated
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
