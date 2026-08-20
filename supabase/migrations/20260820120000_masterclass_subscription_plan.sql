-- Разовый тариф для оплаты участия в мастер-классе.
-- Он доступен сотрудникам CRM, но скрыт из витрины тарифов клиента.
insert into public.subscription_plans
  (name, price, visits_count, duration_days, description, is_active, is_visible_in_client_portal, plan_format)
select
  'Посещение мастер-класса · 1 занятие',
  6000,
  1,
  30,
  'Разовое посещение мастер-класса.',
  true,
  false,
  'group'
where not exists (
  select 1
  from public.subscription_plans existing
  where lower(trim(existing.name)) = lower('Посещение мастер-класса · 1 занятие')
);

