# 작업지시 공유 기능 — 배포 안내

`gallery/share.html`에서 작업지시(제목+내용+사진)를 카톡/문자 또는 이메일(PDF 첨부)로
보내는 기능입니다. 카톡 공유는 코드만 배포하면 바로 되지만, **이메일 발송은 아래 절차를
직접 한 번 해주셔야 실제로 동작합니다.**

## 1. DB 테이블 만들기

Supabase 대시보드 → SQL Editor에서 `SUPABASE_SHARE_FEATURE.sql` 내용을 실행하세요.
(site-setup.html로 새로 만드는 현장은 이미 스키마에 포함되어 있어 실행할 필요 없습니다.)

## 2. Resend 가입 + 발신 도메인 인증

1. [resend.com](https://resend.com)에서 가입
2. API Keys 메뉴에서 새 키 발급 (`re_`로 시작하는 문자열)
3. (선택, 권장) Domains 메뉴에서 회사 도메인을 추가하고 DNS 레코드(TXT/MX)를 등록해 인증
   - **인증 안 해도 테스트는 가능**하지만, 이 경우 `onboarding@resend.dev`로만 보낼 수 있고
     **Resend 계정을 만든 본인 이메일로만 수신**됩니다(다른 사람에게는 안 감).
   - 실제로 여러 사람에게 보내려면 도메인 인증이 필요합니다.

## 3. Edge Function 배포

로컬 PC(또는 이 저장소를 받은 곳)에서 터미널로:

```bash
npm install -g supabase        # Supabase CLI 설치 (최초 1회)
supabase login
supabase link --project-ref <프로젝트 참조 ID>   # Supabase 대시보드 URL의 https://xxxx.supabase.co 중 xxxx 부분
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set RESEND_FROM="작업지시 <instruction@내도메인.com>"   # 도메인 인증했다면
supabase functions deploy send-instruction-email
```

배포가 끝나면 함수 URL은 다음과 같습니다:
```
https://<프로젝트 참조 ID>.supabase.co/functions/v1/send-instruction-email
```

`gallery/share.html`은 지금 접속해 있는 Supabase 프로젝트 URL을 기준으로 이 주소를
자동으로 계산해서 호출하므로, 코드를 따로 고칠 필요는 없습니다.

## 4. 수신자 등록

admin.html → "📧 수신자 관리"에서 이메일 받을 사람의 이름/이메일을 등록하세요.
등록된 사람만 share.html의 수신자 목록에 나타납니다.

## 참고

- 이 저장소는 지금까지 서버 없이(정적 사이트 + Supabase) 운영돼왔는데, 이메일 발송은
  API 키를 브라우저에 노출하지 않으려면 서버(Edge Function) 없이는 안전하게 할 방법이
  없어서 이번에 처음 추가된 인프라입니다.
- 3번을 아직 안 하셨어도 카톡/문자 공유와 화면 자체는 정상 동작합니다 — 이메일 버튼만
  "발송 실패" 토스트가 뜹니다.
