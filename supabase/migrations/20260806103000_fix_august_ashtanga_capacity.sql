-- Align the August Ashtanga sessions with the capacity configured in the
-- studio schedule. Trainer views read this same schedule_sessions value.
update public.schedule_sessions
set capacity = 10
where start_time >= timestamptz '2026-08-01 00:00:00+05'
  and start_time < timestamptz '2026-09-01 00:00:00+05'
  and class_type_id in (
    select id
    from public.class_types
    where name = 'Йога Аштанга'
  )
  and capacity = 5;
