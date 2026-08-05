begin;

create table if not exists public.onefit_bookings (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  session_id uuid references public.schedule_sessions(id) on delete set null,
  source_date date not null,
  source_start_time time not null,
  source_class_name text not null,
  client_name text not null,
  source_status text not null default 'queued',
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onefit_booking_status_check check (source_status in ('queued', 'confirmed', 'cancelled'))
);

create index if not exists onefit_bookings_session_active_idx
  on public.onefit_bookings(session_id, is_active);
create index if not exists onefit_bookings_source_slot_idx
  on public.onefit_bookings(source_date, source_start_time, source_class_name);

create table if not exists public.onefit_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null default 'schedule',
  status text not null default 'running',
  source_date date not null,
  found_count integer not null default 0,
  matched_count integer not null default 0,
  unmatched_count integer not null default 0,
  cancelled_count integer not null default 0,
  error_message text,
  parser_complete boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint onefit_sync_trigger_check check (trigger_type in ('schedule', 'manual')),
  constraint onefit_sync_status_check check (status in ('queued', 'running', 'success', 'partial', 'failed'))
);

alter table public.onefit_sync_runs
  add column if not exists parser_complete boolean not null default false;
alter table public.onefit_sync_runs
  add column if not exists cancelled_count integer not null default 0;

create unique index if not exists onefit_one_pending_manual_sync_idx
  on public.onefit_sync_runs(source_date)
  where trigger_type = 'manual' and status in ('queued', 'running');

create or replace function public.enforce_booking_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_session public.schedule_sessions%rowtype;
  occupied integer;
  onefit_occupied integer;
  is_new_active boolean;
begin
  is_new_active := new.status not in ('cancelled', 'late_cancel', 'absent')
    and (tg_op = 'INSERT' or old.status in ('cancelled', 'late_cancel', 'absent') or old.session_id <> new.session_id);
  if not is_new_active then return new; end if;

  select * into target_session from public.schedule_sessions where id = new.session_id for update;
  if not found then raise exception 'Занятие не найдено'; end if;
  if target_session.booking_status <> 'open' or coalesce(target_session.is_cancelled, false) then
    raise exception 'Запись на это занятие закрыта';
  end if;
  if exists (
    select 1 from public.bookings existing
    where existing.session_id = new.session_id and existing.user_id = new.user_id
      and existing.id <> new.id and existing.status not in ('cancelled', 'late_cancel', 'absent')
  ) then raise exception 'Клиент уже записан на это занятие'; end if;

  select count(*) into occupied from public.bookings existing
  where existing.session_id = new.session_id and existing.id <> new.id
    and existing.status not in ('cancelled', 'late_cancel', 'absent');
  select count(*) into onefit_occupied from public.onefit_bookings
  where session_id = new.session_id and is_active = true;
  if occupied + onefit_occupied >= target_session.capacity then raise exception 'Свободных мест нет'; end if;
  return new;
end;
$$;

alter table public.onefit_bookings enable row level security;
alter table public.onefit_sync_runs enable row level security;

grant select on public.onefit_bookings to authenticated;
grant select, insert on public.onefit_sync_runs to authenticated;

drop policy if exists "Staff read OneFit bookings" on public.onefit_bookings;
create policy "Staff read OneFit bookings"
  on public.onefit_bookings for select
  using (public.is_admin());

drop policy if exists "Staff read OneFit sync runs" on public.onefit_sync_runs;
create policy "Staff read OneFit sync runs"
  on public.onefit_sync_runs for select
  using (public.is_admin());

drop policy if exists "Staff request OneFit sync" on public.onefit_sync_runs;
create policy "Staff request OneFit sync"
  on public.onefit_sync_runs for insert
  with check (
    public.is_admin()
    and trigger_type = 'manual'
    and status = 'queued'
    and source_date = date '2026-08-05'
  );

commit;
