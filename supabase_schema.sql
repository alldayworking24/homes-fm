-- HOMES FM 운영 DB 기본 구조 (Supabase/PostgreSQL)
create extension if not exists pgcrypto;
create table if not exists public.repair_price_catalog (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  sub_item text,
  default_price numeric(12,0) not null default 0,
  product_code text,
  preferred_vendor text,
  purchase_place text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 룸체크(점검) 원본 레코드: 등록자/수정자 이력 + 논리 삭제(soft delete)
create table if not exists public.room_checks (
  id uuid primary key default gen_random_uuid(),
  type text not null default '퇴실',
  branch text not null,
  floor text,
  unit text not null,
  inspection_date date,
  inspector_name text,          -- 점검자(자동: 로그인 사용자)
  requester text,               -- CS 요청자
  items jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_by_name text,         -- 등록자 이름(최초 룸체크 수행자)
  updated_by uuid references auth.users(id),
  updated_by_name text,         -- 수정자 이름(최근 수정자)
  deleted_at timestamptz,       -- 논리 삭제 플래그(NULL = 정상, 값 있으면 숨김)
  deleted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_room_checks_active on public.room_checks (branch, unit) where deleted_at is null;
-- 삭제되지 않은 룸체크만 노출하는 뷰
create or replace view public.room_checks_active as
  select * from public.room_checks where deleted_at is null;

create table if not exists public.repair_history (
  id uuid primary key default gen_random_uuid(),
  inspection_id text not null,
  branch text not null,
  floor text,
  unit text not null,
  item_name text not null,
  status text not null default 'repairing',
  estimated_cost numeric(12,0) not null default 0,
  actual_cost numeric(12,0) not null default 0,
  cost_bearer text check (cost_bearer in ('투자사(임대인)','당사(홈즈)','세입자','기타')),
  product_code text,
  contractor text,
  purchase_place text,
  evidence_no text,
  repair_memo text,
  repaired_at date,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,       -- 논리 삭제 플래그(NULL = 정상, 값 있으면 숨김)
  deleted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 삭제되지 않은 수리 이력만 노출하는 뷰
create or replace view public.repair_history_active as
  select * from public.repair_history where deleted_at is null;
create table if not exists public.repair_photos (
  id uuid primary key default gen_random_uuid(),
  repair_history_id uuid not null references public.repair_history(id) on delete cascade,
  photo_type text not null check (photo_type in ('before','after','evidence')),
  storage_path text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','manager','viewer')) default 'viewer'
);
alter table public.repair_price_catalog enable row level security;
alter table public.repair_history enable row level security;
alter table public.repair_photos enable row level security;
alter table public.user_roles enable row level security;
create policy "catalog read authenticated" on public.repair_price_catalog for select to authenticated using (true);
create policy "catalog admin write" on public.repair_price_catalog for all to authenticated using (exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='admin')) with check (exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='admin'));
create policy "history authenticated read" on public.repair_history for select to authenticated using (true);
create policy "history manager write" on public.repair_history for all to authenticated using (exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role in ('admin','manager'))) with check (exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role in ('admin','manager')));
create policy "photos authenticated read" on public.repair_photos for select to authenticated using (true);
create policy "photos manager write" on public.repair_photos for all to authenticated using (exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role in ('admin','manager'))) with check (exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role in ('admin','manager')));

-- 기존 테이블에 적용할 때
alter table public.repair_history add column if not exists cost_bearer text;

-- v19 사용자 프로필/권한 및 이메일 도메인 정책
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  department text,
  phone text,
  role text not null default 'viewer' check (role in ('admin','manager','viewer')),
  external_email_allowed boolean not null default false,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
create policy "profile self read" on public.user_profiles for select to authenticated using (user_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));
create policy "profile self update" on public.user_profiles for update to authenticated using (user_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin')) with check (user_id=auth.uid() or exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));
create policy "profile admin insert" on public.user_profiles for insert to authenticated with check (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));

-- 실제 운영 권장: 회원 생성은 Edge Function/서버에서 처리하고,
-- 이메일이 @homes.global 이거나 user_profiles.external_email_allowed=true 인 경우만 허용합니다.
-- 초기 비밀번호 0338은 최초 로그인 후 반드시 변경하도록 must_change_password를 확인하세요.

-- v22 LH 기준단가 + HOMES 조정단가 우선 적용 구조
-- 우선순위: HOMES 조정단가가 있으면 HOMES, 없으면 LH 기준단가
create table if not exists public.lh_repair_price_catalog (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  sub_item text not null,
  lh_price numeric(12,0) not null default 0,
  source_year integer,
  source_title text,
  source_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_name, sub_item)
);

create table if not exists public.homes_repair_price_overrides (
  id uuid primary key default gen_random_uuid(),
  lh_catalog_id uuid references public.lh_repair_price_catalog(id) on delete cascade,
  item_name text not null,
  sub_item text not null,
  homes_price numeric(12,0) not null check (homes_price >= 0),
  memo text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_name, sub_item)
);

create or replace view public.effective_repair_prices as
select
  coalesce(h.id, l.id) as id,
  l.id as lh_catalog_id,
  coalesce(h.item_name, l.item_name) as item_name,
  coalesce(h.sub_item, l.sub_item) as sub_item,
  l.lh_price,
  h.homes_price,
  coalesce(h.homes_price, l.lh_price) as effective_price,
  case when h.homes_price is not null then 'homes' else 'lh' end as price_source,
  l.source_year,
  l.source_title,
  l.source_note
from public.lh_repair_price_catalog l
left join public.homes_repair_price_overrides h
  on h.item_name=l.item_name and h.sub_item=l.sub_item and h.is_active=true
where l.is_active=true
union all
select
  h.id,
  null::uuid as lh_catalog_id,
  h.item_name,
  h.sub_item,
  null::numeric as lh_price,
  h.homes_price,
  h.homes_price as effective_price,
  'homes'::text as price_source,
  null::integer,
  null::text,
  null::text
from public.homes_repair_price_overrides h
where h.is_active=true
  and not exists (
    select 1 from public.lh_repair_price_catalog l
    where l.item_name=h.item_name and l.sub_item=h.sub_item and l.is_active=true
  );

alter table public.lh_repair_price_catalog enable row level security;
alter table public.homes_repair_price_overrides enable row level security;
create policy "lh catalog authenticated read" on public.lh_repair_price_catalog for select to authenticated using (true);
create policy "lh catalog admin write" on public.lh_repair_price_catalog for all to authenticated
using (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'))
with check (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));
create policy "homes override authenticated read" on public.homes_repair_price_overrides for select to authenticated using (true);
create policy "homes override admin write" on public.homes_repair_price_overrides for all to authenticated
using (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'))
with check (exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='admin'));

-- 아래 값은 앱 초기 구동용 샘플입니다. 실제 LH 계약/고시 단가표 확인 후 교체하세요.
insert into public.lh_repair_price_catalog(item_name,sub_item,lh_price,source_title,source_note)
values
('도어락','건전지 교체',12000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('도어락','본체 교체',120000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('현관문','도어클로저',65000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('싱크대','배수/누수 보수',55000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('주방 수전','수전 교체',85000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('세면기','팝업 교체',45000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('변기','부속 교체',55000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('벽지','부분 보수',70000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('조명(전체)','등기구 교체',45000,'LH 기준 초기 데이터','공식 자료 확인 필요'),
('기타','기본 출장/보수',50000,'LH 기준 초기 데이터','공식 자료 확인 필요')
on conflict(item_name,sub_item) do nothing;
