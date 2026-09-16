-- work-photo-manage: AI 비계 물량산출 기능 — 신규 격리 테이블/버킷
-- Supabase 대시보드 > SQL Editor에서 직접 실행하세요.
-- (기존 work_photos/app_settings/storage 'work-photo' 버킷과는 완전히 분리된 신규 리소스입니다.
--  나중에 이 기능을 별도 저장소(work-photo-Scaffold)로 옮길 때 이 SQL 하나만 새 프로젝트에서
--  다시 실행하면 됩니다.)

create table if not exists scaffold_quantities (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'planned', -- 'planned' | 'installed'
  photo_url text,
  overlay_photo_url text,
  site_name text, work_type text, location text, worker text,
  ai_span_count int, ai_level_count int, ai_confidence text, ai_corners jsonb, ai_notes text,
  final_span_count int, final_level_count int, final_corners jsonb, user_edited boolean not null default false,
  span_length_m numeric, level_height_m numeric, width_m numeric,
  length_m numeric, height_m numeric, volume_m3 numeric,
  linked_record_id uuid,
  gps_lat numeric, gps_lng numeric,
  captured_at timestamptz, created_at timestamptz not null default now()
);

alter table scaffold_quantities enable row level security;
create policy "scaffold_quantities_select" on scaffold_quantities for select using (true);
create policy "scaffold_quantities_insert" on scaffold_quantities for insert with check (true);
create policy "scaffold_quantities_update" on scaffold_quantities for update using (true);
create policy "scaffold_quantities_delete" on scaffold_quantities for delete using (true);

-- 설정 화면(스팬/폭/단높이 프리셋)용 — 기존 app_settings 재사용하지 않고 별도 격리
create table if not exists scaffold_settings (
  id text primary key default 'default',
  span_length_m numeric not null default 1.8,
  width_m numeric not null default 0.4,
  level_height_m numeric not null default 1.8,
  updated_at timestamptz not null default now()
);
alter table scaffold_settings enable row level security;
create policy "scaffold_settings_select" on scaffold_settings for select using (true);
create policy "scaffold_settings_insert" on scaffold_settings for insert with check (true);
create policy "scaffold_settings_update" on scaffold_settings for update using (true);

insert into scaffold_settings (id) values ('default') on conflict (id) do nothing;

-- 신규 격리 버킷 (기존 'work-photo' 버킷과 별개)
insert into storage.buckets (id, name, public) values ('scaffold-photos', 'scaffold-photos', true)
  on conflict (id) do nothing;
create policy "scaffold-photos storage select" on storage.objects for select using (bucket_id = 'scaffold-photos');
create policy "scaffold-photos storage insert" on storage.objects for insert with check (bucket_id = 'scaffold-photos');
create policy "scaffold-photos storage update" on storage.objects for update using (bucket_id = 'scaffold-photos');

-- 검증
select count(*) as scaffold_quantities_count from scaffold_quantities;
select * from scaffold_settings;
