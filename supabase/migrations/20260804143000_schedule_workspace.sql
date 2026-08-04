-- Administrative schedule workspace: two rooms, server-side conflict checks
-- and safe manual/client booking capacity enforcement. Client-facing views are unchanged.

alter table public.schedule_sessions
  add column if not exists room text;

update public.schedule_sessions
set room = case
  when lower(coalesce(room, '')) in ('малый зал', 'зал 2', '2') then 'Малый зал'
  else 'Большой зал'
end
where room is null
   or room not in ('Большой зал', 'Малый зал');

alter table public.schedule_sessions
  alter column room set default 'Большой зал',
  alter column room set not null;

alter table public.schedule_sessions
  drop constraint if exists schedule_sessions_room_check;
alter table public.schedule_sessions
  add constraint schedule_sessions_room_check
  check (room in ('Большой зал', 'Малый зал'));

create index if not exists schedule_sessions_room_time_idx
  on public.schedule_sessions(room, start_time, end_time);
create index if not exists schedule_sessions_coach_time_idx
  on public.schedule_sessions(coach_id, start_time, end_time);

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

drop trigger if exists enforce_schedule_session_conflicts on public.schedule_sessions;
create trigger enforce_schedule_session_conflicts
before insert or update of start_time, end_time, room, coach_id, booking_status, is_cancelled
on public.schedule_sessions
for each row execute function public.enforce_schedule_session_conflicts();

create or replace function public.enforce_booking_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_session public.schedule_sessions%rowtype;
  occupied integer;
  is_new_active boolean;
begin
  is_new_active := new.status not in ('cancelled', 'late_cancel', 'absent')
    and (
      tg_op = 'INSERT'
      or old.status in ('cancelled', 'late_cancel', 'absent')
      or old.session_id <> new.session_id
    );

  if not is_new_active then
    return new;
  end if;

  select * into target_session
  from public.schedule_sessions
  where id = new.session_id
  for update;

  if not found then
    raise exception 'Занятие не найдено';
  end if;
  if target_session.booking_status <> 'open' or coalesce(target_session.is_cancelled, false) then
    raise exception 'Запись на это занятие закрыта';
  end if;

  if exists (
    select 1 from public.bookings existing
    where existing.session_id = new.session_id
      and existing.user_id = new.user_id
      and existing.id <> new.id
      and existing.status not in ('cancelled', 'late_cancel', 'absent')
  ) then
    raise exception 'Клиент уже записан на это занятие';
  end if;

  select count(*) into occupied
  from public.bookings existing
  where existing.session_id = new.session_id
    and existing.id <> new.id
    and existing.status not in ('cancelled', 'late_cancel', 'absent');

  if occupied >= target_session.capacity then
    raise exception 'Свободных мест нет';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_booking_rules on public.bookings;
create trigger enforce_booking_rules
before insert or update of session_id, user_id, status
on public.bookings
for each row execute function public.enforce_booking_rules();

create or replace function public.prevent_capacity_below_bookings()
returns trigger
language plpgsql
set search_path = public
as $$
declare occupied integer;
begin
  if new.capacity >= old.capacity then return new; end if;
  select count(*) into occupied
  from public.bookings
  where session_id = new.id
    and status not in ('cancelled', 'late_cancel', 'absent');
  if new.capacity < occupied then
    raise exception 'Нельзя установить % мест: уже записано %', new.capacity, occupied;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_capacity_below_bookings on public.schedule_sessions;
create trigger prevent_capacity_below_bookings
before update of capacity on public.schedule_sessions
for each row execute function public.prevent_capacity_below_bookings();
