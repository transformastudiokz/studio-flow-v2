create or replace function public.get_trainer_home_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  total_sessions bigint,
  total_clients bigint,
  total_stars bigint
)
language sql
security definer
set search_path = public
as $$
  with conducted as (
    select ss.id
    from public.schedule_sessions ss
    join public.coaches c on c.id = ss.coach_id and c.user_id = auth.uid()
    join public.profiles p on p.id = auth.uid() and p.role = 'trainer' and p.is_active is not false
    where ss.start_time >= p_from
      and ss.start_time <= p_to
      and ss.end_time <= now()
      and ss.booking_status <> 'cancelled'
      and not coalesce(ss.is_cancelled, false)
  ),
  booking_history as (
    select
      b.id,
      b.session_id,
      b.status,
      row_number() over (partition by b.user_id order by b.created_at, b.id) as booking_number
    from public.bookings b
  ),
  crm as (
    select
      count(*) filter (where bh.status = 'completed') as attended,
      count(*) filter (where bh.status not in ('cancelled', 'late_cancel') and bh.booking_number = 1) as stars
    from booking_history bh
    join conducted cs on cs.id = bh.session_id
  ),
  onefit as (
    select count(*) as attended
    from public.onefit_bookings ob
    join conducted cs on cs.id = ob.session_id
    where ob.is_active = true and ob.source_status = 'confirmed'
  )
  select
    (select count(*) from conducted),
    coalesce(crm.attended, 0) + coalesce(onefit.attended, 0),
    coalesce(crm.stars, 0)
  from crm cross join onefit;
$$;

revoke all on function public.get_trainer_home_metrics(timestamptz, timestamptz) from public;
grant execute on function public.get_trainer_home_metrics(timestamptz, timestamptz) to authenticated;
