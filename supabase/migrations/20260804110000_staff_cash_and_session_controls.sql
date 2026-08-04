begin;

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

alter table public.profiles
  add column if not exists position text,
  add column if not exists is_active boolean not null default true,
  add column if not exists must_change_password boolean not null default false;

alter table public.schedule_sessions
  add column if not exists booking_status text not null default 'open',
  add column if not exists booking_closed_reason text,
  add column if not exists booking_closed_at timestamptz,
  add column if not exists booking_closed_by uuid references public.profiles(id);

alter table public.schedule_sessions
  drop constraint if exists schedule_sessions_booking_status_check;
alter table public.schedule_sessions
  add constraint schedule_sessions_booking_status_check
  check (booking_status in ('open', 'closed', 'cancelled'));

update public.schedule_sessions
set booking_status = 'cancelled',
    booking_closed_reason = coalesce(booking_closed_reason, 'Перенесено из прежнего статуса отмены')
where is_cancelled = true and booking_status = 'open';

alter table public.schedule_sessions
  drop constraint if exists schedule_sessions_closed_reason_check;
alter table public.schedule_sessions
  add constraint schedule_sessions_closed_reason_check
  check (
    booking_status = 'open'
    or nullif(trim(booking_closed_reason), '') is not null
  );

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  operation_type text not null,
  client_id uuid not null references public.profiles(id),
  subscription_id uuid references public.user_subscriptions(id),
  plan_id uuid references public.subscription_plans(id),
  title text not null,
  amount numeric(12,2) not null,
  responsible_user_id uuid references public.profiles(id),
  related_transaction_id uuid references public.cash_transactions(id),
  notes text,
  created_at timestamptz not null default now(),
  constraint cash_transactions_operation_type_check
    check (operation_type in ('sale', 'upgrade', 'refund', 'correction', 'manual'))
);

create unique index if not exists cash_transactions_subscription_sale_idx
  on public.cash_transactions(subscription_id)
  where operation_type = 'sale' and subscription_id is not null;
create index if not exists cash_transactions_occurred_at_idx
  on public.cash_transactions(occurred_at desc);
create index if not exists cash_transactions_client_idx
  on public.cash_transactions(client_id);

alter table public.cash_transactions enable row level security;
grant select, insert on public.cash_transactions to authenticated;
revoke update, delete on public.cash_transactions from authenticated;

drop policy if exists "Staff read cash transactions" on public.cash_transactions;
create policy "Staff read cash transactions"
  on public.cash_transactions for select
  using (public.is_admin());

drop policy if exists "Staff create cash transactions" on public.cash_transactions;
create policy "Staff create cash transactions"
  on public.cash_transactions for insert
  with check (
    public.is_admin()
    and responsible_user_id = auth.uid()
  );

create or replace function public.prevent_cash_transaction_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Cash history is immutable. Create a correction instead.';
end;
$$;

drop trigger if exists cash_transactions_immutable on public.cash_transactions;
create trigger cash_transactions_immutable
before update or delete on public.cash_transactions
for each row execute function public.prevent_cash_transaction_mutation();

