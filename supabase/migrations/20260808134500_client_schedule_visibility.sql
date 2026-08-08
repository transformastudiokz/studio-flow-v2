alter table public.schedule_sessions
  add column if not exists is_client_visible boolean not null default true;

update public.schedule_sessions session
set is_client_visible = false
from public.class_types class_type
where class_type.id = session.class_type_id
  and lower(class_type.name) like '%аренд%';

comment on column public.schedule_sessions.is_client_visible is
  'Показывать ли занятие в расписании и личном кабинете клиентов';

create index if not exists schedule_sessions_client_visible_start_idx
  on public.schedule_sessions (is_client_visible, start_time);

drop policy if exists "Role based read schedule" on public.schedule_sessions;
create policy "Role based read schedule"
  on public.schedule_sessions for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'client' and is_client_visible = true
    )
    or exists (
      select 1 from public.coaches c
      where c.id = coach_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Client create booking" on public.bookings;
create policy "Client create booking"
  on public.bookings for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.schedule_sessions ss
      where ss.id = session_id
        and ss.booking_status = 'open'
        and ss.is_client_visible = true
        and ss.start_time > now()
    )
  );
