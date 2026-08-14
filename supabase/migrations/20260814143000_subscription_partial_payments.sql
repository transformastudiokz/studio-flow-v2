-- Partial payments for fitness subscriptions.
-- Contract value belongs to the subscription; cash rows represent actual money received.

alter table public.user_subscriptions
  add column if not exists agreed_price numeric(12,2),
  add column if not exists sale_responsible_user_id uuid references public.profiles(id),
  add column if not exists sale_operation_key text;

create unique index if not exists user_subscriptions_sale_operation_key_idx
  on public.user_subscriptions(sale_operation_key) where sale_operation_key is not null;

update public.user_subscriptions us
set agreed_price = coalesce(sp.price, 0)
from public.subscription_plans sp
where us.plan_id = sp.id and us.agreed_price is null;

update public.user_subscriptions us
set sale_responsible_user_id = ct.responsible_user_id
from public.cash_transactions ct
where ct.subscription_id = us.id
  and ct.operation_type = 'sale'
  and us.sale_responsible_user_id is null;

alter table public.cash_transactions drop constraint if exists cash_transactions_operation_type_check;
alter table public.cash_transactions add constraint cash_transactions_operation_type_check
  check (operation_type in ('sale','subscription_payment','upgrade','refund','correction','manual','rental_payment','rental_refund'));

create index if not exists cash_transactions_subscription_payment_idx
  on public.cash_transactions(subscription_id, occurred_at desc)
  where subscription_id is not null;

create or replace view public.subscription_financials as
select
  us.id as subscription_id,
  coalesce(us.agreed_price, sp.price, 0)::numeric(12,2) as agreed_price,
  coalesce(sum(ct.amount) filter (
    where ct.operation_type in ('sale','subscription_payment','refund','correction','upgrade')
  ), 0)::numeric(12,2) as paid_amount,
  greatest(
    coalesce(us.agreed_price, sp.price, 0) - coalesce(sum(ct.amount) filter (
      where ct.operation_type in ('sale','subscription_payment','refund','correction','upgrade')
    ), 0),
    0
  )::numeric(12,2) as debt_amount,
  case
    when coalesce(sum(ct.amount) filter (where ct.operation_type in ('sale','subscription_payment','refund','correction','upgrade')), 0) <= 0 then 'unpaid'
    when coalesce(sum(ct.amount) filter (where ct.operation_type in ('sale','subscription_payment','refund','correction','upgrade')), 0) < coalesce(us.agreed_price, sp.price, 0) then 'partial'
    else 'paid'
  end as payment_status
from public.user_subscriptions us
left join public.subscription_plans sp on sp.id = us.plan_id
left join public.cash_transactions ct on ct.subscription_id = us.id
group by us.id, us.agreed_price, sp.price;

grant select on public.subscription_financials to authenticated;

create or replace function public.record_subscription_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.subscription_plans%rowtype;
begin
  if current_setting('app.subscription_sale_rpc', true) = 'on' then
    return new;
  end if;

  select * into plan_row from public.subscription_plans where id = new.plan_id;
  update public.user_subscriptions
  set agreed_price = coalesce(agreed_price, plan_row.price, 0),
      sale_responsible_user_id = coalesce(sale_responsible_user_id, auth.uid())
  where id = new.id;

  insert into public.cash_transactions (
    occurred_at, operation_type, client_id, subscription_id, plan_id,
    title, amount, responsible_user_id
  ) values (
    public.cash_timestamp_for_sale_date(new.start_date, coalesce(new.created_at, now())),
    'sale', new.user_id, new.id, new.plan_id,
    coalesce(plan_row.name, 'Абонемент'), coalesce(new.agreed_price, plan_row.price, 0), auth.uid()
  ) on conflict do nothing;
  return new;
end;
$$;

