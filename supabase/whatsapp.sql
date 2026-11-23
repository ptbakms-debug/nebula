-- Pengingat WhatsApp (opsional). Jalankan SETELAH schema.sql. Aman dijalankan ulang.
-- Setelah menjalankan file ini, set rahasia server SEKALI (ganti teks acak panjang, simpan juga di Netlify sebagai WA_SERVER_SECRET):
--   insert into public.wa_server (secret_hash)
--   values (encode(sha256(convert_to('GANTI-DENGAN-TEKS-ACAK-MIN-32-KARAKTER','UTF8')),'hex'))
--   on conflict (id) do update set secret_hash = excluded.secret_hash;

-- Hash rahasia server. Tidak bisa diakses dari API.
create table if not exists public.wa_server (
  id          boolean primary key default true check (id),
  secret_hash text not null
);
alter table public.wa_server enable row level security;
revoke all on public.wa_server from anon, authenticated;

-- Nomor WhatsApp pengguna (satu per akun). Nomor baru dianggap valid setelah pengguna membalas dari nomor itu.
create table if not exists public.wa_links (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  phone        text not null check (phone ~ '^62[0-9]{8,13}$'),
  code         text not null,
  code_at      timestamptz not null default now(),
  consent_at   timestamptz not null,
  verified_at  timestamptz,
  opted_out_at timestamptz,
  morning      boolean not null default true,
  eve          boolean not null default false
);
create unique index if not exists wa_links_phone_verified on public.wa_links (phone) where verified_at is not null;
alter table public.wa_links enable row level security;
revoke all on public.wa_links from anon, authenticated;

-- Jadwal pengingat: hanya waktu dan jumlah tugas, tanpa judul.
create table if not exists public.wa_reminders (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  remind_at  timestamptz not null,
  n          int  not null check (n between 1 and 99),
  kind       text not null check (kind in ('today','tomorrow')),
  claimed_at timestamptz,
  sent_at    timestamptz,
  failed_at  timestamptz,
  error      text,
  attempts   int not null default 0,
  unique (user_id, remind_at, kind)
);
create index if not exists wa_reminders_due on public.wa_reminders (remind_at) where sent_at is null and failed_at is null;
alter table public.wa_reminders enable row level security;
revoke all on public.wa_reminders from anon, authenticated;

