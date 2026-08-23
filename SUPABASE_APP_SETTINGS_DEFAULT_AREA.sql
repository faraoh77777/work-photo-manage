-- work-photo-manage: app_settings에 default_area(근로자 화면 기본 구역) 컬럼 추가
-- Supabase 대시보드 > SQL Editor에서 직접 실행하세요.
-- (site-setup.html로 새로 만드는 현장은 이 컬럼이 스키마에 이미 포함되어 있어 실행할 필요 없습니다.)

alter table app_settings add column if not exists default_area text;
