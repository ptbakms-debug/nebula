-- Jalankan seluruh file ini di Supabase: SQL Editor -> New query -> Run.

-- 1. Data aplikasi: satu baris per pengguna
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;

create policy "user_data_select_own" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_data_insert_own" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_data_update_own" on public.user_data
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_data_delete_own" on public.user_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Hak akses API (wajib jika opsi "Grant API access to new tables automatically" dimatikan saat membuat project)
grant select, insert, update, delete on public.user_data to authenticated;
revoke all on public.user_data from anon;   -- pengunjung tanpa login: tanpa akses sama sekali

-- Batas ukuran data per pengguna (2 MB) agar satu akun tidak bisa memenuhi database
alter table public.user_data drop constraint if exists user_data_size;
alter table public.user_data add constraint user_data_size check (octet_length(data::text) <= 2000000);

-- Data wajib berupa format terenkripsi (dienkripsi di browser). NOT VALID: baris lama yang masih
-- teks biasa tidak diperiksa, tetapi setiap penulisan baru harus terenkripsi.
alter table public.user_data drop constraint if exists user_data_encrypted;
alter table public.user_data add constraint user_data_encrypted
  check (data ? 'e' and data ? 'w' and data ? 'i' and data ? 'c') not valid;

-- 2. Kuota harian Fokus AI (tidak bisa diakses langsung, hanya lewat fungsi di bawah)
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default current_date,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;  -- tanpa policy = ditolak untuk semua
revoke all on public.ai_usage from anon, authenticated;  -- hanya fungsi di bawah yang boleh menyentuhnya

create or replace function public.use_ai_quota(max_per_day int default 20)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare c int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.ai_usage (user_id, day, count)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into c;
  if c > max_per_day then
    return -1;   -- kuota habis
  end if;
  return c;
end;
$$;

revoke all on function public.use_ai_quota(int) from public, anon;
grant execute on function public.use_ai_quota(int) to authenticated;

-- 3. Hapus akun sendiri (data ikut terhapus lewat on delete cascade)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
