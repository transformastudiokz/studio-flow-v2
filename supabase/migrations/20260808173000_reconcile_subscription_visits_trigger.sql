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
    set visits_remaining = greatest(
      0,
      us.visits_total - (
        select count(*)::integer
        from public.bookings b
        where b.subscription_id = old.subscription_id
          and b.status in ('completed', 'absent', 'late_cancel')
      )
    )
    where us.id = old.subscription_id
      and us.visits_total is not null;
  end if;

  if target_subscription_id is not null then
    update public.user_subscriptions us
    set visits_remaining = greatest(
      0,
      us.visits_total - (
        select count(*)::integer
        from public.bookings b
        where b.subscription_id = target_subscription_id
          and b.status in ('completed', 'absent', 'late_cancel')
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

-- Исправляем накопленные остатки по тому же правилу. Повторный запуск безопасен.
update public.user_subscriptions us
set visits_remaining = greatest(
  0,
  us.visits_total - (
    select count(*)::integer
    from public.bookings b
    where b.subscription_id = us.id
      and b.status in ('completed', 'absent', 'late_cancel')
  )
)
where us.visits_total is not null;
