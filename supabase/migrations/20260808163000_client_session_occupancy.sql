drop function if exists public.get_client_onefit_counts(uuid[]);

create function public.get_client_onefit_counts(p_session_ids uuid[])
returns table(
  session_id uuid,
  crm_bookings_count bigint,
  onefit_bookings_count bigint,
  occupied_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with requested_sessions as (
    select ss.id
    from public.schedule_sessions ss
    where auth.uid() is not null
      and ss.is_client_visible = true
      and ss.id = any(coalesce(p_session_ids, array[]::uuid[]))
  ),
  crm as (
    select b.session_id, count(*)::bigint as bookings_count
    from public.bookings b
    join requested_sessions rs on rs.id = b.session_id
    where b.status in ('booked', 'completed')
    group by b.session_id
  ),
  onefit as (
    select ob.session_id, count(*)::bigint as bookings_count
    from public.onefit_bookings ob
    join requested_sessions rs on rs.id = ob.session_id
    where ob.is_active = true
    group by ob.session_id
  )
  select
    rs.id,
    coalesce(crm.bookings_count, 0),
    coalesce(onefit.bookings_count, 0),
    coalesce(crm.bookings_count, 0) + coalesce(onefit.bookings_count, 0)
  from requested_sessions rs
  left join crm on crm.session_id = rs.id
  left join onefit on onefit.session_id = rs.id;
$$;

revoke all on function public.get_client_onefit_counts(uuid[]) from public;
grant execute on function public.get_client_onefit_counts(uuid[]) to authenticated;
