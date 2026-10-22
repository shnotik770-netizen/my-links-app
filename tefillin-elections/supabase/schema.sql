-- Mivtza Tefillin election-day scheduler – Supabase schema (project "toranim-system").
-- Applied as migrations tefillin_1 … tefillin_7. Kept here as the readable reference.
--
-- Security model:
--   * All objects are prefixed tefillin_ and isolated from the project's other tables.
--   * RLS is on and anon/authenticated have NO grants on tables or functions.
--   * The only way in is the "tefillin" Edge Function, which uses the service role and
--     calls the functions below. The website never holds a Supabase key.
--   * The admin password is stored as a bcrypt hash (settings key 'admin_password');
--     it is set directly in the database and never committed to the repo.

-- ===== Tables =====

create table public.tefillin_stations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  address text not null default '' check (length(address) <= 200),
  notes text not null default '' check (length(notes) <= 500),
  slots text[] not null default '{}',
  manager_name text not null default '' check (length(manager_name) <= 60),
  manager_phone text not null default '' check (manager_phone = '' or manager_phone ~ '^0\d{8,9}$'),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.tefillin_signups (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.tefillin_stations(id) on delete cascade,
  slot text not null,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  unique (station_id, slot) -- one volunteer per station per hour; also blocks double-booking races
);
create index tefillin_signups_phone_slot_idx on public.tefillin_signups (phone, slot);

-- key 'admin_password' (bcrypt hash), key 'ticker' (JSON array of banner sentences)
create table public.tefillin_settings (key text primary key, value text not null);

alter table public.tefillin_stations enable row level security;
alter table public.tefillin_signups enable row level security;
alter table public.tefillin_settings enable row level security;
revoke all on public.tefillin_stations, public.tefillin_signups, public.tefillin_settings from anon, authenticated;

-- ===== Helpers =====

-- Possible shift hours: 08:00-18:00 in 1-hour slots. Each station enables a subset (new stations: 09-13).
create function public.tefillin_all_slots() returns text[]
language sql immutable set search_path = '' as $$
  select array(select lpad(h::text, 2, '0') || ':00-' || lpad((h + 1)::text, 2, '0') || ':00' from generate_series(8, 17) h)
$$;

create function public.tefillin_check_admin(p_password text) returns void
language plpgsql set search_path = public, extensions as $$
declare v_hash text;
begin
  select value into v_hash from tefillin_settings where key = 'admin_password';
  if v_hash is null or p_password is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'סיסמה שגויה';
  end if;
end $$;

-- Full name (2+ words) and an Israeli phone number are required for every signup.
create function public.tefillin_clean_person(p_name text, p_phone text, out name text, out phone text)
language plpgsql set search_path = '' as $$
begin
  name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 60);
  phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if (select count(*) from unnest(string_to_array(name, ' ')) w where length(w) > 1) < 2 then
    raise exception 'יש להזין שם מלא (שם פרטי ושם משפחה)';
  end if;
  if phone !~ '^0\d{8,9}$' then
    raise exception 'מספר טלפון לא תקין';
  end if;
end $$;

create function public.tefillin_ticker() returns jsonb
language sql stable set search_path = public as $$
  select coalesce((select value::jsonb from tefillin_settings where key = 'ticker'), '[]'::jsonb)
$$;

-- ===== Public actions =====

create function public.tefillin_get_public() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('ticker', tefillin_ticker(), 'stations', coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'address', s.address, 'notes', s.notes,
    -- The station manager's contact is public on purpose (WhatsApp button for volunteers).
    'managerName', s.manager_name, 'managerPhone', s.manager_phone,
    'slots', (
      -- Only the volunteer's name is public; volunteer phone numbers are admin-only.
      select coalesce(jsonb_agg(jsonb_build_object('slot', sl, 'name', coalesce(g.name, '')) order by sl), '[]'::jsonb)
      from unnest(s.slots) sl
      left join tefillin_signups g on g.station_id = s.id and g.slot = sl
    )
  ) order by s.position, s.created_at), '[]'::jsonb))
  from tefillin_stations s
$$;

