alter table public.subscription_plans
  add column if not exists plan_format text not null default 'group';

alter table public.subscription_plans
  drop constraint if exists subscription_plans_plan_format_check;

alter table public.subscription_plans
  add constraint subscription_plans_plan_format_check
  check (plan_format in ('group', 'individual', 'split'));

comment on column public.subscription_plans.plan_format is
  'Формат тарифа: групповой, индивидуальный или сплит для двух клиентов.';

update public.subscription_plans
set plan_format = 'group'
where plan_format is null or plan_format not in ('group', 'individual', 'split');

create index if not exists subscription_plans_format_active_idx
  on public.subscription_plans (plan_format, is_active, price);

insert into public.subscription_plans
  (name, price, visits_count, duration_days, description, is_active, is_visible_in_client_portal, plan_format)
select seed.*
from (values
  ('Индивидуальное занятие · 1 занятие', 14000, 1, 28, 'Персональное занятие один на один с тренером.', true, true, 'individual'),
  ('Индивидуальные занятия · 4 занятия', 50399, 4, 28, 'Персональные занятия один на один с тренером.', true, true, 'individual'),
  ('Индивидуальные занятия · 12 занятий', 147633, 12, 28, 'Персональные занятия один на один с тренером.', true, true, 'individual'),
  ('Индивидуальные занятия · 24 занятия', 289157, 24, 90, 'Персональные занятия один на один с тренером.', true, true, 'individual'),
  ('Индивидуальные занятия · 48 занятий', 565079, 48, 180, 'Персональные занятия один на один с тренером.', true, true, 'individual'),
  ('Индивидуальные занятия · 96 занятий', 1102158, 96, 365, 'Персональные занятия один на один с тренером.', true, true, 'individual'),
  ('Сплит-тренировки · 1 занятие', 11454, 1, 28, 'Тренировка для двух человек. Стоимость указана за одного клиента.', true, true, 'split'),
  ('Сплит-тренировки · 4 занятия', 41235, 4, 28, 'Тренировки для двух человек. Стоимость указана за одного клиента.', true, true, 'split'),
  ('Сплит-тренировки · 12 занятий', 120652, 12, 28, 'Тренировки для двух человек. Стоимость указана за одного клиента.', true, true, 'split'),
  ('Сплит-тренировки · 24 занятия', 236722, 24, 90, 'Тренировки для двух человек. Стоимость указана за одного клиента.', true, true, 'split')
) as seed(name, price, visits_count, duration_days, description, is_active, is_visible_in_client_portal, plan_format)
where not exists (
  select 1
  from public.subscription_plans existing
  where lower(trim(existing.name)) = lower(trim(seed.name))
);
