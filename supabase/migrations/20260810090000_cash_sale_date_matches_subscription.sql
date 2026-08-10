-- The business sale date is user_subscriptions.start_date.
-- Preserve the entered local time, but put the cash operation on that date.
create or replace function public.cash_timestamp_for_sale_date(
  p_sale_date date,
  p_reference timestamptz
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (
    p_sale_date + (coalesce(p_reference, now()) at time zone 'Asia/Almaty')::time
  ) at time zone 'Asia/Almaty';
$$;

create or replace function public.prevent_cash_transaction_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.cash_history_maintenance', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'Cash history is immutable. Create a correction instead.';
end;
$$;

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
    public.cash_timestamp_for_sale_date(new.start_date, coalesce(new.created_at, now())),
    'sale', new.user_id, new.id, new.plan_id,
    coalesce(plan_row.name, 'Абонемент'), coalesce(plan_row.price, 0), auth.uid()
  ) on conflict do nothing;

  return new;
end;
$$;

create or replace function public.sync_subscription_sale_date(
  p_subscription_id uuid,
  p_sale_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_subscription_id is null or p_sale_date is null then
    raise exception 'Subscription and sale date are required';
  end if;

  perform set_config('app.cash_history_maintenance', 'on', true);

  update public.cash_transactions
  set occurred_at = public.cash_timestamp_for_sale_date(p_sale_date, occurred_at)
  where subscription_id = p_subscription_id
    and operation_type = 'sale';
end;
$$;

revoke all on function public.sync_subscription_sale_date(uuid, date) from public, anon, authenticated;
grant execute on function public.sync_subscription_sale_date(uuid, date) to service_role;
