-- work-shoot(작업사진) 보안 강화 — 이미 만들어진 현장(기존 Supabase 프로젝트)에 적용.
-- 새로 만드는 현장은 site-setup.html의 SCHEMA_SQL에 이미 포함되어 있어 이 파일을 따로
-- 실행할 필요 없음. Supabase 대시보드 → SQL Editor에서 전체를 한 번에 실행하세요.
--
-- 무엇을, 왜 바꾸는지:
-- members 테이블의 select/update/delete 정책이 전부 using(true)라서, 로그인조차 없이
-- anon(publishable) key만 있으면(이미 앱 소스에 공개돼 있음) 전체 회원 목록과 PIN 해시를
-- 그대로 읽거나, 승인 상태를 조작하거나, 아무 회원이나 지울 수 있었다. admin.html의
-- "관리자인가" 판정도 브라우저 localStorage 문자열 비교뿐이라 개발자도구에서 한 줄이면
-- 우회됐다. 아래부터는 members 테이블에 대한 직접 select/insert/update/delete를 전부
-- 막고, 로그인/가입/승인/거부/탈퇴/설정변경을 전부 서버 쪽 함수(RPC)로만 하게 한다 —
-- 그 함수 안에서 로그인 시 발급한 세션 토큰과 role을 서버가 직접 확인한다.
--
-- 실행 순서(중요): 이 파일의 함수들은 members.role / members.main_menu 컬럼이 있다고
-- 가정한다. 2026년 이전에 만든 오래된 현장이라 그 컬럼이 아직 없다면, 이 파일보다
-- 먼저 SUPABASE_MEMBERS_ROLE.sql과 SUPABASE_MEMBERS_MAIN_MENU.sql부터 실행하세요
-- (신규 현장은 SCHEMA_SQL에 이미 포함돼 있어 해당 없음).
--
-- 적용 후 반드시 확인할 것: 이 마이그레이션을 실행하는 순간부터 로그인/가입/관리자
-- 기능이 전부 새 RPC를 거치므로, login.html·admin.html·index.html·gallery/index.html이
-- 전부 이 RPC들을 호출하는 최신 버전으로 함께 배포되어 있어야 한다(웹 배포는 git push로
-- 즉시 반영됨) — 구버전 프론트엔드가 남아있으면 로그인 자체가 안 될 수 있다.

-- 전체를 한 묶음으로 실행한다 — 중간에 하나라도 실패하면 아무것도 적용되지 않는다.
-- (정책만 지워지고 함수는 안 만들어진 채로 멈추면 로그인이 전부 막히기 때문)
begin;

-- Supabase는 pgcrypto를 보통 extensions 스키마에 설치해 둔다. 그래서 아래 함수들의
-- search_path에 extensions를 같이 넣는다 — public만 넣으면 digest()를 못 찾아
-- 로그인/가입이 "function digest(text, unknown) does not exist"로 전부 실패한다(2026-10-06).
create extension if not exists pgcrypto;

-- ── 로그인 시도 제한용 컬럼 (2026-10-06) ───────────────────
-- 4자리 PIN은 1만 가지뿐인데 rpc_login에 시도 횟수 제한이 없으면, 브라우저 잠금
-- (login.html의 LOGIN_LOCK_*)과 무관하게 REST로 직접 반복 호출해 뚫을 수 있다.
-- 서버가 직접 세고 잠근다: 연속 5회 틀리면 15분 잠금.
alter table members add column if not exists failed_attempts int not null default 0;
alter table members add column if not exists locked_until timestamptz;

