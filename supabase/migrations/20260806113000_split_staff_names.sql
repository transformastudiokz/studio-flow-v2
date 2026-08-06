alter table public.profiles
  add column if not exists middle_name text;

with parsed as (
  select user_id, regexp_split_to_array(btrim(name), '\s+') as parts
  from public.coaches
  where user_id is not null
)
update public.profiles p
set first_name = parsed.parts[2],
    last_name = parsed.parts[1],
    middle_name = nullif(array_to_string(parsed.parts[3:array_length(parsed.parts, 1)], ' '), '')
from parsed
where p.id = parsed.user_id
  and p.role = 'trainer'
  and array_length(parsed.parts, 1) >= 2;

with legacy as (
  select id, first_name as old_surname,
         regexp_split_to_array(btrim(last_name), '\s+') as parts
  from public.profiles
  where role in ('owner', 'admin')
    and middle_name is null
    and btrim(coalesce(last_name, '')) ~ '\s'
)
update public.profiles p
set first_name = legacy.parts[1],
    last_name = legacy.old_surname,
    middle_name = nullif(array_to_string(legacy.parts[2:array_length(legacy.parts, 1)], ' '), '')
from legacy
where p.id = legacy.id;
