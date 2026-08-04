-- Make the second overlapping session atomically fall back to the small room.
create or replace function public.enforce_schedule_session_conflicts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  conflicting public.schedule_sessions%rowtype;
begin
  if new.end_time <= new.start_time then
    raise exception 'Время окончания должно быть позже начала';
  end if;

  if new.booking_status = 'cancelled' or coalesce(new.is_cancelled, false) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('balance_schedule_conflicts')::bigint);

  select * into conflicting
  from public.schedule_sessions existing
  where existing.id <> new.id
    and existing.booking_status <> 'cancelled'
    and not coalesce(existing.is_cancelled, false)
    and existing.start_time < new.end_time
    and existing.end_time > new.start_time
    and existing.room = new.room
  limit 1;

  if found then
    if new.room = 'Большой зал' and not exists (
      select 1 from public.schedule_sessions small_room
      where small_room.id <> new.id
        and small_room.booking_status <> 'cancelled'
        and not coalesce(small_room.is_cancelled, false)
        and small_room.start_time < new.end_time
        and small_room.end_time > new.start_time
        and small_room.room = 'Малый зал'
    ) then
      new.room := 'Малый зал';
    else
      raise exception 'Все доступные залы уже заняты в это время (% – %)',
        to_char(conflicting.start_time at time zone 'Asia/Almaty', 'HH24:MI'),
        to_char(conflicting.end_time at time zone 'Asia/Almaty', 'HH24:MI');
    end if;
  end if;

  if new.coach_id is not null then
    select * into conflicting
    from public.schedule_sessions existing
    where existing.id <> new.id
      and existing.booking_status <> 'cancelled'
      and not coalesce(existing.is_cancelled, false)
      and existing.start_time < new.end_time
      and existing.end_time > new.start_time
      and existing.coach_id = new.coach_id
    limit 1;

    if found then
      raise exception 'У тренера уже есть занятие в это время (% – %)',
        to_char(conflicting.start_time at time zone 'Asia/Almaty', 'HH24:MI'),
        to_char(conflicting.end_time at time zone 'Asia/Almaty', 'HH24:MI');
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.log_schedule_session_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.schedule_change_log(session_id, action, changed_by, old_data, new_data)
    values (old.id, 'deleted', auth.uid(), to_jsonb(old), null);
    return old;
  end if;

  insert into public.schedule_change_log(session_id, action, changed_by, old_data, new_data)
  values (
    new.id,
    case tg_op when 'INSERT' then 'created' else 'updated' end,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;
