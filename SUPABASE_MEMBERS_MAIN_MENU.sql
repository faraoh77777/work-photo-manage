-- work-photo-manage: 기존(default) 공유 현장 DB에 main_menu 컬럼 추가
-- Supabase 대시보드 > SQL Editor에서 직접 실행하세요.
-- (site-setup.html로 새로 만드는 현장은 이 컬럼이 스키마에 이미 포함되어 있어 실행할 필요 없습니다.)

alter table members add column if not exists main_menu text not null default '시공';