create or replace function public.sell_subscription_with_payment(
  p_client_id uuid,
  p_plan_id uuid,
  p_sale_date date,
  p_agreed_price numeric,
  p_initial_payment numeric,
  p_payment_method text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.subscription_plans%rowtype;
  client_row public.profiles%rowtype;
  existing_id uuid;
  subscription_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'Некорректный ключ операции'; end if;
  perform pg_advisory_xact_lock(hashtext(p_idempotency_key));

  select id into existing_id from public.user_subscriptions where sale_operation_key = p_idempotency_key;
  if existing_id is not null then return existing_id; end if;

  select * into client_row from public.profiles where id = p_client_id and role = 'client' and is_active = true;
  if not found then raise exception 'Активный клиент не найден'; end if;
  select * into plan_row from public.subscription_plans where id = p_plan_id and is_active = true;
  if not found then raise exception 'Тариф не найден'; end if;
  if p_sale_date is null then raise exception 'Укажи дату продажи'; end if;
  if p_agreed_price is null or p_agreed_price < 0 then raise exception 'Некорректная стоимость'; end if;
  if p_initial_payment is null or p_initial_payment < 0 or p_initial_payment > p_agreed_price then
    raise exception 'Первый взнос должен быть от 0 до стоимости абонемента';
  end if;
  if p_initial_payment > 0 and p_payment_method not in ('kaspi','halyk','cash','bank_account') then
    raise exception 'Выбери способ оплаты';
  end if;

  perform set_config('app.subscription_sale_rpc', 'on', true);
  insert into public.user_subscriptions (
    id,user_id,plan_id,visits_total,visits_remaining,start_date,activation_date,end_date,is_active,
    agreed_price,sale_responsible_user_id,sale_operation_key
  ) values (
    subscription_id,p_client_id,p_plan_id,plan_row.visits_count,plan_row.visits_count,p_sale_date,null,null,true,
    p_agreed_price,auth.uid(),p_idempotency_key
  );

  if p_initial_payment > 0 then
    insert into public.cash_transactions (
      occurred_at,operation_type,client_id,subscription_id,plan_id,title,amount,responsible_user_id,payment_method,idempotency_key,notes
    ) values (
      public.cash_timestamp_for_sale_date(p_sale_date,now()),'sale',p_client_id,subscription_id,p_plan_id,
      plan_row.name,p_initial_payment,auth.uid(),p_payment_method,p_idempotency_key || ':payment',
      case when p_initial_payment < p_agreed_price then 'Первый взнос. Остаток ' || (p_agreed_price-p_initial_payment)::text || ' ₸' else null end
    );
  end if;
  return subscription_id;
end;
$$;

create or replace function public.record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz,
  p_note text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sub_row public.user_subscriptions%rowtype;
  plan_row public.subscription_plans%rowtype;
  current_paid numeric;
  existing public.cash_transactions%rowtype;
  transaction_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Сумма должна быть больше нуля'; end if;
  if p_payment_method not in ('kaspi','halyk','cash','bank_account') then raise exception 'Выбери способ оплаты'; end if;
  if p_paid_at is null then raise exception 'Укажи дату оплаты'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'Некорректный ключ операции'; end if;
  perform pg_advisory_xact_lock(hashtext(p_idempotency_key));

  select * into existing from public.cash_transactions where idempotency_key = p_idempotency_key;
  if found then
    if existing.subscription_id <> p_subscription_id or existing.amount <> p_amount then raise exception 'Ключ операции уже использован'; end if;
    return existing.id;
  end if;

  select * into sub_row from public.user_subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Абонемент не найден'; end if;
  select * into plan_row from public.subscription_plans where id = sub_row.plan_id;
  select coalesce(paid_amount,0) into current_paid from public.subscription_financials where subscription_id = p_subscription_id;
  if current_paid + p_amount > coalesce(sub_row.agreed_price, plan_row.price, 0) then raise exception 'Сумма превышает остаток долга'; end if;

  insert into public.cash_transactions (
    id,occurred_at,operation_type,client_id,subscription_id,plan_id,title,amount,responsible_user_id,payment_method,idempotency_key,notes
  ) values (
    transaction_id,p_paid_at,'subscription_payment',sub_row.user_id,sub_row.id,sub_row.plan_id,
    'Доплата: ' || coalesce(plan_row.name,'Абонемент'),p_amount,auth.uid(),p_payment_method,p_idempotency_key,nullif(trim(p_note),'')
  );
  return transaction_id;
end;
$$;

revoke all on function public.sell_subscription_with_payment(uuid,uuid,date,numeric,numeric,text,text) from public,anon;
revoke all on function public.record_subscription_payment(uuid,numeric,text,timestamptz,text,text) from public,anon;
grant execute on function public.sell_subscription_with_payment(uuid,uuid,date,numeric,numeric,text,text) to authenticated;
grant execute on function public.record_subscription_payment(uuid,numeric,text,timestamptz,text,text) to authenticated;
