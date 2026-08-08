create or replace function public.get_client_onefit_counts(p_session_ids uuid[])
returns table(session_id uuid, bookings_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    ss.id as session_id,
    count(ob.id)::bigint as bookings_count
  from public.schedule_sessions ss
  left join public.onefit_bookings ob
    on ob.session_id = ss.id
   and ob.is_active = true
  where auth.uid() is not null
    and ss.is_client_visible = true
    and ss.id = any(coalesce(p_session_ids, array[]::uuid[]))
  group by ss.id;
$$;

revoke all on function public.get_client_onefit_counts(uuid[]) from public;
grant execute on function public.get_client_onefit_counts(uuid[]) to authenticated;
