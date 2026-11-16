-- Fix Radiance (RAD) release date overwritten by sync_radiance_cards.mjs
UPDATE public.sets
SET release_date = '2026-10-23'
WHERE code = 'RAD' AND game = 'riftbound';
