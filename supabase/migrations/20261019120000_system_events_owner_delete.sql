-- =========================================================================
-- SYSTEM LOGS — właściciel może wyczyścić własny dziennik zdarzeń.
--
-- Przycisk „Wyczyść logi” na /system-logs (z potwierdzeniem). Do tej pory
-- authenticated miał tylko SELECT/INSERT, więc log rósł bez końca. Czyści
-- wyłącznie własne wiersze (owner_id = auth.uid()); nic w aplikacji nie
-- zależy od starej historii — brief i alarmy patrzą najwyżej dobę wstecz.
-- =========================================================================

GRANT DELETE ON public.system_events TO authenticated;

DROP POLICY IF EXISTS "system_events_owner_delete" ON public.system_events;
CREATE POLICY "system_events_owner_delete" ON public.system_events
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);
