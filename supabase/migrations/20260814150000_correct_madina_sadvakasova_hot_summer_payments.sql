-- Split the legacy full-price sale into the two payments actually received.
-- The original seller remains Aida; the second payment was accepted by Akmeyir.
do $$
declare
  subscription_uuid constant uuid := '73cbbcee-2016-478f-aaf1-28736ebcd537';
  sale_uuid constant uuid := '29c2f1a8-39d4-47c1-98a9-38e697c3399f';
  client_uuid constant uuid := '9955ce40-492f-435b-b6b4-81018ce1fa70';
  aida_uuid constant uuid := '57277006-6bd9-4f59-bdc1-e4947331ddc1';
  akmeyir_uuid constant uuid := 'd0aa42b4-a681-4a51-9612-809f3bbec5b9';
  plan_uuid uuid;
  original_payment_at timestamptz;
  current_sale_amount numeric;
begin
  select us.plan_id
    into plan_uuid
  from public.user_subscriptions us
  join public.subscription_plans sp on sp.id = us.plan_id
  where us.id = subscription_uuid
    and us.user_id = client_uuid
    and sp.name = 'Жаркое лето';

  if plan_uuid is null then
    raise exception 'Expected Madina Hot Summer subscription was not found';
  end if;

  select ct.occurred_at, ct.amount
    into original_payment_at, current_sale_amount
  from public.cash_transactions ct
  where ct.id = sale_uuid
    and ct.client_id = client_uuid
    and ct.subscription_id = subscription_uuid
    and ct.operation_type = 'sale';

  if original_payment_at is null then
    raise exception 'Expected Hot Summer cash sale was not found';
  end if;

  if current_sale_amount not in (20000, 107250) then
    raise exception 'Unexpected existing sale amount: %', current_sale_amount;
  end if;

  update public.user_subscriptions
  set start_date = date '2026-08-07',
      agreed_price = 107250,
      sale_responsible_user_id = aida_uuid
  where id = subscription_uuid;

  perform set_config('app.cash_history_maintenance', 'on', true);

  update public.cash_transactions
  set occurred_at = public.cash_timestamp_for_sale_date(date '2026-08-07', original_payment_at),
      amount = 20000,
      responsible_user_id = aida_uuid,
      notes = 'Первый взнос за абонемент «Жаркое лето». Остаток 87 250 ₸.'
  where id = sale_uuid;

  insert into public.cash_transactions (
    occurred_at, operation_type, client_id, subscription_id, plan_id,
    title, amount, responsible_user_id, payment_method, notes, idempotency_key
  ) values (
    original_payment_at, 'subscription_payment', client_uuid, subscription_uuid, plan_uuid,
    'Доплата: Жаркое лето', 87250, akmeyir_uuid, null,
    'Доплата по абонементу. Продажа закреплена за Аидой Рабаевой.',
    'legacy-hot-summer-madina-2026-08-14-final-payment'
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;
end;
$$;
