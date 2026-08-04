create table if not exists public.cash_transaction_comments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.cash_transactions(id) on delete cascade,
  comment text not null check (nullif(trim(comment), '') is not null),
  author_user_id uuid references public.profiles(id) default auth.uid(),
  source_correction_id uuid unique,
  created_at timestamptz not null default now()
);

create index if not exists cash_transaction_comments_transaction_idx
  on public.cash_transaction_comments(transaction_id, created_at);

alter table public.cash_transaction_comments enable row level security;
grant select, insert on public.cash_transaction_comments to authenticated;
revoke update, delete on public.cash_transaction_comments from authenticated;

drop policy if exists "Staff read cash comments" on public.cash_transaction_comments;
create policy "Staff read cash comments"
  on public.cash_transaction_comments for select
  using (public.is_admin());

drop policy if exists "Staff add cash comments" on public.cash_transaction_comments;
create policy "Staff add cash comments"
  on public.cash_transaction_comments for insert
  with check (
    public.is_admin()
    and author_user_id = auth.uid()
  );

create or replace function public.prevent_cash_comment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Cash comments are immutable. Add a new comment instead.';
end;
$$;

drop trigger if exists cash_comments_immutable on public.cash_transaction_comments;
create trigger cash_comments_immutable
before update or delete on public.cash_transaction_comments
for each row execute function public.prevent_cash_comment_mutation();

-- Move the two confirmed duplicate corrections into comments on their source sales.
insert into public.cash_transaction_comments (
  transaction_id,
  comment,
  author_user_id,
  source_correction_id,
  created_at
)
select
  correction.related_transaction_id,
  correction.notes,
  correction.responsible_user_id,
  correction.id,
  correction.occurred_at
from public.cash_transactions correction
join public.cash_transactions source
  on source.id = correction.related_transaction_id
where correction.id in (
  '4fedb456-c11c-43f2-832b-d15acdc4628f',
  '4ba3bcb3-69c7-4479-acb5-9186fe66ecb3'
)
  and correction.operation_type = 'correction'
  and correction.amount = 3500
  and nullif(trim(correction.notes), '') is not null
  and source.operation_type = 'sale'
  and source.amount = 3500
on conflict (source_correction_id) do nothing;

alter table public.cash_transactions disable trigger cash_transactions_immutable;

delete from public.cash_transactions correction
where correction.id in (
  '4fedb456-c11c-43f2-832b-d15acdc4628f',
  '4ba3bcb3-69c7-4479-acb5-9186fe66ecb3'
)
  and correction.operation_type = 'correction'
  and correction.amount = 3500
  and exists (
    select 1
    from public.cash_transaction_comments comment
    where comment.source_correction_id = correction.id
      and comment.transaction_id = correction.related_transaction_id
  );

alter table public.cash_transactions enable trigger cash_transactions_immutable;
