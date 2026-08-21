-- work-photo-manage: 기존(default) 공유 현장 DB에 role 컬럼 추가
-- Supabase 대시보드 > SQL Editor에서 직접 실행하세요.
-- (site-setup.html로 새로 만드는 현장은 이 컬럼이 스키마에 이미 포함되어 있어 실행할 필요 없습니다.)

alter table members add column if not exists role text not null default '근로자';

-- 예전 방식(작업 분류 = '관리자')으로 admin.html에 접근하던 기존 계정을
-- role='관리자'로 옮겨준다. 실제로 최고 권한(운영자)을 줘야 할 사람이 있다면
-- 이 UPDATE 이후 해당 계정만 role='운영자'로 한 번 더 바꿔주세요.
update members set role = '관리자' where category = '관리자' and role = '근로자';
