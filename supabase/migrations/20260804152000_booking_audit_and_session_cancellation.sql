-- Preserve a full history of booking/attendance changes and return reserved
-- visits when the studio cancels a future session.
create table if not exists public.booking_change_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  session_id uuid null,
  user_id uuid null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  changed_by uuid null,
  changed_at timestamptz not null default now(),
  old_data jsonb null,
  new_data jsonb null
);

create index if not exists booking_change_log_booking_time_idx
  on public.booking_change_log(booking_id, changed_at desc);
create index if not exists booking_change_log_session_time_idx
  on public.booking_change_log(session_id, changed_at desc);

alter table public.booking_change_log enable row level security;

drop policy if exists "staff can read booking change log" on public.booking_change_log;
create policy "staff can read booking change log"
  on public.booking_change_log for select
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('owner', 'admin')
        and coalesce(profile.is_active, true)
    )
  );

create or replace function public.log_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.booking_change_log(booking_id, session_id, user_id, action, changed_by, old_data)
    values (old.id, old.session_id, old.user_id, 'deleted', auth.uid(), to_jsonb(old));
    return old;
  end if;

  insert into public.booking_change_log(booking_id, session_id, user_id, action, changed_by, old_data, new_data)
  values (
    new.id,
    new.session_id,
    new.user_id,
    case tg_op when 'INSERT' then 'created' else 'updated' end,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists log_booking_change on public.bookings;
create trigger log_booking_change
after insert or update or delete on public.bookings
for each row execute function public.log_booking_change();

create or replace function public.cancel_bookings_with_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set status = 'cancelled'
  where session_id = new.id
    and status not in ('cancelled', 'late_cancel', 'absent', 'completed');
  return new;
end;
$$;

drop trigger if exists cancel_bookings_with_session on public.schedule_sessions;
create trigger cancel_bookings_with_session
after update of booking_status, is_cancelled on public.schedule_sessions
for each row
when (
  (new.booking_status = 'cancelled' or coalesce(new.is_cancelled, false))
  and not (old.booking_status = 'cancelled' or coalesce(old.is_cancelled, false))
)
execute function public.cancel_bookings_with_session();
