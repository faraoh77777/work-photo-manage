-- ============================================================================
-- 라이선스 서버 스키마 (요금제 설계안 1단계, 2026-11-18)
-- ----------------------------------------------------------------------------
-- 실행 위치: 회장님 소유 "새" Supabase 프로젝트(라이선스 전용)의 SQL Editor.
--            대선이엔씨 기본현장(dteljgmdbfyxubtpogcj)이나 고객 서버에 실행하지 말 것.
-- 원칙: 테이블은 RLS를 켜고 정책을 두지 않아 앱(anon)이 직접 읽고 쓰지 못한다.
--       앱은 아래 security definer 함수(RPC)로만 접근한다.
--       고객 서버 접속키(anon key)는 저장하지 않는다.
-- 요금제: 기본(basic 10명) / 표준(standard 30명) / 체험(trial) / 내부(internal) / 맞춤(custom).
--         대형(무제한)은 결정 8번에 따라 두지 않음 — 30명 초과는 custom으로 개별 견적.
-- 1단계는 "안내만" 한다. 이 함수 결과로 앱 기능을 막는 것은 2단계에서 한다.
-- 여러 번 실행해도 안전하게 작성함(if not exists / create or replace).
-- ============================================================================

-- 토큰은 gen_random_uuid() 두 개를 이어 만든다(확장 설치 불필요, PG13+ 기본 함수).

-- ── 테이블 ──────────────────────────────────────────────────────────────────
create table if not exists public.sites (
  id              uuid primary key default gen_random_uuid(),
  site_url        text not null unique,               -- 고객 Supabase 주소
  site_token      text not null unique default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')), -- 현장 구분용 비밀값
  name            text,
  company         text,
  contact         text,
  plan            text not null default 'trial'
                  check (plan in ('trial','basic','standard','internal','custom')),
  seat_limit      int,                                 -- null = 무제한
  sheet_pc_limit  int,
  ai_quota        int,
  trial_until     date,
  paid_until      date,
  manual_status   text check (manual_status in ('suspended','closed')), -- 회장님이 직접 정지·폐쇄
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.usage_monthly (
  site_id           uuid not null references public.sites(id) on delete cascade,
  month             date not null,                     -- 그 달 1일
  ai_count          int  not null default 0,
  approved_members  int,
  over_limit_since  date,
  primary key (site_id, month)
);

create table if not exists public.sheet_devices (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  device_hash   text not null,
  device_name   text,
  activated_at  timestamptz not null default now(),
  last_seen     timestamptz,
  revoked       boolean not null default false,
  unique (site_id, device_hash)
);

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  amount        int  not null,
  period_start  date not null,
  period_end    date not null,
  paid_at       date not null default current_date,
  invoice_no    text,
  memo          text
);

alter table public.sites          enable row level security;
alter table public.usage_monthly  enable row level security;
alter table public.sheet_devices  enable row level security;
alter table public.payments       enable row level security;
-- 정책을 일부러 만들지 않는다 → anon/authenticated 직접 접근 불가.
revoke all on public.sites, public.usage_monthly, public.sheet_devices, public.payments from anon, authenticated;

-- ── 요금제 기본 한도 ─────────────────────────────────────────────────────────
create or replace function public._plan_defaults(p_plan text,
  out seat_limit int, out sheet_pc_limit int, out ai_quota int)
language sql immutable as $$
  select case p_plan when 'basic' then 10 when 'standard' then 30 when 'trial' then 10 else null end,
         case p_plan when 'basic' then 1  when 'standard' then 2  when 'trial' then 1  else null end,
         case p_plan when 'basic' then 100 when 'standard' then 300 when 'trial' then 30 else null end;
$$;

