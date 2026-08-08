-- Триггер должен иметь право обновить остаток даже когда запись создаёт
-- клиент под собственной RLS-сессией. Прямой вызов функции закрыт.
alter function public.recalc_visits_remaining() security definer;
alter function public.recalc_visits_remaining() set search_path = public;
revoke all on function public.recalc_visits_remaining() from public;
