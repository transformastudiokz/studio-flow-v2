alter table public.schedule_sessions
  add column if not exists public_description text;

comment on column public.schedule_sessions.public_description is
  'Короткое описание конкретного занятия или мастер-класса для клиентского кабинета.';

insert into public.class_types (name, description, duration_min, color)
select
  'Индивидуальное занятие',
  'Персональное занятие с тренером.',
  60,
  '#7D917F'
where not exists (
  select 1 from public.class_types where lower(trim(name)) = lower('Индивидуальное занятие')
);

insert into public.class_types (name, description, duration_min, color)
select
  'Мастер-класс',
  'Специальное мероприятие студии. Подробности указаны в карточке конкретного мастер-класса.',
  60,
  '#C89C55'
where not exists (
  select 1 from public.class_types where lower(trim(name)) = lower('Мастер-класс')
);