-- ── 현재 상태 계산: trial / active / grace / suspended / closed ───────────────
-- 유예 7일: 만료일 다음 날부터 7일. 그 뒤는 suspended(정지).
create or replace function public._site_status(s public.sites)
returns text language sql stable as $$
  select case
    when s.manual_status is not null then s.manual_status
    when s.plan = 'internal' then 'active'
    when s.plan = 'trial' then
      case when current_date <= s.trial_until then 'trial'
           when current_date <= s.trial_until + 7 then 'grace'
           else 'suspended' end
    else
      case when s.paid_until is null then 'suspended'
           when current_date <= s.paid_until then 'active'
           when current_date <= s.paid_until + 7 then 'grace'
           else 'suspended' end
  end;
$$;

-- ── RPC: 현장 개설 때 등록(체험 30일 시작, site_token 발급) ───────────────────
-- 이미 등록된 주소면 새로 만들지 않고 already_registered를 돌려준다
-- (남의 현장 토큰을 주소만으로 받아가지 못하게 토큰은 처음 한 번만 돌려줌).
create or replace function public.rpc_register_site(p_site_url text, p_name text default null,
  p_company text default null, p_contact text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_url text; v_row public.sites; d record;
begin
  v_url := lower(rtrim(trim(coalesce(p_site_url,'')),'/'));
  if v_url !~ '^https://[a-z0-9-]+\.supabase\.co$' then
    return json_build_object('ok',false,'error','invalid_url');
  end if;
  if exists(select 1 from public.sites where site_url = v_url) then
    return json_build_object('ok',false,'error','already_registered');
  end if;
  select * into d from public._plan_defaults('trial');
  insert into public.sites(site_url,name,company,contact,plan,seat_limit,sheet_pc_limit,ai_quota,trial_until)
  values (v_url, left(p_name,100), left(p_company,100), left(p_contact,100), 'trial',
          d.seat_limit, d.sheet_pc_limit, d.ai_quota, current_date + 30)
  returning * into v_row;
  return json_build_object('ok',true,'site_token',v_row.site_token,'trial_until',v_row.trial_until);
end; $$;

-- ── RPC: 앱·갤러리·관리자 화면이 상태 확인 ────────────────────────────────────
create or replace function public.rpc_license_status(p_site_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.sites; v_month date := date_trunc('month', current_date)::date; u public.usage_monthly;
begin
  select * into s from public.sites where site_token = p_site_token;
  if not found then return json_build_object('ok',false,'error','unknown_site'); end if;
  select * into u from public.usage_monthly where site_id = s.id and month = v_month;
  return json_build_object(
    'ok',true, 'name',s.name, 'plan',s.plan, 'status',public._site_status(s),
    'trial_until',s.trial_until, 'paid_until',s.paid_until,
    'seat_limit',s.seat_limit, 'sheet_pc_limit',s.sheet_pc_limit, 'ai_quota',s.ai_quota,
    'ai_count',coalesce(u.ai_count,0), 'checked_at',now());
end; $$;

revoke all on function public.rpc_register_site(text,text,text,text) from public;
revoke all on function public.rpc_license_status(text) from public;
grant execute on function public.rpc_register_site(text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_license_status(text) to anon, authenticated;
revoke all on function public._plan_defaults(text) from public, anon, authenticated;
revoke all on function public._site_status(public.sites) from public, anon, authenticated;

-- ── 기존 현장 옮기기(결정 3번: 샤힌·데모 = 내부, 테스트 2곳 = 폐쇄) ─────────────
-- 주소는 기본현장 서버의 site_registry에서 확인해 아래 <...> 자리에 넣고 주석을 풀어 실행.
-- 실행 결과의 site_token은 각 현장 고객 서버 app_settings에 넣을 값이므로 따로 보관.
-- insert into public.sites(site_url,name,plan,manual_status) values
--   ('<샤힌 PKG1 주소>',        '샤힌 PKG1',        'internal', null),
--   ('<데모건설 시연현장 주소>', '데모건설 시연현장', 'internal', null),
--   ('<테스트현장1 주소>',       '테스트현장1',      'trial',    'closed'),
--   ('<테스트현장2 주소>',       '테스트현장2',      'trial',    'closed')
-- on conflict (site_url) do nothing
-- returning name, site_token;