create or replace function public.record_subscription_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.subscription_plans%rowtype;
begin
  select * into plan_row from public.subscription_plans where id = new.plan_id;

  insert into public.cash_transactions (
    occurred_at, operation_type, client_id, subscription_id, plan_id,
    title, amount, responsible_user_id
  ) values (
    coalesce(new.created_at, now()), 'sale', new.user_id, new.id, new.plan_id,
    coalesce(plan_row.name, 'Абонемент'), coalesce(plan_row.price, 0), auth.uid()
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists user_subscription_cash_sale on public.user_subscriptions;
create trigger user_subscription_cash_sale
after insert on public.user_subscriptions
for each row execute function public.record_subscription_sale();

insert into public.cash_transactions (
  occurred_at, operation_type, client_id, subscription_id, plan_id,
  title, amount, responsible_user_id, notes
)
select
  us.created_at,
  'sale',
  us.user_id,
  us.id,
  us.plan_id,
  coalesce(sp.name, 'Абонемент'),
  coalesce(sp.price, 0),
  null,
  'Перенесено из истории абонементов'
from public.user_subscriptions us
left join public.subscription_plans sp on sp.id = us.plan_id
on conflict do nothing;

create or replace function public.adjust_subscription_from_cash(
  p_transaction_id uuid,
  p_operation_type text,
  p_amount numeric,
  p_notes text,
  p_new_plan_id uuid default null,
  p_deactivate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_tx public.cash_transactions%rowtype;
  plan_row public.subscription_plans%rowtype;
  new_tx_id uuid;
  final_amount numeric(12,2);
begin
  if not public.is_admin() then
    raise exception 'Access denied';
  end if;

  if p_operation_type not in ('upgrade', 'refund', 'correction') then
    raise exception 'Unsupported operation type';
  end if;

  select * into source_tx
  from public.cash_transactions
  where id = p_transaction_id;

  if source_tx.id is null then
    raise exception 'Transaction not found';
  end if;

  if p_operation_type = 'upgrade' then
    if p_new_plan_id is null or source_tx.subscription_id is null then
      raise exception 'A new plan and subscription are required';
    end if;

    select * into plan_row
    from public.subscription_plans
    where id = p_new_plan_id and is_active = true;

    if plan_row.id is null then
      raise exception 'Plan not found';
    end if;

    update public.user_subscriptions
    set plan_id = plan_row.id,
        visits_total = plan_row.visits_count,
        visits_remaining = plan_row.visits_count,
        start_date = current_date,
        activation_date = current_date,
        end_date = current_date + plan_row.duration_days,
        is_active = true
    where id = source_tx.subscription_id;
  elsif p_deactivate and source_tx.subscription_id is not null then
    update public.user_subscriptions
    set is_active = false
    where id = source_tx.subscription_id;
  end if;

  final_amount := case
    when p_operation_type = 'refund' then -abs(p_amount)
    else p_amount
  end;

  insert into public.cash_transactions (
    operation_type, client_id, subscription_id, plan_id, title,
    amount, responsible_user_id, related_transaction_id, notes
  ) values (
    p_operation_type,
    source_tx.client_id,
    source_tx.subscription_id,
    coalesce(p_new_plan_id, source_tx.plan_id),
    case p_operation_type
      when 'upgrade' then 'Замена абонемента: ' || plan_row.name
      when 'refund' then 'Возврат: ' || source_tx.title
      else 'Корректировка: ' || source_tx.title
    end,
    final_amount,
    auth.uid(),
    source_tx.id,
    nullif(trim(p_notes), '')
  ) returning id into new_tx_id;

  return new_tx_id;
end;
$$;

grant execute on function public.adjust_subscription_from_cash(uuid, text, numeric, text, uuid, boolean) to authenticated;

create or replace function public.get_trainer_schedule(p_from timestamptz, p_to timestamptz)
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
  booked_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    ss.id, ss.start_time, ss.end_time, ss.capacity, ss.room,
    ss.booking_status, ss.booking_closed_reason,
    ct.name, ct.color,
    count(b.id) filter (where b.status not in ('cancelled', 'late_cancel'))
  from public.schedule_sessions ss
  join public.coaches c on c.id = ss.coach_id and c.user_id = auth.uid()
  join public.class_types ct on ct.id = ss.class_type_id
  left join public.bookings b on b.session_id = ss.id
  where ss.start_time >= p_from and ss.start_time <= p_to
  group by ss.id, ct.name, ct.color
  order by ss.start_time;
$$;

grant execute on function public.get_trainer_schedule(timestamptz, timestamptz) to authenticated;
grant execute on function public.is_owner() to authenticated;

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.is_owner() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'You cannot change your own role or active status';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_security_fields on public.profiles;
create trigger protect_profile_security_fields
before update on public.profiles
for each row execute function public.protect_profile_security_fields();

drop policy if exists "Admin full access profiles" on public.profiles;
drop policy if exists "Owner full access profiles" on public.profiles;
drop policy if exists "Admin read profiles" on public.profiles;
drop policy if exists "Admin insert clients" on public.profiles;
drop policy if exists "Admin update clients" on public.profiles;
drop policy if exists "Admin delete clients" on public.profiles;

create policy "Owner full access profiles"
  on public.profiles for all
  using (public.is_owner())
  with check (public.is_owner());
create policy "Admin read profiles"
  on public.profiles for select
  using (public.is_admin());
create policy "Admin insert clients"
  on public.profiles for insert
  with check (public.is_admin() and role = 'client');
create policy "Admin update clients"
  on public.profiles for update
  using (public.is_admin() and role = 'client')
  with check (public.is_admin() and role = 'client');
create policy "Admin delete clients"
  on public.profiles for delete
  using (public.is_admin() and role = 'client');

drop policy if exists "Admin manage class types" on public.class_types;
drop policy if exists "Owner manage class types" on public.class_types;
create policy "Owner manage class types"
  on public.class_types for all
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "Admin manage coaches" on public.coaches;
drop policy if exists "Owner manage coaches" on public.coaches;
create policy "Owner manage coaches"
  on public.coaches for all
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "Admin manage plans" on public.subscription_plans;
drop policy if exists "Owner manage plans" on public.subscription_plans;
create policy "Owner manage plans"
  on public.subscription_plans for all
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "Public read schedule" on public.schedule_sessions;
drop policy if exists "Role based read schedule" on public.schedule_sessions;
create policy "Role based read schedule"
  on public.schedule_sessions for select
  using (
    public.is_admin()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client')
    or exists (select 1 from public.coaches c where c.id = coach_id and c.user_id = auth.uid())
  );

drop policy if exists "Client create booking" on public.bookings;
create policy "Client create booking"
  on public.bookings for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.schedule_sessions ss
      where ss.id = session_id
        and ss.booking_status = 'open'
        and ss.start_time > now()
    )
  );

update public.profiles
set role = 'owner',
    position = coalesce(position, 'Управляющий'),
    is_active = true
where id = '5592b61b-8788-4f76-ad7d-44d63ce8ea26';

commit;
