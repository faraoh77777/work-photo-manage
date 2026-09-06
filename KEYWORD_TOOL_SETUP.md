# 키워드 검색량 조회 도구 — 배포 안내

`keyword-tool/index.html`은 **작업사진 관리 앱과는 완전히 무관한 별도 도구**입니다. 키워드를 입력하면
사람들이 실제로 그 키워드(및 연관 키워드)를 한 달에 PC/모바일에서 얼마나 검색하는지 보여줍니다 —
블로그/SEO 하시는 분들이 쓰는 "네이버 키워드도구"와 같은 데이터를 그대로 가져옵니다.

이 기능은 **아래 절차를 한 번 해주셔야 실제로 동작합니다** (안 해도 화면 자체는 뜨고, 검색 버튼을
누르면 안내 메시지만 뜹니다).

## 1. 네이버 검색광고 API 키 발급

1. [searchad.naver.com](https://searchad.naver.com)에 네이버 아이디로 가입/로그인 (사업자 등록 없이도 개인으로 가입 가능)
2. 우측 상단 계정 정보 → **도구 → API 사용 관리**로 이동
3. "네이버 검색광고 API 라이선스" 발급 (본인 인증 필요할 수 있음)
4. 발급 화면에서 아래 3가지를 확인/저장:
   - **ACCESS LICENSE** → `NAVER_AD_API_KEY`
   - **SECRET KEY** → `NAVER_AD_SECRET_KEY` (발급 시 한 번만 보여주므로 꼭 복사해두세요)
   - **CUSTOMER ID** (화면 상단에 표시되는 숫자) → `NAVER_AD_CUSTOMER_ID`
5. 완전 무료입니다 (검색광고를 실제로 집행하지 않아도 키워드 도구 API는 호출 가능) — 다만 초당/일일
   호출 제한이 있으니 도배성으로 반복 호출하지 마세요.

## 2. Edge Function 배포

로컬 PC(또는 이 저장소를 받은 곳)에서 터미널로:

```bash
npm install -g supabase        # Supabase CLI 설치 (최초 1회, 이미 하셨다면 생략)
supabase login
supabase link --project-ref <프로젝트 참조 ID>   # Supabase 대시보드 URL의 https://xxxx.supabase.co 중 xxxx 부분
supabase secrets set NAVER_AD_API_KEY=발급받은값 NAVER_AD_SECRET_KEY=발급받은값 NAVER_AD_CUSTOMER_ID=발급받은값
supabase functions deploy keyword-search
```

기존 작업사진 앱과 같은 Supabase 프로젝트를 써도 되고, 완전히 새 프로젝트를 만들어도 됩니다 —
이 도구는 다른 테이블이나 데이터를 전혀 건드리지 않습니다.

배포가 끝나면 함수 URL은 다음과 같습니다:
```
https://<프로젝트 참조 ID>.supabase.co/functions/v1/keyword-search?keyword=텐트
```

## 3. 프론트엔드 설정

`keyword-tool/index.html`을 열어 `<script>` 맨 위쪽의 두 값을 채워주세요.

```js
var SUPABASE_URL = 'https://xxxxxxxx.supabase.co';   // 1번에서 link한 프로젝트 URL
var SUPABASE_KEY = 'sb_publishable_xxxxxxxxxxxx';    // Supabase 대시보드 > Settings > API의 anon(publishable) key
```

이후 `keyword-tool/index.html`을 웹서버(GitHub Pages 등)에 올리거나, 로컬에서 그냥 더블클릭해서
열어도 바로 동작합니다.

## 4. 주의사항

- 이 함수도 다른 Edge Function들과 마찬가지로, 공개 anon key만 있으면 외부에서도 호출할 수 있는
  구조입니다 — 남용 시 네이버 API 일일 호출 한도를 소진하거나 일시 차단될 수 있습니다. 트래픽이
  많아질 경우 Edge Function 안에 호출 빈도 제한(rate limit)을 추가하는 걸 권장합니다.
- 결과에 나오는 "월간 검색수"는 네이버 통합검색 기준이며, "< 10"처럼 소수 노출은 10 미만으로
  뭉뚱그려 나옵니다(이 도구에서는 계산 편의상 그대로 숫자로 처리합니다).
- 키워드는 한글/영문 모두 가능하며, 콤마(,)로 구분하면 한 번에 최대 5개까지 관련 키워드를 함께
  조회할 수 있습니다(내부 공백은 자동으로 제거됩니다).
