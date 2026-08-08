begin;

alter table public.subscription_plans
  add column if not exists is_visible_in_client_portal boolean not null default true;

comment on column public.subscription_plans.is_visible_in_client_portal is
  'Controls whether an active plan is listed in the client portal pricing screen.';

create index if not exists subscription_plans_client_portal_visible_idx
  on public.subscription_plans (is_visible_in_client_portal, is_active, price);

commit;
