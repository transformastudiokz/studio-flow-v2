-- Восстанавливаем ошибочно выключенные абонементы, у которых есть остаток
-- и срок ещё не закончился. Истёкшие и полностью использованные не оживляем.
update public.user_subscriptions
set is_active = true
where is_active = false
  and (visits_total is null or coalesce(visits_remaining, 0) > 0)
  and (end_date is null or end_date >= current_date);

create or replace function public.sync_subscription_activity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_active := (new.visits_total is null or coalesce(new.visits_remaining, 0) > 0)
    and (new.end_date is null or new.end_date >= current_date);
  return new;
end;
$$;

drop trigger if exists sync_subscription_activity_on_write on public.user_subscriptions;
create trigger sync_subscription_activity_on_write
before insert or update of visits_total, visits_remaining, end_date
on public.user_subscriptions
for each row execute function public.sync_subscription_activity();
