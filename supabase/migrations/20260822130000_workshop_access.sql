-- Мастер-классы учитываются отдельно от фитнес-занятий и не расходуют
-- групповые, индивидуальные или сплит-абонементы действующих клиентов.
alter table public.subscription_plans
  add column if not exists product_kind text not null default 'fitness';

alter table public.subscription_plans
  drop constraint if exists subscription_plans_product_kind_check;

alter table public.subscription_plans
  add constraint subscription_plans_product_kind_check
  check (product_kind in ('fitness', 'workshop'));

update public.subscription_plans
set product_kind = 'workshop'
where lower(name) like '%мастер-класс%';

alter table public.schedule_sessions
  drop constraint if exists schedule_sessions_session_kind_check;

alter table public.schedule_sessions
  add constraint schedule_sessions_session_kind_check
  check (session_kind in ('fitness', 'rental', 'workshop'));

update public.schedule_sessions session
set session_kind = 'workshop'
from public.class_types class_type
where session.class_type_id = class_type.id
  and lower(class_type.name) ~ 'мастер[ -]*класс';

alter table public.bookings
  add column if not exists access_type text not null default 'standard',
  add column if not exists eligibility_subscription_id uuid null
    references public.user_subscriptions(id) on delete set null;

alter table public.bookings
  drop constraint if exists bookings_access_type_check;

alter table public.bookings
  add constraint bookings_access_type_check
  check (access_type in ('standard', 'workshop_member_free', 'workshop_paid', 'workshop_complimentary'));

create index if not exists bookings_eligibility_subscription_idx
  on public.bookings (eligibility_subscription_id)
  where eligibility_subscription_id is not null;

-- Оплаченные пропуски определяются однозначно по отдельному виду продукта.
update public.bookings booking
set access_type = 'workshop_paid'
from public.user_subscriptions subscription
join public.subscription_plans plan on plan.id = subscription.plan_id
cross join public.schedule_sessions session
where booking.subscription_id = subscription.id
  and session.id = booking.session_id
  and session.session_kind = 'workshop'
  and plan.product_kind = 'workshop';

-- Старые мастер-классы могли уже списать визит с группового,
-- индивидуального или сплит-абонемента. Запоминаем затронутые абонементы,
-- отвязываем мастер-класс и пересчитываем остаток по фактическим расходным
-- посещениям. Пересчёт идемпотентен и не начисляет визиты сверх тарифа.
create temporary table workshop_affected_subscriptions on commit drop as
select distinct subscription.id
from public.bookings booking
join public.schedule_sessions session on session.id = booking.session_id
join public.user_subscriptions subscription on subscription.id = booking.subscription_id
join public.subscription_plans plan on plan.id = subscription.plan_id
where session.session_kind = 'workshop'
  and plan.product_kind = 'fitness'
  and plan.plan_format in ('group', 'individual', 'split');

update public.bookings booking
set access_type = 'workshop_member_free',
    eligibility_subscription_id = booking.subscription_id,
    subscription_id = null
from public.schedule_sessions session,
     public.user_subscriptions subscription,
     public.subscription_plans plan
where session.id = booking.session_id
  and subscription.id = booking.subscription_id
  and plan.id = subscription.plan_id
  and session.session_kind = 'workshop'
  and plan.product_kind = 'fitness'
  and plan.plan_format in ('group', 'individual', 'split');

with usage as (
  select
    subscription.id as subscription_id,
    plan.visits_count,
    count(booking.id) filter (
      where booking.status in ('completed', 'absent', 'late_cancel')
    )::integer as used_visits
  from public.user_subscriptions subscription
  join workshop_affected_subscriptions affected on affected.id = subscription.id
  join public.subscription_plans plan on plan.id = subscription.plan_id
  left join public.bookings booking on booking.subscription_id = subscription.id
  group by subscription.id, plan.visits_count
)
update public.user_subscriptions subscription
set visits_remaining = greatest(usage.visits_count - usage.used_visits, 0)
from usage
where subscription.id = usage.subscription_id;

-- Для ещё не завершённых записей действующего клиента сохраняем основание
-- бесплатного допуска, но намеренно отвязываем расходный абонемент.
with eligible as (
  select distinct on (booking.id)
    booking.id as booking_id,
    subscription.id as subscription_id
  from public.bookings booking
  join public.schedule_sessions session on session.id = booking.session_id
  join public.user_subscriptions subscription on subscription.user_id = booking.user_id
  join public.subscription_plans plan on plan.id = subscription.plan_id
  where session.session_kind = 'workshop'
    and booking.status in ('booked', 'cancelled')
    and plan.product_kind = 'fitness'
    and plan.plan_format in ('group', 'individual', 'split')
    and subscription.is_active = true
    and coalesce(subscription.visits_remaining, 0) > 0
    and (subscription.start_date is null or subscription.start_date <= (session.start_time at time zone 'Asia/Almaty')::date)
    and (subscription.end_date is null or subscription.end_date >= (session.start_time at time zone 'Asia/Almaty')::date)
  order by booking.id, subscription.created_at asc
)
update public.bookings booking
set access_type = 'workshop_member_free',
    eligibility_subscription_id = eligible.subscription_id,
    subscription_id = null
from eligible
where booking.id = eligible.booking_id
  and booking.access_type <> 'workshop_paid';

comment on column public.bookings.access_type is
  'Источник допуска: обычный абонемент, бесплатный мастер-класс для действующего клиента, платный пропуск или комплимент.';

comment on column public.bookings.eligibility_subscription_id is
  'Абонемент, подтвердивший бесплатное право на мастер-класс; посещение из него не списывается.';
