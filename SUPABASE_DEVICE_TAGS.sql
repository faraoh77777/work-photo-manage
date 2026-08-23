-- work-photo-manage: 기기번호 인덱스 테이블 추가 (자동완성/검색용)
-- Supabase 대시보드 > SQL Editor에서 직접 실행하세요.
-- (site-setup.html로 새로 만드는 현장은 이 테이블이 스키마에 이미 포함되어 있어 실행할 필요 없습니다.)

create table if not exists device_tags (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  created_at timestamptz not null default now()
);

alter table device_tags enable row level security;

create policy "device_tags_select" on device_tags for select using (true);
create policy "device_tags_insert" on device_tags for insert with check (true);

-- 기기번호 목록을 넣는 예시 (아래처럼 여러 행을 한 번에 넣거나, Table Editor에서 CSV로 가져와도 됩니다)
-- insert into device_tags (tag) values
--   ('PT-2101'), ('PT-2102'), ('EQ-001')
-- on conflict (tag) do nothing;

-- 검증
select count(*) as device_tags_count from device_tags;
