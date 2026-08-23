-- work-photo-manage: 작업지시 공유 기능(gallery/share.html)용 테이블 2개 추가
-- Supabase 대시보드 > SQL Editor에서 직접 실행하세요.
-- (site-setup.html로 새로 만드는 현장은 이 테이블들이 스키마에 이미 포함되어 있어 실행할 필요 없습니다.)

-- 이메일 수신자 목록 (admin.html "수신자 관리"에서 등록/삭제)
create table if not exists share_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

-- 작업지시 발송 기록 (누가 언제 무엇을 누구에게 보냈는지)
create table if not exists sent_shares (
  id uuid primary key default gen_random_uuid(),
  title text,
  content text,
  method text not null,              -- 'email' | 'kakao'
  recipient_names text,              -- 이메일 발송 시 받는사람 이름들(콤마로 join), 카톡은 null
  photo_count int not null default 0,
  sender_name text,
  sender_company text,
  project text,
  created_at timestamptz not null default now()
);

alter table share_recipients enable row level security;
alter table sent_shares enable row level security;

create policy "share_recipients_select" on share_recipients for select using (true);
create policy "share_recipients_insert" on share_recipients for insert with check (true);
create policy "share_recipients_delete" on share_recipients for delete using (true);

create policy "sent_shares_select" on sent_shares for select using (true);
create policy "sent_shares_insert" on sent_shares for insert with check (true);

-- 검증
select 'share_recipients' as table_name, count(*) from share_recipients
union all select 'sent_shares', count(*) from sent_shares;