create function public.tefillin_signup(p_station_id uuid, p_slot text, p_name text, p_phone text) returns jsonb
language plpgsql set search_path = public as $$
declare v record; v_station tefillin_stations;
begin
  v := tefillin_clean_person(p_name, p_phone);
  select * into v_station from tefillin_stations where id = p_station_id;
  if not found then raise exception 'הקלפי לא נמצאה'; end if;
  if not (p_slot = any (v_station.slots)) then raise exception 'המשמרת אינה פעילה בקלפי זו'; end if;
  if exists (select 1 from tefillin_signups where phone = v.phone and slot = p_slot) then
    raise exception 'מספר הטלפון הזה כבר רשום למשמרת בשעה זו בקלפי אחרת';
  end if;
  begin
    insert into tefillin_signups (station_id, slot, name, phone) values (p_station_id, p_slot, v.name, v.phone);
  exception when unique_violation then
    raise exception 'מצטערים, המשמרת הזו נתפסה כרגע. אנא בחרו משמרת אחרת.';
  end;
  return jsonb_build_object('station', v_station.name, 'slot', p_slot);
end $$;

-- ===== Admin actions (all check the password first) =====
-- Deleting a station / cancelling a signup is done by the Edge Function (password check + REST delete).

create function public.tefillin_login(p_password text) returns jsonb
language plpgsql set search_path = public as $$
begin
  perform tefillin_check_admin(p_password);
  return '{}'::jsonb;
end $$;

create function public.tefillin_get_admin(p_password text) returns jsonb
language plpgsql set search_path = public as $$
begin
  perform tefillin_check_admin(p_password);
  return jsonb_build_object(
    'allSlots', to_jsonb(tefillin_all_slots()),
    'ticker', tefillin_ticker(),
    'stations', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'address', address, 'notes', notes, 'slots', to_jsonb(slots),
        'managerName', manager_name, 'managerPhone', manager_phone
      ) order by position, created_at), '[]'::jsonb) from tefillin_stations),
    'signups', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'stationId', station_id, 'slot', slot, 'name', name, 'phone', phone,
        'createdAt', to_char(created_at at time zone 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI')
      ) order by created_at), '[]'::jsonb) from tefillin_signups)
  );
end $$;

create function public.tefillin_save_station(p_password text, p_station jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_id uuid := nullif(p_station->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_station->>'name', ''));
  v_slots text[] := array(
    select s from unnest(tefillin_all_slots()) s
    where s in (select jsonb_array_elements_text(coalesce(p_station->'slots', '[]'::jsonb)))
  );
  v_mgr_name text := left(btrim(coalesce(p_station->>'managerName', '')), 60);
  v_mgr_phone text := regexp_replace(coalesce(p_station->>'managerPhone', ''), '\D', '', 'g');
begin
  perform tefillin_check_admin(p_password);
  if v_name = '' then raise exception 'יש להזין שם לקלפי'; end if;
  if v_mgr_phone <> '' and v_mgr_phone !~ '^0\d{8,9}$' then raise exception 'מספר הטלפון של מנהל הקלפי לא תקין'; end if;
  if v_id is null then
    insert into tefillin_stations (name, address, notes, slots, manager_name, manager_phone, position)
    values (left(v_name, 100), left(btrim(coalesce(p_station->>'address', '')), 200),
            left(btrim(coalesce(p_station->>'notes', '')), 500), v_slots, v_mgr_name, v_mgr_phone,
            coalesce((select max(position) + 1 from tefillin_stations), 0))
    returning id into v_id;
  else
    update tefillin_stations set
      name = left(v_name, 100),
      address = left(btrim(coalesce(p_station->>'address', '')), 200),
      notes = left(btrim(coalesce(p_station->>'notes', '')), 500),
      slots = v_slots,
      manager_name = v_mgr_name,
      manager_phone = v_mgr_phone
    where id = v_id;
    if not found then raise exception 'הקלפי לא נמצאה'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Put a volunteer in a slot, replacing whoever is there (assign + edit).
