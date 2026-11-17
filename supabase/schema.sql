-- 로컬로 Supabase 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 안전하게(if not exists / drop policy if exists) 작성했다.
--
-- 접근 규칙(RLS)
--   profiles : 닉네임은 모두 읽기, 쓰기는 본인만
--   alarms   : 신청 알림 지역 — 본인만 읽기·쓰기
--   trips    : 지난 여행 — 본인만 읽기·쓰기
--   posts    : 커뮤니티 코스 — 모두 읽기, 쓰기·지우기는 쓴 사람만
--   likes    : 좋아요 — 모두 읽기(개수 표시), 누르기·취소는 본인만
--   region_searches : 커뮤니티 지역 검색 수 — 모두 읽기, 올리기는 bump_search() 함수로만
--   storage post-images : 글 사진 — 누구나 보기, 올리기·지우기는 본인 폴더(<user id>/)만

-- ── 프로필(닉네임)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 12),
  created_at timestamptz not null default now()
);

-- ── 신청 알림: 알림을 켠 지역과 마지막으로 확인한 신청 상태
create table if not exists public.alarms (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  region_id text not null check (char_length(region_id) <= 40),
  last_status text not null check (last_status in ('open', 'soon', 'closed')),
  created_at timestamptz not null default now(),
  primary key (user_id, region_id)
);

-- ── 지난 여행: 장바구니 스냅숏(날짜·인원·지원 유형·담은 장소·코스 순서)
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  data jsonb not null,
  total integer not null default 0,
  pay integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists trips_user_idx on public.trips (user_id, created_at desc);

-- ── 커뮤니티 코스 글 (작성자 닉네임을 함께 읽도록 profiles 를 참조)
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  region_id text not null check (char_length(region_id) <= 40),
  title text not null check (char_length(btrim(title)) between 1 and 40),
  memo text not null default '' check (char_length(memo) <= 3000),
  place_ids text[] not null default '{}' check (cardinality(place_ids) <= 20),
  images text[] not null default '{}' check (cardinality(images) <= 6),
  created_at timestamptz not null default now()
);
-- 예전 스키마로 이미 만든 경우: 블로그 글(본문 3000자·사진 6장·코스 선택)로 넓힌다
alter table public.posts add column if not exists images text[] not null default '{}';
alter table public.posts alter column place_ids set default '{}';
alter table public.posts drop constraint if exists posts_memo_check;
alter table public.posts add constraint posts_memo_check check (char_length(memo) <= 3000);
alter table public.posts drop constraint if exists posts_place_ids_check;
alter table public.posts add constraint posts_place_ids_check check (cardinality(place_ids) <= 20);
alter table public.posts drop constraint if exists posts_images_check;
alter table public.posts add constraint posts_images_check check (cardinality(images) <= 6);
create index if not exists posts_region_idx on public.posts (region_id, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc);

-- ── 좋아요
create table if not exists public.likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists likes_post_idx on public.likes (post_id);

-- ── RLS 켜기
alter table public.profiles enable row level security;
alter table public.alarms   enable row level security;
alter table public.trips    enable row level security;
alter table public.posts    enable row level security;
alter table public.likes    enable row level security;

-- profiles
drop policy if exists "profiles: 모두 읽기" on public.profiles;
create policy "profiles: 모두 읽기" on public.profiles for select using (true);
drop policy if exists "profiles: 본인 만들기" on public.profiles;
create policy "profiles: 본인 만들기" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles: 본인 고치기" on public.profiles;
create policy "profiles: 본인 고치기" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- alarms
drop policy if exists "alarms: 본인만" on public.alarms;
create policy "alarms: 본인만" on public.alarms for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- trips
drop policy if exists "trips: 본인만" on public.trips;
create policy "trips: 본인만" on public.trips for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- posts
drop policy if exists "posts: 모두 읽기" on public.posts;
create policy "posts: 모두 읽기" on public.posts for select using (true);
drop policy if exists "posts: 본인 쓰기" on public.posts;
create policy "posts: 본인 쓰기" on public.posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "posts: 본인 고치기" on public.posts;
create policy "posts: 본인 고치기" on public.posts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "posts: 본인 지우기" on public.posts;
create policy "posts: 본인 지우기" on public.posts for delete to authenticated using (user_id = auth.uid());

-- likes
drop policy if exists "likes: 모두 읽기" on public.likes;
create policy "likes: 모두 읽기" on public.likes for select using (true);
drop policy if exists "likes: 본인 누르기" on public.likes;
create policy "likes: 본인 누르기" on public.likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "likes: 본인 취소" on public.likes;
create policy "likes: 본인 취소" on public.likes for delete to authenticated using (user_id = auth.uid());

-- ── 웹(공개 키)에서 쓸 수 있게 권한 부여. 실제 허용 범위는 위 RLS가 정한다
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.posts, public.likes to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.alarms, public.trips to authenticated;
grant insert, update, delete on public.posts to authenticated;
grant insert, delete on public.likes to authenticated;

-- ── 커뮤니티 지역 검색 수(많이 찾는 지역 TOP 10)
create table if not exists public.region_searches (
  region_id text primary key check (region_id ~ '^[a-z0-9_-]{1,40}$'),
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.region_searches enable row level security;
drop policy if exists "region_searches: 모두 읽기" on public.region_searches;
create policy "region_searches: 모두 읽기" on public.region_searches for select using (true);
grant select on public.region_searches to anon, authenticated;
-- 직접 쓰기는 막고, 한 번에 +1만 하는 함수로만 올린다
create or replace function public.bump_search(rid text) returns void
language sql security definer set search_path = public as $$
  insert into public.region_searches (region_id, count) values (rid, 1)
  on conflict (region_id) do update set count = region_searches.count + 1, updated_at = now();
$$;
revoke all on function public.bump_search(text) from public;
grant execute on function public.bump_search(text) to anon, authenticated;

-- ── 글 사진 저장소(Storage). 공개 버킷 = 주소로 누구나 볼 수 있음. 2MB·이미지 형식만
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists "post-images: 본인 폴더에 올리기" on storage.objects;
create policy "post-images: 본인 폴더에 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "post-images: 본인 사진 보기" on storage.objects;
create policy "post-images: 본인 사진 보기" on storage.objects for select to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "post-images: 본인 사진 지우기" on storage.objects;
create policy "post-images: 본인 사진 지우기" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
