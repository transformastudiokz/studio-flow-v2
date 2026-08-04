begin;

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and is_active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'owner')
      and is_active = true
  );
$$;

update public.profiles
set is_active = false
where email in ('87009672204@balance.kz', '77712124114@balance.kz')
  and id <> '5592b61b-8788-4f76-ad7d-44d63ce8ea26';

commit;