-- ── 세션 테이블 ──────────────────────────────────────────
-- 클라이언트가 직접 읽거나 쓰지 않는다(전부 아래 SECURITY DEFINER 함수 내부에서만 접근) —
-- 정책을 하나도 안 만들어서 RLS 기본값(전면 차단)으로 막아둔다.
create table if not exists sessions (
  token uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
alter table sessions enable row level security;

-- ── 기존의 전면 개방 정책 제거 ──────────────────────────────
-- members: 정책 이름이 현장마다 다를 수 있어(오래된 현장은 대시보드에서 손으로 만든 경우가
-- 있음) 이름을 가리지 않고 전부 지운다. RLS가 꺼져 있던 현장이면 켜기부터 한다 — RLS가
-- 꺼진 테이블은 정책과 무관하게 전부 열려 있다(2026-10-06).
alter table members enable row level security;
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='members' loop
    execute format('drop policy %I on public.members', r.policyname);
  end loop;
end $$;
-- app_settings의 변경(insert/update)도 관리자 전용 동작이라 RPC로만 허용한다.
-- select는 그대로 열어둔다 — 작업분류/구역 목록 자체는 민감정보가 아니고,
-- index.html/admin.html이 실시간(Realtime) 구독으로 바로 읽어야 하기 때문.
-- 단, 판매자 기본 현장(site_registry가 있는 곳)은 건너뛴다 — 같은 DB를 쓰는 구버전
-- work-gallery가 아직 app_settings를 직접 upsert하고 있어서, 여기를 막으면 그 앱의
-- 작업분류/구역 저장이 깨진다. work-gallery를 RPC로 옮긴 뒤에 막을 것(2026-10-06).
do $$
begin
  if to_regclass('public.site_registry') is null then
    drop policy if exists "app_settings_insert" on app_settings;
    drop policy if exists "app_settings_update" on app_settings;
  end if;
end $$;

-- ── 내부 헬퍼: 세션 토큰 → member_id/role ──────────────────
create or replace function _session_role(p_token uuid)
returns table(member_id uuid, role text)
language sql
security definer
set search_path = public, extensions
as $$
  select member_id, role from sessions where token = p_token and expires_at > now();
$$;

-- ── 로그인 ──────────────────────────────────────────────
-- pin_hash가 없는(비밀번호 미설정) 회원은 최초 로그인 시 p_pin_confirm 없이 한 번 호출하면
-- 'needs_pin_setup'을 돌려주고, p_pin/p_pin_confirm을 채워 다시 호출하면 그 자리에서
-- 비밀번호를 설정하고 이어서 로그인까지 진행한다(기존 login.html의 2단계 흐름과 동일).
create or replace function rpc_login(p_phone text, p_pin text, p_pin_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m members%rowtype;
  v_token uuid;
begin
  select * into m from members where phone = p_phone;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if m.locked_until is not null and m.locked_until > now() then
    return jsonb_build_object('error', 'locked',
      'retry_after', ceil(extract(epoch from (m.locked_until - now())))::int);
  end if;

  if m.pin_hash is null then
    if p_pin_confirm is null then
      return jsonb_build_object('error', 'needs_pin_setup');
    end if;
    if p_pin <> p_pin_confirm then
      return jsonb_build_object('error', 'pin_mismatch');
    end if;
    update members set pin_hash = encode(digest(p_pin, 'sha256'), 'hex') where id = m.id
      returning * into m;
  else
    if m.pin_hash <> encode(digest(p_pin, 'sha256'), 'hex') then
      -- 연속 5회째 틀리면 15분 잠그고 횟수는 0으로 되돌린다.
      update members set
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
        failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end
      where id = m.id;
      return jsonb_build_object('error', 'wrong_pin');
    end if;
  end if;

  if m.failed_attempts > 0 or m.locked_until is not null then
    update members set failed_attempts = 0, locked_until = null where id = m.id;
  end if;

  if not m.approved then
    return jsonb_build_object('error', 'not_approved');
  end if;

  insert into sessions(member_id, role) values (m.id, m.role) returning token into v_token;

  return jsonb_build_object(
    'token', v_token,
    'member', jsonb_build_object(
      'id', m.id, 'name', m.name, 'company', m.company, 'project', m.project,
      'phone', m.phone, 'category', m.category, 'role', m.role, 'main_menu', m.main_menu
    )
  );
end;
$$;

-- ── 회원가입 ─────────────────────────────────────────────
-- 완전히 빈 현장의 첫 가입자(=현장 개설자)만 운영자로 자동승인한다.
-- p_is_site_creator는 클라이언트가 보내는 값이라 믿으면 안 된다 — 예전엔 이 값이 true면
-- 무조건 운영자로 승격시켜서, REST로 true를 넣어 호출하면 누구나 승인 없이 운영자가
-- 될 수 있었다(2026-10-06 수정). login.html의 호출 형태가 깨지지 않게 인자는 남겨두되 무시한다.
create or replace function rpc_signup(
  p_company text, p_project text, p_name text, p_phone text,
  p_pin text, p_pin_confirm text, p_category text, p_main_menu text,
  p_role text, p_is_site_creator boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m members%rowtype;
  v_token uuid;
  v_auto_promote boolean;
  v_final_role text;
  v_count int;
begin
  if p_pin <> p_pin_confirm then
    return jsonb_build_object('error', 'pin_mismatch');
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('error', 'invalid_pin');
  end if;

  select count(*) into v_count from members;
  v_auto_promote := v_count = 0;
  v_final_role := case when v_auto_promote then '운영자' else p_role end;

  insert into members(company, project, name, phone, category, main_menu, role, pin_hash, approved)
  values (p_company, p_project, p_name, p_phone, p_category, p_main_menu, v_final_role,
          encode(digest(p_pin, 'sha256'), 'hex'), v_auto_promote)
  returning * into m;

  if v_auto_promote then
    insert into sessions(member_id, role) values (m.id, m.role) returning token into v_token;
    return jsonb_build_object(
      'token', v_token,
      'member', jsonb_build_object(
        'id', m.id, 'name', m.name, 'company', m.company, 'project', m.project,
        'phone', m.phone, 'category', m.category, 'role', m.role, 'main_menu', m.main_menu
      )
    );
  end if;

  return jsonb_build_object('pending', true);
exception
  when unique_violation then
    return jsonb_build_object('error', 'duplicate_phone');
end;
$$;

-- ── 로그아웃(세션 폐기) ───────────────────────────────────
create or replace function rpc_logout(p_token uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from sessions where token = p_token;
$$;

-- ── 관리자: 승인 대기 회원 목록(pin_hash는 절대 포함하지 않음) ──
create or replace function rpc_list_pending_members(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from _session_role(p_token);
  if v_role is null or v_role not in ('관리자','운영자') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('data', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'phone', phone, 'company', company,
      'project', project, 'category', category, 'role', role, 'created_at', created_at
    ) order by created_at asc), '[]'::jsonb)
    from members where approved = false
  ));
end;
$$;

-- ── 관리자: 회원 승인 ─────────────────────────────────────
create or replace function rpc_approve_member(p_token uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from _session_role(p_token);
  if v_role is null or v_role not in ('관리자','운영자') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  update members set approved = true where id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 관리자: 회원 거부(삭제) ────────────────────────────────
create or replace function rpc_reject_member(p_token uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from _session_role(p_token);
  if v_role is null or v_role not in ('관리자','운영자') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  delete from members where id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 본인 탈퇴 ────────────────────────────────────────────
create or replace function rpc_delete_self(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member_id uuid;
begin
  select member_id into v_member_id from _session_role(p_token);
  if v_member_id is null then
    return jsonb_build_object('error', 'invalid_session');
  end if;
  delete from members where id = v_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 관리자: 작업분류/구역 설정 저장(app_settings) ─────────────
create or replace function rpc_update_app_settings(p_token uuid, p_cats_by_menu jsonb, p_areas jsonb, p_default_area text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from _session_role(p_token);
  if v_role is null or v_role not in ('관리자','운영자') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- p_default_area가 null이면(gallery/index.html처럼 이 값을 다루지 않는 호출자) 기존 값을
  -- 그대로 둔다 — 안 그러면 이 필드를 모르는 호출자가 호출할 때마다 다른 화면이 저장해둔
  -- 기본 구역이 null로 덮어써진다.
  insert into app_settings(id, cats_by_menu, areas, default_area, updated_at)
  values ('global', p_cats_by_menu, p_areas, p_default_area, now())
  on conflict (id) do update set
    cats_by_menu = excluded.cats_by_menu,
    areas = excluded.areas,
    default_area = coalesce(excluded.default_area, app_settings.default_area),
    updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ── site-setup.html의 "연결 테스트" 전용: members를 직접 select하지 않고도
-- 스키마가 있는지/현장이 비어있는지(=신규 현장인지)만 확인한다 ──
create or replace function rpc_site_probe()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  select count(*) into v_count from members;
  return jsonb_build_object('ok', true, 'is_empty', v_count = 0);
end;
$$;

-- ── work_photos 수정/삭제 (2026-09-29 발견: 애초에 update/delete 정책이 하나도
-- 없어서, gallery/index.html의 사진 정보 수정·삭제·중복정리가 로컬에만 반영되고
-- 클라우드 원본 행은 그대로 남아 있었다 — 에러도 안 떠서 아무도 몰랐던 조용한 실패.
-- select/insert는 근로자도 촬영 중 중복확인 등에 써야 해서 그대로 열어두고,
-- update/delete만 관리자 전용 RPC로 새로 연다) ──
create or replace function rpc_update_work_photo_by_id(
  p_token uuid, p_id uuid,
  p_date text, p_time text, p_tag text, p_cat text, p_loc text,
  p_work_type text, p_note text, p_sender text, p_menu text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from _session_role(p_token);
  if v_role is null or v_role not in ('관리자','운영자') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  update work_photos set
    date=p_date, time=p_time, tag=p_tag, cat=p_cat, loc=p_loc,
    work_type=p_work_type, note=p_note, sender=p_sender, menu=p_menu
  where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function rpc_update_work_photo_by_url(
  p_token uuid, p_photo_url text,
  p_date text, p_time text, p_tag text, p_cat text, p_loc text,
  p_work_type text, p_note text, p_sender text, p_menu text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from _session_role(p_token);
  if v_role is null or v_role not in ('관리자','운영자') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  update work_photos set
    date=p_date, time=p_time, tag=p_tag, cat=p_cat, loc=p_loc,
    work_type=p_work_type, note=p_note, sender=p_sender, menu=p_menu
  where photo_url = p_photo_url;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function rpc_delete_work_photo(p_token uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from _session_role(p_token);
  if v_role is null or v_role not in ('관리자','운영자') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  delete from work_photos where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- anon 롤이 위 함수들을 "호출"할 수 있게 권한을 준다(SECURITY DEFINER라 함수 내부
-- 로직 자체는 함수 소유자 권한으로 돌지만, 호출 권한은 별도로 grant해야 한다).
-- _session_role은 다른 함수 내부에서만 쓰는 헬퍼라 anon에게 직접 grant하지 않는다.
grant execute on function rpc_login(text, text, text) to anon;
grant execute on function rpc_signup(text, text, text, text, text, text, text, text, text, boolean) to anon;
grant execute on function rpc_logout(uuid) to anon;
grant execute on function rpc_list_pending_members(uuid) to anon;
grant execute on function rpc_approve_member(uuid, uuid) to anon;
grant execute on function rpc_reject_member(uuid, uuid) to anon;
grant execute on function rpc_delete_self(uuid) to anon;
grant execute on function rpc_update_app_settings(uuid, jsonb, jsonb, text) to anon;
grant execute on function rpc_site_probe() to anon;
grant execute on function rpc_update_work_photo_by_id(uuid, uuid, text, text, text, text, text, text, text, text, text) to anon;
grant execute on function rpc_update_work_photo_by_url(uuid, text, text, text, text, text, text, text, text, text, text) to anon;
grant execute on function rpc_delete_work_photo(uuid, uuid) to anon;

-- ── Edge Function 인증(QA-AUDIT.md §11-5) ────────────────────
-- analyze-scaffold/generate-work-instruction/send-instruction-email 3개 함수가
-- 전부 무인증이라, anon key만 있으면 앱을 거치지 않고도 누구나 직접 호출해
-- Anthropic/Resend 유료 API 비용을 무제한으로 유발할 수 있었다. 함수 자체는
-- Deno(Edge Function) 환경이라 세션 테이블에 직접 접근 못 하므로, 이 RPC로
-- "로그인된 사람만 호출 가능"을 함수 쪽에서 확인할 수 있게 한다(관리자 전용까지는
-- 아니고, 유효한 세션이면 충분 — share.html/scaffold.html 둘 다 일반 근로자도
-- 쓰도록 설계되어 있어서).
create or replace function rpc_verify_session(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select jsonb_build_object('valid', true, 'role', role) from sessions
      where token = p_token and expires_at > now()),
    jsonb_build_object('valid', false)
  );
$$;
grant execute on function rpc_verify_session(uuid) to anon;

-- ── Storage 버킷 업로드 제한 (QA-AUDIT.md §11-4) ──────────────
-- 'work-photo' 버킷이 public+전면개방이라, 인증 없이 아무 파일이나(크기/형식 무관)
-- 올리거나 기존 파일을 덮어쓸 수 있었다. 이 앱은 사진(JPEG)만 다루므로 이미지가
-- 아니거나 너무 큰 업로드만 최소한으로 막는다 — 완전한 인증 기반 제어는 아니지만
-- (여전히 anon key만 있으면 이미지 업로드 자체는 누구나 가능), 용량 남용·완전히
-- 무관한 파일 업로드는 막을 수 있다.
drop policy if exists "work-photo storage insert" on storage.objects;
create policy "work-photo storage insert" on storage.objects for insert
  with check (
    bucket_id = 'work-photo'
    and coalesce(metadata->>'mimetype','') like 'image/%'
    and coalesce((metadata->>'size')::bigint, 0) < 20971520  -- 20MB
  );
drop policy if exists "work-photo storage update" on storage.objects;
create policy "work-photo storage update" on storage.objects for update
  using (bucket_id = 'work-photo')
  with check (
    bucket_id = 'work-photo'
    and coalesce(metadata->>'mimetype','') like 'image/%'
    and coalesce((metadata->>'size')::bigint, 0) < 20971520
  );

-- AI 비계 물량산출 기능(SUPABASE_SCAFFOLD.sql)을 이미 설치한 현장이면 이 버킷도 존재한다 —
-- 정책 이름이 storage.objects 전역에서 유일하기만 하면 되므로, 아직 scaffold-photos 버킷을
-- 안 만든 현장에서 실행해도 안전하다(그 경우 이 정책은 그냥 아무 행에도 안 걸림).
drop policy if exists "scaffold-photos storage insert" on storage.objects;
create policy "scaffold-photos storage insert" on storage.objects for insert
  with check (
    bucket_id = 'scaffold-photos'
    and coalesce(metadata->>'mimetype','') like 'image/%'
    and coalesce((metadata->>'size')::bigint, 0) < 20971520
  );
drop policy if exists "scaffold-photos storage update" on storage.objects;
create policy "scaffold-photos storage update" on storage.objects for update
  using (bucket_id = 'scaffold-photos')
  with check (
    bucket_id = 'scaffold-photos'
    and coalesce(metadata->>'mimetype','') like 'image/%'
    and coalesce((metadata->>'size')::bigint, 0) < 20971520
  );

-- ── 현장 목록(site_registry) 삭제 차단 (2026-10-06) ─────────
-- 이 테이블은 판매자 기본 현장에만 있다(다른 현장에는 없으므로 있을 때만 실행).
-- 여러 회사 현장의 접속 정보가 모여 있는데 익명 키로 행을 지울 수 있었다.
-- 조회·등록·폐쇄 표시는 로그인 화면의 현장 선택이 쓰고 있어 그대로 둔다.
do $$
begin
  if to_regclass('public.site_registry') is not null then
    execute 'revoke delete on public.site_registry from anon, authenticated';
  end if;
end $$;

commit;

-- ── 검증 ─────────────────────────────────────────────────
-- 결과 한 줄: rpc_함수수 13, members_잠금 true, members_정책수 0, 로그인함수_동작 true 이면 정상 적용.
select
  (select count(*) from information_schema.routines
     where routine_schema='public' and routine_name like 'rpc\_%') as "rpc_함수수(13)",
  (select relrowsecurity from pg_class where oid='public.members'::regclass) as "members_잠금(true)",
  (select count(*) from pg_policies
     where schemaname='public' and tablename='members') as "members_정책수(0)",
  (select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace
     where e.extname='pgcrypto') as "pgcrypto_위치",
  (rpc_login('00000000000','0000')->>'error' = 'not_found') as "로그인함수_동작(true)",
  (select count(*) from members where pin_hash is not null) as "PIN설정_회원수";
