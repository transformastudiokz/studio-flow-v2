-- Assign the second overlapping future session to the small room.
-- At migration time the source data has no more than two concurrent sessions.
do $$
declare
  current_session record;
begin
  for current_session in
    select id, start_time, end_time
    from public.schedule_sessions
    where start_time >= now()
      and booking_status <> 'cancelled'
      and not coalesce(is_cancelled, false)
    order by start_time, id
  loop
    if exists (
      select 1
      from public.schedule_sessions previous
      where previous.id <> current_session.id
        and previous.room = 'Большой зал'
        and previous.booking_status <> 'cancelled'
        and not coalesce(previous.is_cancelled, false)
        and previous.start_time < current_session.end_time
        and previous.end_time > current_session.start_time
        and (
          previous.start_time < current_session.start_time
          or (previous.start_time = current_session.start_time and previous.id < current_session.id)
        )
    ) then
      update public.schedule_sessions
      set room = 'Малый зал'
      where id = current_session.id
        and room <> 'Малый зал';
    end if;
  end loop;
end $$;

create table if not exists public.schedule_change_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  changed_by uuid null,
  changed_at timestamptz not null default now(),
  old_data jsonb null,
  new_data jsonb null
);

create index if not exists schedule_change_log_session_time_idx
  on public.schedule_change_log(session_id, changed_at desc);

alter table public.schedule_change_log enable row level security;

drop policy if exists "staff can read schedule change log" on public.schedule_change_log;
create policy "staff can read schedule change log"
  on public.schedule_change_log for select
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('owner', 'admin')
        and coalesce(profile.is_active, true)
    )
  );

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

drop trigger if exists log_schedule_session_change on public.schedule_sessions;
create trigger log_schedule_session_change
after insert or update or delete on public.schedule_sessions
for each row execute function public.log_schedule_session_change();

create or replace function public.preserve_booking_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.allow_booking_delete', true) = 'true' then
    return old;
  end if;
  raise exception 'Записи клиентов сохраняются в истории. Используйте статус «Отмена»';
end;
$$;

drop trigger if exists preserve_booking_history on public.bookings;
create trigger preserve_booking_history
before delete on public.bookings
for each row execute function public.preserve_booking_history();
