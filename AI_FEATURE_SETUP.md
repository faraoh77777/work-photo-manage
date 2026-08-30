# 작업지시서 AI 자동작성 — 배포 안내

`gallery/share.html`에서 "✨ AI로 작성하기" 버튼을 누르면, 간단히 적은 메모를 Claude(Anthropic AI)가
정식 작업지시서 제목·내용으로 다듬어줍니다. 이 기능은 **아래 절차를 한 번 해주셔야 실제로 동작합니다**
(안 하셔도 화면 자체는 뜨고, 버튼만 "AI 작성 실패" 토스트가 뜹니다).

## 1. Anthropic API 키 발급

1. [console.anthropic.com](https://console.anthropic.com)에서 가입/로그인
2. API Keys 메뉴에서 새 키 발급 (`sk-ant-`로 시작하는 문자열)
3. 결제 수단을 등록해야 실제 호출이 됩니다 (사용한 만큼만 과금 — 이 기능은 호출 1건당 아주 저렴합니다,
   대략 몇 원~수십 원 수준)

## 2. Edge Function 배포

로컬 PC(또는 이 저장소를 받은 곳)에서 터미널로:

```bash
npm install -g supabase        # Supabase CLI 설치 (최초 1회, 이미 하셨다면 생략)
supabase login
supabase link --project-ref <프로젝트 참조 ID>   # Supabase 대시보드 URL의 https://xxxx.supabase.co 중 xxxx 부분
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
supabase functions deploy generate-work-instruction
```

배포가 끝나면 함수 URL은 다음과 같습니다:
```
https://<프로젝트 참조 ID>.supabase.co/functions/v1/generate-work-instruction
```

`gallery/share.html`은 지금 접속해 있는 Supabase 프로젝트 URL을 기준으로 이 주소를 자동으로
계산해서 호출하므로, 코드를 따로 고칠 필요는 없습니다.

## 3. 주의사항

- AI가 지어낸 내용을 그대로 보내지 마세요 — 화면에 채워진 제목/내용은 **꼭 확인하고 필요하면 고친 뒤**
  보내야 합니다. 메모에 없는 날짜·수량·담당자 이름 등은 AI가 지어내지 않도록 프롬프트에서 막아뒀지만,
  100% 보장되진 않습니다.
- 이 기능도 이메일 발송 기능과 마찬가지로, 로그인된 공개 anon key만 있으면 외부에서도 호출할 수
  있는 구조입니다(같은 한계, 별도 조치 없음) — 남용 시 Anthropic API 요금이 청구될 수 있습니다.