create function public.tefillin_admin_set_slot(p_password text, p_station_id uuid, p_slot text, p_name text, p_phone text) returns jsonb
language plpgsql set search_path = public as $$
declare v record;
begin
  perform tefillin_check_admin(p_password);
  v := tefillin_clean_person(p_name, p_phone);
  if not exists (select 1 from tefillin_stations where id = p_station_id) then raise exception 'הקלפי לא נמצאה'; end if;
  if not (p_slot = any (tefillin_all_slots())) then raise exception 'משמרת לא תקינה'; end if;
  insert into tefillin_signups (station_id, slot, name, phone) values (p_station_id, p_slot, v.name, v.phone)
  on conflict (station_id, slot) do update set name = excluded.name, phone = excluded.phone, created_at = now();
  return '{}'::jsonb;
end $$;

create function public.tefillin_change_password(p_password text, p_new_password text) returns jsonb
language plpgsql set search_path = public, extensions as $$
begin
  perform tefillin_check_admin(p_password);
  if length(coalesce(p_new_password, '')) < 6 then raise exception 'הסיסמה החדשה חייבת להכיל לפחות 6 תווים'; end if;
  update tefillin_settings set value = crypt(p_new_password, gen_salt('bf')) where key = 'admin_password';
  return '{}'::jsonb;
end $$;

-- Replaces the whole list of banner sentences (empty lines dropped, max 20 x 300 chars).
create function public.tefillin_save_ticker(p_password text, p_lines jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_lines jsonb;
begin
  perform tefillin_check_admin(p_password);
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'בקשה לא תקינה'; end if;
  select coalesce(jsonb_agg(left(btrim(l), 300)), '[]'::jsonb) into v_lines
  from (select l from jsonb_array_elements_text(p_lines) l where btrim(l) <> '' limit 20) x;
  update tefillin_settings set value = v_lines::text where key = 'ticker';
  return jsonb_build_object('ticker', v_lines);
end $$;

-- Turn hours on/off for every station at once. Existing signups are kept.
create function public.tefillin_set_slots_all(p_password text, p_add jsonb, p_remove jsonb) returns jsonb
language plpgsql set search_path = public as $$
begin
  perform tefillin_check_admin(p_password);
  update tefillin_stations s set slots = array(
    select x from unnest(tefillin_all_slots()) x
    where (x = any (s.slots) or x in (select jsonb_array_elements_text(coalesce(p_add, '[]'::jsonb))))
      and x not in (select jsonb_array_elements_text(coalesce(p_remove, '[]'::jsonb)))
  );
  return '{}'::jsonb;
end $$;

-- ===== Lock every function to the service role =====

do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'tefillin\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ===== Initial data =====

insert into public.tefillin_stations (name, address, notes, slots, position) values
  ('אולפנת צביה', '', '', public.tefillin_all_slots()[2:5], 0),
  ('ביה"ס בית זאב', '', '', public.tefillin_all_slots()[2:5], 1),
  ('ביה"ס אהל מאיר', '', '', public.tefillin_all_slots()[2:5], 2),
  ('ביה"ס אלון יזרעאל', '', '', public.tefillin_all_slots()[2:5], 3),
  ('אורט אלון', 'רח'' האגס 4', '', public.tefillin_all_slots()[2:5], 4),
  ('בי"ס גוונים', 'רחוב וולפסון', 'מול הבית של קרץ', public.tefillin_all_slots()[2:5], 5),
  ('בית ספר יהודה', '', '', public.tefillin_all_slots()[2:5], 6);

insert into public.tefillin_settings (key, value) values ('ticker', $j$[
  "זכות עצומה נפלה בחלקנו להיות שלוחי הרבי ולהאיר את העיר במבצע תפילין.",
  "ביום שבו כולם בוחרים, בואו ניתן לעוד יהודי את הזכות לבחור בקדושה.",
  "מעשה אחד קטן של הנחת תפילין יכול להכריע את העולם כולו לכף זכות ולהביא את הגאולה!",
  "כל הנחת תפילין היא חיבור נצחי של נשמה לבוראה - אל תפספסו אף הזדמנות לזכות יהודי.",
  "רק יחד נצליח לאייש את כל הקלפיות מתוך שמחה וחיות חסידית - תפסו משמרת עכשיו!"
]$j$);

-- Set the admin password (run once, by hand – do not commit the real password):
-- insert into public.tefillin_settings (key, value) values ('admin_password', extensions.crypt('<password>', extensions.gen_salt('bf')));
