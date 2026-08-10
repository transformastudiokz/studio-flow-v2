-- Controlled manual subscription corrections with an immutable audit trail.
alter table public.user_subscriptions
  add column if not exists visit_balance_adjustment integer not null default 0,
  add column if not exists manual_is_active_override boolean null;

-- Manual corrections must survive later attendance changes. The adjustment is
-- added to the ordinary formula: total visits - charged bookings.
create or replace function public.recalc_visits_remaining()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subscription_id uuid;
begin
  if tg_op = 'DELETE' then
    target_subscription_id := old.subscription_id;
  else
    target_subscription_id := new.subscription_id;
  end if;

  if tg_op = 'UPDATE'
     and old.subscription_id is distinct from new.subscription_id
     and old.subscription_id is not null then
    update public.user_subscriptions us
    set visits_remaining = least(
      us.visits_total,
      greatest(
        0,
        us.visits_total - (
          select count(*)::integer
          from public.bookings b
          where b.subscription_id = old.subscription_id
            and b.status in ('completed', 'absent', 'late_cancel')
        ) + coalesce(us.visit_balance_adjustment, 0)
      )
    )
    where us.id = old.subscription_id
      and us.visits_total is not null;
  end if;

  if target_subscription_id is not null then
    update public.user_subscriptions us
    set visits_remaining = least(
      us.visits_total,
      greatest(
        0,
        us.visits_total - (
          select count(*)::integer
          from public.bookings b
          where b.subscription_id = target_subscription_id
            and b.status in ('completed', 'absent', 'late_cancel')
        ) + coalesce(us.visit_balance_adjustment, 0)
      )
    )
    where us.id = target_subscription_id
      and us.visits_total is not null;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.recalc_visits_remaining() from public;

create or replace function public.sync_subscription_activity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  naturally_active boolean;
begin
  naturally_active := (new.visits_total is null or coalesce(new.visits_remaining, 0) > 0)
    and (new.end_date is null or new.end_date >= current_date);
  new.is_active := naturally_active and coalesce(new.manual_is_active_override, true);
  return new;
end;
$$;

drop trigger if exists sync_subscription_activity_on_write on public.user_subscriptions;
create trigger sync_subscription_activity_on_write
before insert or update of visits_total, visits_remaining, end_date, manual_is_active_override
on public.user_subscriptions
for each row execute function public.sync_subscription_activity();

create table if not exists public.subscription_adjustment_log (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.user_subscriptions(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  changed_by uuid null references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) >= 3),
  old_data jsonb not null,
  new_data jsonb not null
);

create index if not exists subscription_adjustment_log_subscription_time_idx
  on public.subscription_adjustment_log(subscription_id, changed_at desc);

alter table public.subscription_adjustment_log enable row level security;

drop policy if exists "staff can read subscription adjustments" on public.subscription_adjustment_log;
create policy "staff can read subscription adjustments"
  on public.subscription_adjustment_log for select
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('owner', 'admin')
        and coalesce(profile.is_active, true)
    )
  );

create or replace function public.adjust_client_subscription(
  p_subscription_id uuid,
  p_sale_date date,
  p_activation_date date,
  p_end_date date,
  p_visits_total integer,
  p_visits_remaining integer,
  p_is_active boolean,
  p_reason text,
  p_changed_by uuid
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row public.user_subscriptions%rowtype;
  new_row public.user_subscriptions%rowtype;
  staff_role text;
  staff_active boolean;
  charged_visits integer;
  requested_balance_adjustment integer;
  local_today date := (now() at time zone 'Asia/Almaty')::date;
begin
  select role, coalesce(is_active, true)
    into staff_role, staff_active
  from public.profiles
  where id = p_changed_by;

  if staff_role is null or staff_role not in ('owner', 'admin') or not coalesce(staff_active, false) then
    raise exception 'Insufficient permissions';
  end if;

  if p_subscription_id is null or p_sale_date is null then
    raise exception 'Subscription and sale date are required';
  end if;
  if p_visits_total is null or p_visits_total < 0 then
    raise exception 'Total visits must be zero or greater';
  end if;
  if p_visits_remaining is null or p_visits_remaining < 0 or p_visits_remaining > p_visits_total then
    raise exception 'Remaining visits must be between zero and total visits';
  end if;
  if p_activation_date is not null and p_end_date is not null and p_end_date < p_activation_date then
    raise exception 'End date cannot be before activation date';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Adjustment reason is required';
  end if;
  if coalesce(p_is_active, false) and p_visits_remaining = 0 then
    raise exception 'A subscription with no remaining visits cannot be active';
  end if;
  if coalesce(p_is_active, false) and p_end_date is not null and p_end_date < local_today then
    raise exception 'An expired subscription cannot be active';
  end if;

  select * into old_row
  from public.user_subscriptions
  where id = p_subscription_id
  for update;
  if not found then
    raise exception 'Subscription not found';
  end if;

  select count(*)::integer into charged_visits
  from public.bookings booking
  where booking.subscription_id = p_subscription_id
    and booking.status in ('completed', 'absent', 'late_cancel');

  requested_balance_adjustment := p_visits_remaining - (p_visits_total - charged_visits);

  update public.user_subscriptions
  set start_date = p_sale_date,
      activation_date = p_activation_date,
      end_date = p_end_date,
      visits_total = p_visits_total,
      visits_remaining = p_visits_remaining,
      visit_balance_adjustment = requested_balance_adjustment,
      manual_is_active_override = coalesce(p_is_active, false),
      is_active = coalesce(p_is_active, false)
  where id = p_subscription_id
  returning * into new_row;

  perform public.sync_subscription_sale_date(p_subscription_id, p_sale_date);

  insert into public.subscription_adjustment_log (
    subscription_id, client_id, changed_by, reason, old_data, new_data
  ) values (
    new_row.id,
    new_row.user_id,
    p_changed_by,
    trim(p_reason),
    to_jsonb(old_row),
    to_jsonb(new_row)
  );

  return new_row;
end;
$$;

revoke all on function public.adjust_client_subscription(
  uuid, date, date, date, integer, integer, boolean, text, uuid
) from public, anon, authenticated;
grant execute on function public.adjust_client_subscription(
  uuid, date, date, date, integer, integer, boolean, text, uuid
) to service_role;