-- ===== Fungsi untuk pengguna yang login =====
create or replace function public.wa_request_link(p_phone text, p_consent boolean, p_morning boolean default true, p_eve boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare d text; ph text; c text; cur public.wa_links;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not coalesce(p_consent,false) then raise exception 'consent_required'; end if;
  d := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if d like '0%' then ph := '62' || substr(d,2);
  elsif d like '62%' then ph := d;
  elsif d like '8%' then ph := '62' || d;
  else raise exception 'bad_phone'; end if;
  if ph !~ '^62[0-9]{8,13}$' then raise exception 'bad_phone'; end if;
  c := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  select * into cur from public.wa_links where user_id = auth.uid();
  if found and cur.phone = ph and cur.verified_at is not null and cur.opted_out_at is null then
    update public.wa_links set morning = coalesce(p_morning,true), eve = coalesce(p_eve,false), consent_at = now() where user_id = auth.uid();
    return json_build_object('phone', ph, 'verified', true, 'code', null);
  end if;
  insert into public.wa_links (user_id, phone, code, code_at, consent_at, morning, eve)
  values (auth.uid(), ph, c, now(), now(), coalesce(p_morning,true), coalesce(p_eve,false))
  on conflict (user_id) do update
    set phone = excluded.phone, code = excluded.code, code_at = now(), consent_at = now(),
        verified_at = null, opted_out_at = null, morning = excluded.morning, eve = excluded.eve;
  delete from public.wa_reminders where user_id = auth.uid() and sent_at is null;
  return json_build_object('phone', ph, 'verified', false, 'code', c);
end $$;

create or replace function public.wa_status()
returns json language plpgsql security definer set search_path = public as $$
declare l public.wa_links;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into l from public.wa_links where user_id = auth.uid();
  if not found then return null; end if;
  return json_build_object('phone_tail', right(l.phone,4), 'verified', l.verified_at is not null,
                           'opted_out', l.opted_out_at is not null, 'morning', l.morning, 'eve', l.eve,
                           'code', case when l.verified_at is null then l.code else null end);
end $$;

create or replace function public.wa_set_prefs(p_morning boolean, p_eve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.wa_links set morning = coalesce(p_morning,true), eve = coalesce(p_eve,false) where user_id = auth.uid();
  delete from public.wa_reminders where user_id = auth.uid() and sent_at is null and claimed_at is null;
end $$;

create or replace function public.wa_disable()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.wa_reminders where user_id = auth.uid();
  delete from public.wa_links where user_id = auth.uid();
end $$;

-- p_items: [{"at":"2026-11-24T00:00:00Z","n":3,"kind":"today"}, ...]
create or replace function public.wa_sync(p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare l public.wa_links; it jsonb; t timestamptz; k text; c int; cnt int := 0; h int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into l from public.wa_links where user_id = auth.uid();
  if not found or l.verified_at is null or l.opted_out_at is not null then return 0; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 40 then raise exception 'bad_items'; end if;
  delete from public.wa_reminders where user_id = auth.uid() and sent_at is null and claimed_at is null;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      t := (it->>'at')::timestamptz; k := it->>'kind'; c := (it->>'n')::int;
    exception when others then continue; end;
    if k not in ('today','tomorrow') or c < 1 or c > 99 then continue; end if;
    if (k = 'today' and not l.morning) or (k = 'tomorrow' and not l.eve) then continue; end if;
    if t < now() + interval '1 minute' or t > now() + interval '30 days' then continue; end if;
    h := extract(hour from (t at time zone 'Asia/Jakarta'))::int;
    if h < 6 or h > 20 then continue; end if;      -- jam tenang 21.00-05.59 WIB
    insert into public.wa_reminders (user_id, remind_at, n, kind) values (auth.uid(), t, c, k) on conflict do nothing;
    if found then cnt := cnt + 1; end if;
  end loop;
  return cnt;
end $$;

-- ===== Fungsi untuk server (Netlify), dijaga rahasia server =====
create or replace function public.wa_check(p_secret text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or length(p_secret) < 32
     or not exists (select 1 from public.wa_server where secret_hash = encode(sha256(convert_to(p_secret,'UTF8')),'hex')) then
    raise exception 'forbidden';
  end if;
end $$;

create or replace function public.wa_link_confirm(p_secret text, p_code text, p_phone text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.wa_check(p_secret);
  update public.wa_links set verified_at = now(), opted_out_at = null
   where code = upper(coalesce(p_code,'')) and phone = p_phone and code_at > now() - interval '1 day' and verified_at is null;
  get diagnostics n = row_count;
  return n > 0;
exception when unique_violation then
  return false;
end $$;

create or replace function public.wa_optout(p_secret text, p_phone text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.wa_check(p_secret);
  delete from public.wa_reminders where sent_at is null and user_id in (select user_id from public.wa_links where phone = p_phone and verified_at is not null);
  update public.wa_links set opted_out_at = now() where phone = p_phone and verified_at is not null and opted_out_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.wa_claim_due(p_secret text, p_limit int default 20)
returns table (id bigint, phone text, n int, kind text) language plpgsql security definer set search_path = public as $$
begin
  perform public.wa_check(p_secret);
  update public.wa_reminders set failed_at = now(), error = 'expired'
   where sent_at is null and failed_at is null and remind_at <= now() - interval '3 hours';
  delete from public.wa_reminders where remind_at < now() - interval '30 days';
  return query
  with cand as (
    select r.id as rid, l.phone as ph, r.remind_at as at,
           row_number() over (partition by r.user_id order by r.remind_at) as rn,
           (select count(*) from public.wa_reminders s
             where s.user_id = r.user_id
               and (s.sent_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta')
                    or (s.sent_at is null and s.failed_at is null and s.claimed_at > now() - interval '10 minutes'))) as sent_today
      from public.wa_reminders r join public.wa_links l on l.user_id = r.user_id
     where r.sent_at is null and r.failed_at is null and r.attempts < 3
       and r.remind_at <= now()
       and l.verified_at is not null and l.opted_out_at is null
       and (r.claimed_at is null or r.claimed_at < now() - interval '10 minutes')
  ), pick as (   -- maksimal 2 pesan per pengguna per hari (WIB), termasuk yang diklaim dalam batch ini
    select c.rid, c.ph from cand c where c.rn + c.sent_today <= 2
     order by c.at limit greatest(1, least(coalesce(p_limit,20), 50))
  ), due as (
    select r.id as rid, p.ph from public.wa_reminders r join pick p on p.rid = r.id for update of r skip locked
  )
  update public.wa_reminders r set claimed_at = now(), attempts = r.attempts + 1
    from due where r.id = due.rid
  returning r.id, due.ph, r.n, r.kind;
end $$;

create or replace function public.wa_mark(p_secret text, p_id bigint, p_ok boolean, p_error text default null, p_permanent boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.wa_check(p_secret);
  if p_ok then update public.wa_reminders set sent_at = now(), error = null where id = p_id;
  elsif p_permanent then update public.wa_reminders set failed_at = now(), error = left(coalesce(p_error,''),200) where id = p_id;
  else update public.wa_reminders set claimed_at = null, error = left(coalesce(p_error,''),200) where id = p_id;
  end if;
end $$;

-- Hak akses
revoke all on function public.wa_request_link(text,boolean,boolean,boolean), public.wa_status(), public.wa_set_prefs(boolean,boolean),
  public.wa_disable(), public.wa_sync(jsonb) from public, anon;
grant execute on function public.wa_request_link(text,boolean,boolean,boolean), public.wa_status(), public.wa_set_prefs(boolean,boolean),
  public.wa_disable(), public.wa_sync(jsonb) to authenticated;
revoke all on function public.wa_check(text) from public, anon, authenticated;
revoke all on function public.wa_link_confirm(text,text,text), public.wa_optout(text,text),
  public.wa_claim_due(text,int), public.wa_mark(text,bigint,boolean,text,boolean) from public;
grant execute on function public.wa_link_confirm(text,text,text), public.wa_optout(text,text),
  public.wa_claim_due(text,int), public.wa_mark(text,bigint,boolean,text,boolean) to anon;
