create or replace function public.get_trainer_schedule_v2(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  start_time timestamptz,
  end_time timestamptz,
  capacity integer,
  room text,
  booking_status text,
  booking_closed_reason text,
  class_name text,
  class_color text,
  coach_name text,
  crm_booked_count bigint,
  onefit_count bigint,
  booked_count bigint,
  first_booking_count bigint,
  repeat_booking_count bigint,
  completed_count bigint
)
language sql
security definer
set search_path = public
as $$
  with trainer_sessions as (
    select ss.*, ct.name as resolved_class_name, ct.color as resolved_class_color, c.name as resolved_coach_name
    from public.schedule_sessions ss
    join public.coaches c on c.id = ss.coach_id and c.user_id = auth.uid()
    join public.class_types ct on ct.id = ss.class_type_id
    join public.profiles p on p.id = auth.uid() and p.role = 'trainer' and p.is_active is not false
    where ss.start_time >= p_from and ss.start_time <= p_to
  ),
  booking_history as (
    select
      b.id,
      b.session_id,
      b.user_id,
      b.status,
      row_number() over (partition by b.user_id order by b.created_at, b.id) as booking_number,
      bool_or(b.status = 'completed') over (partition by b.user_id) as has_completed_visit
    from public.bookings b
    where b.user_id in (
      select distinct b2.user_id
      from public.bookings b2
      join trainer_sessions ts on ts.id = b2.session_id
    )
  ),
  booking_totals as (
    select
      bh.session_id,
      count(*) filter (where bh.status not in ('cancelled', 'late_cancel', 'absent')) as crm_booked_count,
      count(*) filter (where bh.status = 'completed') as completed_count,
      count(*) filter (where bh.status not in ('cancelled', 'late_cancel') and bh.booking_number = 1) as first_booking_count,
      count(*) filter (where bh.status not in ('cancelled', 'late_cancel') and bh.booking_number > 1 and not bh.has_completed_visit) as repeat_booking_count
    from booking_history bh
    group by bh.session_id
  ),
  onefit_totals as (
    select ob.session_id, count(*) as onefit_count
    from public.onefit_bookings ob
    join trainer_sessions ts on ts.id = ob.session_id
    where ob.is_active = true
    group by ob.session_id
  )
  select
    ts.id,
    ts.start_time,
    ts.end_time,
    ts.capacity,
    ts.room,
    ts.booking_status,
    ts.booking_closed_reason,
    ts.resolved_class_name,
    ts.resolved_class_color,
    ts.resolved_coach_name,
    coalesce(bt.crm_booked_count, 0),
    coalesce(ot.onefit_count, 0),
    coalesce(bt.crm_booked_count, 0) + coalesce(ot.onefit_count, 0),
    coalesce(bt.first_booking_count, 0),
    coalesce(bt.repeat_booking_count, 0),
    coalesce(bt.completed_count, 0)
  from trainer_sessions ts
  left join booking_totals bt on bt.session_id = ts.id
  left join onefit_totals ot on ot.session_id = ts.id
  order by ts.start_time;
$$;

revoke all on function public.get_trainer_schedule_v2(timestamptz, timestamptz) from public;
grant execute on function public.get_trainer_schedule_v2(timestamptz, timestamptz) to authenticated;
