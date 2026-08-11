begin;

create table if not exists public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category text not null default 'rental' check (category in ('rental')),
  name text not null,
  room text not null check (room in ('Большой зал', 'Малый зал')),
  duration_minutes integer not null check (duration_minutes > 0),
  list_price numeric(12,2) not null check (list_price >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_catalog (code, name, room, duration_minutes, list_price)
values
  ('rental-small-60', 'Аренда малого зала · 60 минут', 'Малый зал', 60, 6500),
  ('rental-small-90', 'Аренда малого зала · 90 минут', 'Малый зал', 90, 10000),
  ('rental-large-60', 'Аренда большого зала · 60 минут', 'Большой зал', 60, 7500),
  ('rental-large-90', 'Аренда большого зала · 90 минут', 'Большой зал', 90, 11000)
on conflict (code) do update set
  name = excluded.name,
  room = excluded.room,
  duration_minutes = excluded.duration_minutes,
  list_price = excluded.list_price;

alter table public.schedule_sessions
  add column if not exists session_kind text not null default 'fitness';
alter table public.schedule_sessions drop constraint if exists schedule_sessions_session_kind_check;
alter table public.schedule_sessions add constraint schedule_sessions_session_kind_check
  check (session_kind in ('fitness', 'rental'));

-- A rental is a contractual booking for a specific room. Unlike a fitness
-- class it must never be silently moved to the other room.
create or replace function public.enforce_schedule_session_conflicts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  conflicting public.schedule_sessions%rowtype;
begin
  if new.end_time <= new.start_time then
    raise exception 'Время окончания должно быть позже начала';
  end if;
  if new.booking_status = 'cancelled' or coalesce(new.is_cancelled, false) then return new; end if;
  perform pg_advisory_xact_lock(hashtext('balance_schedule_conflicts')::bigint);
  select * into conflicting from public.schedule_sessions existing
   where existing.id <> new.id and existing.booking_status <> 'cancelled'
     and not coalesce(existing.is_cancelled, false)
     and existing.start_time < new.end_time and existing.end_time > new.start_time
     and existing.room = new.room limit 1;
  if found then
    if new.session_kind = 'rental' then
      raise exception 'Зал уже занят в это время (% – %)',
        to_char(conflicting.start_time at time zone 'Asia/Almaty', 'HH24:MI'),
        to_char(conflicting.end_time at time zone 'Asia/Almaty', 'HH24:MI');
    elsif new.room = 'Большой зал' and not exists (
      select 1 from public.schedule_sessions small_room
       where small_room.id <> new.id and small_room.booking_status <> 'cancelled'
         and not coalesce(small_room.is_cancelled, false)
         and small_room.start_time < new.end_time and small_room.end_time > new.start_time
         and small_room.room = 'Малый зал'
    ) then new.room := 'Малый зал';
    else raise exception 'Все доступные залы уже заняты в это время'; end if;
  end if;
  if new.coach_id is not null and exists (
    select 1 from public.schedule_sessions existing
     where existing.id <> new.id and existing.booking_status <> 'cancelled'
       and not coalesce(existing.is_cancelled, false)
       and existing.start_time < new.end_time and existing.end_time > new.start_time
       and existing.coach_id = new.coach_id
  ) then raise exception 'У тренера уже есть занятие в это время'; end if;
  return new;
end; $$;

create table if not exists public.rental_bookings (
  id uuid primary key default gen_random_uuid(),
  schedule_session_id uuid not null unique references public.schedule_sessions(id) on delete restrict,
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  renter_id uuid not null references public.profiles(id) on delete restrict,
  booked_at timestamptz not null default now(),
  agreed_price numeric(12,2) not null check (agreed_price >= 0),
  rental_status text not null default 'reserved' check (rental_status in ('reserved','confirmed','completed','cancelled')),
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rental_bookings add column if not exists operation_key text;
create unique index if not exists rental_bookings_operation_key_idx
  on public.rental_bookings(operation_key) where operation_key is not null;
create index if not exists rental_bookings_renter_idx on public.rental_bookings(renter_id);
create index if not exists rental_bookings_service_idx on public.rental_bookings(service_id);

alter table public.cash_transactions
  add column if not exists rental_booking_id uuid references public.rental_bookings(id) on delete restrict,
  add column if not exists payment_method text,
  add column if not exists idempotency_key text;
alter table public.cash_transactions drop constraint if exists cash_transactions_payment_method_check;
alter table public.cash_transactions add constraint cash_transactions_payment_method_check
  check (payment_method is null or payment_method in ('kaspi','halyk','cash','bank_account'));
alter table public.cash_transactions drop constraint if exists cash_transactions_operation_type_check;
alter table public.cash_transactions add constraint cash_transactions_operation_type_check
  check (operation_type in ('sale','upgrade','refund','correction','manual','rental_payment','rental_refund'));
create index if not exists cash_transactions_rental_idx on public.cash_transactions(rental_booking_id, occurred_at desc);
create unique index if not exists cash_transactions_idempotency_idx
  on public.cash_transactions(idempotency_key) where idempotency_key is not null;

create table if not exists public.rental_change_log (
  id uuid primary key default gen_random_uuid(),
  rental_booking_id uuid not null references public.rental_bookings(id) on delete restrict,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  action text not null,
  old_data jsonb,
  new_data jsonb,
  reason text
);

create or replace view public.rental_booking_financials as
select
  rb.id as rental_booking_id,
  rb.schedule_session_id,
  rb.service_id,
  rb.renter_id,
  rb.agreed_price,
  coalesce(sum(ct.amount) filter (where ct.operation_type in ('rental_payment','rental_refund')), 0)::numeric(12,2) as paid_amount,
  greatest(rb.agreed_price - coalesce(sum(ct.amount) filter (where ct.operation_type in ('rental_payment','rental_refund')), 0), 0)::numeric(12,2) as debt_amount,
  case
    when coalesce(sum(ct.amount) filter (where ct.operation_type in ('rental_payment','rental_refund')), 0) <= 0 then 'unpaid'
    when coalesce(sum(ct.amount) filter (where ct.operation_type in ('rental_payment','rental_refund')), 0) < rb.agreed_price then 'partial'
    else 'paid'
  end as payment_status
from public.rental_bookings rb
left join public.cash_transactions ct on ct.rental_booking_id = rb.id
group by rb.id;

create or replace view public.client_rental_analytics as
select
  rb.renter_id,
  count(*) filter (where rb.rental_status <> 'cancelled')::integer as rentals_total,
  count(*) filter (where rb.rental_status <> 'cancelled' and ss.end_time <= now())::integer as completed_count,
  count(*) filter (where rb.rental_status <> 'cancelled' and ss.start_time > now())::integer as upcoming_count,
  count(*) filter (where rb.rental_status = 'cancelled')::integer as cancelled_count,
  coalesce(sum(extract(epoch from (ss.end_time - ss.start_time)) / 60) filter (where rb.rental_status <> 'cancelled'), 0)::integer as rental_minutes_total,
  coalesce(sum(rb.agreed_price) filter (where rb.rental_status <> 'cancelled'), 0)::numeric(12,2) as agreed_total,
  coalesce(sum(rbf.paid_amount) filter (where rb.rental_status <> 'cancelled'), 0)::numeric(12,2) as paid_total,
  coalesce(sum(rbf.debt_amount) filter (where rb.rental_status <> 'cancelled'), 0)::numeric(12,2) as debt_total,
  max(ss.start_time) filter (where ss.start_time <= now() and rb.rental_status <> 'cancelled') as last_rental_at,
  min(ss.start_time) filter (where ss.start_time > now() and rb.rental_status <> 'cancelled') as next_rental_at
from public.rental_bookings rb
join public.schedule_sessions ss on ss.id = rb.schedule_session_id
join public.rental_booking_financials rbf on rbf.rental_booking_id = rb.id
group by rb.renter_id;

alter view public.rental_booking_financials set (security_invoker = true);
alter view public.client_rental_analytics set (security_invoker = true);

alter table public.service_catalog enable row level security;
alter table public.rental_bookings enable row level security;
alter table public.rental_change_log enable row level security;
grant select on public.service_catalog, public.rental_bookings, public.rental_booking_financials, public.client_rental_analytics to authenticated;
grant select, insert, update on public.service_catalog, public.rental_bookings to authenticated;
grant select on public.rental_change_log to authenticated;

drop policy if exists "Staff manage service catalog" on public.service_catalog;
drop policy if exists "Staff read service catalog" on public.service_catalog;
drop policy if exists "Owner manage service catalog" on public.service_catalog;
create policy "Staff read service catalog" on public.service_catalog for select
  using (public.is_admin());
create policy "Owner manage service catalog" on public.service_catalog for all
  using (exists(select 1 from public.profiles where id=auth.uid() and role='owner' and is_active=true))
  with check (exists(select 1 from public.profiles where id=auth.uid() and role='owner' and is_active=true));
drop policy if exists "Staff manage rentals" on public.rental_bookings;
create policy "Staff manage rentals" on public.rental_bookings for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Staff read rental audit" on public.rental_change_log;
create policy "Staff read rental audit" on public.rental_change_log for select using (public.is_admin());

create or replace function public.record_rental_payment(
  p_rental_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_at timestamptz,
  p_note text default null,
  p_idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rental_row public.rental_bookings%rowtype;
  service_row public.service_catalog%rowtype;
  current_paid numeric(12,2);
  tx_id uuid;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment must be positive'; end if;
  if p_method is null or p_method not in ('kaspi','halyk','cash','bank_account') then raise exception 'Unsupported payment method'; end if;
  select * into rental_row from public.rental_bookings where id = p_rental_id for update;
  if rental_row.id is null then raise exception 'Rental not found'; end if;
  if p_idempotency_key is not null then
    select id into tx_id from public.cash_transactions where idempotency_key = p_idempotency_key
      and rental_booking_id=p_rental_id and amount=p_amount and payment_method=p_method;
    if tx_id is not null then return tx_id; end if;
    if exists(select 1 from public.cash_transactions where idempotency_key=p_idempotency_key) then
      raise exception 'Повтор операции содержит другие параметры';
    end if;
  end if;
  select * into service_row from public.service_catalog where id = rental_row.service_id;
  select coalesce(sum(amount),0) into current_paid from public.cash_transactions
    where rental_booking_id = p_rental_id and operation_type in ('rental_payment','rental_refund');
  if current_paid + p_amount > rental_row.agreed_price then raise exception 'Payment exceeds rental debt'; end if;
  insert into public.cash_transactions (
    occurred_at, operation_type, client_id, rental_booking_id, title, amount,
    responsible_user_id, payment_method, notes, idempotency_key
  ) values (
    coalesce(p_paid_at, now()), 'rental_payment', rental_row.renter_id, rental_row.id,
    service_row.name, p_amount, auth.uid(), p_method, nullif(trim(p_note),''), p_idempotency_key
  ) returning id into tx_id;
  return tx_id;
end; $$;
grant execute on function public.record_rental_payment(uuid,numeric,text,timestamptz,text,text) to authenticated;

create or replace function public.upsert_rental_booking(
  p_rental_id uuid,
  p_session_id uuid,
  p_class_type_id uuid,
  p_service_id uuid,
  p_renter_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_room text,
  p_agreed_price numeric,
  p_client_visible boolean default false,
  p_notes text default null,
  p_initial_payment numeric default 0,
  p_payment_method text default null,
  p_paid_at timestamptz default null,
  p_payment_note text default null,
  p_idempotency_key text default null,
  p_rental_status text default 'confirmed',
  p_status_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  service_row public.service_catalog%rowtype;
  session_id uuid;
  rental_id uuid;
  existing_rental public.rental_bookings%rowtype;
  paid_total numeric(12,2);
  repeated_rental public.rental_bookings%rowtype;
  repeated_session public.schedule_sessions%rowtype;
  repeated_payment public.cash_transactions%rowtype;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if p_renter_id is null then raise exception 'Выбери арендатора'; end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then raise exception 'Некорректное время аренды'; end if;
  if p_agreed_price is null or p_agreed_price < 0 then raise exception 'Некорректная стоимость'; end if;
  if coalesce(p_initial_payment, 0) < 0 then raise exception 'Первоначальная оплата не может быть отрицательной'; end if;
  if p_rental_status not in ('reserved','confirmed','completed','cancelled') then raise exception 'Некорректный статус аренды'; end if;
  select * into service_row from public.service_catalog where id = p_service_id and is_active = true;
  if service_row.id is null then raise exception 'Услуга не найдена или отключена'; end if;
  if service_row.room <> p_room then raise exception 'Зал не соответствует выбранной услуге'; end if;
  if extract(epoch from (p_end_at-p_start_at))/60 <> service_row.duration_minutes then raise exception 'Продолжительность не соответствует выбранной услуге'; end if;
  if not exists(select 1 from public.profiles where id=p_renter_id and role='client' and is_active=true) then raise exception 'Арендатор должен быть активным клиентом'; end if;

  if p_rental_id is null and p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext('rental-operation-' || p_idempotency_key)::bigint);
    select * into repeated_rental from public.rental_bookings where operation_key=p_idempotency_key;
    if repeated_rental.id is not null then
      select * into repeated_session from public.schedule_sessions where id=repeated_rental.schedule_session_id;
      select * into repeated_payment from public.cash_transactions
        where idempotency_key=p_idempotency_key and rental_booking_id=repeated_rental.id
        order by created_at limit 1;
      if repeated_rental.service_id<>p_service_id
        or repeated_rental.renter_id<>p_renter_id
        or repeated_rental.agreed_price<>p_agreed_price
        or repeated_rental.rental_status<>p_rental_status
        or repeated_rental.notes is distinct from nullif(trim(p_notes),'')
        or repeated_session.class_type_id<>p_class_type_id
        or repeated_session.start_time<>p_start_at
        or repeated_session.end_time<>p_end_at
        or repeated_session.room<>p_room
        or repeated_session.is_client_visible<>coalesce(p_client_visible,false)
        or repeated_session.booking_closed_reason is distinct from coalesce(nullif(trim(p_status_reason),''),'Аренда зала')
        or (coalesce(p_initial_payment,0)=0 and repeated_payment.id is not null)
        or (coalesce(p_initial_payment,0)>0 and (
          repeated_payment.id is null
          or repeated_payment.amount<>p_initial_payment
          or repeated_payment.payment_method is distinct from p_payment_method
          or repeated_payment.occurred_at<>p_paid_at
          or repeated_payment.notes is distinct from nullif(trim(p_payment_note),'')
        )) then
        raise exception 'Повтор операции содержит другие параметры';
      end if;
      return repeated_rental.id;
    end if;
  end if;

  if p_rental_id is not null then
    select * into existing_rental from public.rental_bookings where id=p_rental_id for update;
    if existing_rental.id is null then raise exception 'Аренда не найдена'; end if;
    select coalesce(sum(amount),0) into paid_total from public.cash_transactions where rental_booking_id=p_rental_id;
    if exists(select 1 from public.cash_transactions where rental_booking_id=p_rental_id and operation_type='rental_payment')
       and existing_rental.renter_id <> p_renter_id then raise exception 'После оплаты арендатора менять нельзя'; end if;
    if p_agreed_price < paid_total then raise exception 'Стоимость не может быть меньше уже оплаченной суммы'; end if;
  end if;

  if p_session_id is null then
    insert into public.schedule_sessions(class_type_id,coach_id,start_time,end_time,capacity,room,booking_status,is_cancelled,booking_closed_reason,is_client_visible,session_kind)
    values(p_class_type_id,null,p_start_at,p_end_at,1,p_room,
      case when p_rental_status='cancelled' then 'cancelled' else 'closed' end,
      (p_rental_status='cancelled'),coalesce(nullif(trim(p_status_reason),''),'Аренда зала'),coalesce(p_client_visible,false),'rental')
    returning id into session_id;
  else
    update public.schedule_sessions set class_type_id=p_class_type_id,coach_id=null,start_time=p_start_at,end_time=p_end_at,
      capacity=1,room=p_room,is_client_visible=coalesce(p_client_visible,false),session_kind='rental',
      booking_status=case when p_rental_status='cancelled' then 'cancelled' else 'closed' end,
      is_cancelled=(p_rental_status='cancelled'), booking_closed_reason=coalesce(nullif(trim(p_status_reason),''),'Аренда зала')
    where id=p_session_id returning id into session_id;
    if session_id is null then raise exception 'Бронь в расписании не найдена'; end if;
  end if;

  if p_rental_id is null then
    insert into public.rental_bookings(schedule_session_id,service_id,renter_id,agreed_price,rental_status,notes,created_by,updated_by,operation_key)
    values(session_id,p_service_id,p_renter_id,p_agreed_price,p_rental_status,nullif(trim(p_notes),''),auth.uid(),auth.uid(),p_idempotency_key)
    returning id into rental_id;
  else
    update public.rental_bookings set service_id=p_service_id,renter_id=p_renter_id,agreed_price=p_agreed_price,
      rental_status=p_rental_status,notes=nullif(trim(p_notes),''),updated_by=auth.uid(),updated_at=now()
    where id=p_rental_id and schedule_session_id=session_id returning id into rental_id;
    if rental_id is null then raise exception 'Аренда не найдена'; end if;
  end if;

  -- The booking and its first/next payment must succeed or fail together.
  -- This prevents a half-created rental when the cash operation is rejected.
  if coalesce(p_initial_payment, 0) > 0 then
    perform public.record_rental_payment(
      rental_id,
      p_initial_payment,
      p_payment_method,
      p_paid_at,
      p_payment_note,
      p_idempotency_key
    );
  end if;
  return rental_id;
end; $$;
grant execute on function public.upsert_rental_booking(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,numeric,boolean,text,numeric,text,timestamptz,text,text,text,text) to authenticated;

create or replace function public.refund_rental_payment(
  p_transaction_id uuid, p_amount numeric, p_method text, p_occurred_at timestamptz, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare source_tx public.cash_transactions%rowtype; refunded numeric; tx_id uuid;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Сумма возврата должна быть больше нуля'; end if;
  if p_method is null or p_method not in ('kaspi','halyk','cash','bank_account') then raise exception 'Выбери способ возврата'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Укажи причину возврата'; end if;
  select * into source_tx from public.cash_transactions where id=p_transaction_id and operation_type='rental_payment' for update;
  if source_tx.id is null then raise exception 'Платёж аренды не найден'; end if;
  select coalesce(abs(sum(amount)),0) into refunded from public.cash_transactions where related_transaction_id=source_tx.id and operation_type='rental_refund';
  if refunded + p_amount > source_tx.amount then raise exception 'Возврат превышает доступную сумму'; end if;
  insert into public.cash_transactions(occurred_at,operation_type,client_id,rental_booking_id,title,amount,responsible_user_id,related_transaction_id,payment_method,notes)
  values(coalesce(p_occurred_at,now()),'rental_refund',source_tx.client_id,source_tx.rental_booking_id,'Возврат: '||source_tx.title,-abs(p_amount),auth.uid(),source_tx.id,p_method,nullif(trim(p_reason),''))
  returning id into tx_id;
  return tx_id;
end; $$;
grant execute on function public.refund_rental_payment(uuid,numeric,text,timestamptz,text) to authenticated;

create or replace function public.correct_rental_payment(
  p_transaction_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_new_occurred_at timestamptz,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  source_tx public.cash_transactions%rowtype;
  already_refunded numeric(12,2);
  remaining_amount numeric(12,2);
  refund_id uuid;
  replacement_id uuid;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if p_new_amount is null or p_new_amount <= 0 then raise exception 'Новая сумма должна быть больше нуля'; end if;
  if p_new_method not in ('kaspi','halyk','cash','bank_account') then raise exception 'Выбери способ оплаты'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Укажи причину корректировки'; end if;

  select * into source_tx
  from public.cash_transactions
  where id = p_transaction_id and operation_type = 'rental_payment'
  for update;
  if source_tx.id is null then raise exception 'Платёж аренды не найден'; end if;

  select coalesce(abs(sum(amount)), 0)
  into already_refunded
  from public.cash_transactions
  where related_transaction_id = source_tx.id and operation_type = 'rental_refund';
  remaining_amount := source_tx.amount - already_refunded;
  if remaining_amount <= 0 then raise exception 'Этот платёж уже полностью возвращён или скорректирован'; end if;

  refund_id := public.refund_rental_payment(
    source_tx.id,
    remaining_amount,
    source_tx.payment_method,
    now(),
    'Сторно перед корректировкой: ' || trim(p_reason)
  );
  replacement_id := public.record_rental_payment(
    source_tx.rental_booking_id,
    p_new_amount,
    p_new_method,
    coalesce(p_new_occurred_at, source_tx.occurred_at),
    'Корректировка: ' || trim(p_reason),
    'rental-correction-' || source_tx.id::text || '-' || refund_id::text
  );

  return replacement_id;
end; $$;
grant execute on function public.correct_rental_payment(uuid,numeric,text,timestamptz,text) to authenticated;

create or replace function public.log_rental_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.rental_change_log(rental_booking_id, changed_by, action, old_data, new_data)
  values (new.id, auth.uid(), case when tg_op='INSERT' then 'created' else 'updated' end,
    case when tg_op='UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end; $$;
drop trigger if exists rental_change_audit on public.rental_bookings;
create trigger rental_change_audit after insert or update on public.rental_bookings
for each row execute function public.log_rental_change();

commit;
