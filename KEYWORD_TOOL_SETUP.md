# 키워드 리서치 도구 — 배포 안내

`keyword-tool/index.html`은 **작업사진 관리 앱과는 완전히 무관한 별도 도구**로, 기능이 세 가지입니다.

1. **검색량 조회** — 키워드(및 연관 키워드)를 한 달에 PC/모바일에서 얼마나 검색하는지 (블로그/SEO
   하시는 분들이 쓰는 "네이버 키워드도구"와 같은 데이터), 그리고 그 키워드를 **어느 연령대가
   많이 검색하는지**(네이버 데이터랩 기준 근사치)
2. **순위별 키워드 추출** — 그 키워드로 검색했을 때 상위(1위~선택한 순위)에 뜨는 블로그 글들이
   실제로 어떤 단어를 공통으로 쓰는지 (형태소분석기 없는 간단 빈도분석), 그리고 그 글들의
   **상위노출 요인**(평균 글자수·이미지 수·제목에 키워드 포함 비율·발행일 최신성)까지 함께 분석

각 기능은 **서로 다른 네이버 API 키가 필요**하고, **아래 절차를 한 번 해주셔야 실제로 동작합니다**
(안 해도 화면 자체는 뜨고, 버튼을 누르면 안내 메시지만 뜹니다).

> **참고 — 여기서 다루지 않는 것들:** 검색자의 "직업별" 데이터는 네이버·구글·유튜브 어디에도
> 공개 API가 없어 제공 불가능합니다. 구글 키워드 검색량(Keyword Planner)은 Google Ads 관리자
> 계정 + 개발자 토큰 승인(+ 사실상 광고 집행 실적)이 필요해 문턱이 높고, 유튜브는 애초에
> 키워드 검색량 지표 자체를 API로 제공하지 않습니다. 이 도구는 그래서 네이버 데이터만 다룹니다.

## 1. API 키 발급 (두 종류, 헷갈리지 않게 주의)

### 1-1. 검색량 조회용 — 네이버 검색광고(SearchAd) API

1. [searchad.naver.com](https://searchad.naver.com)에 네이버 아이디로 가입/로그인 (사업자 등록 없이도 개인으로 가입 가능)
2. 우측 상단 계정 정보 → **도구 → API 사용 관리**로 이동
3. "네이버 검색광고 API 라이선스" 발급 (본인 인증 필요할 수 있음)
4. 발급 화면에서 아래 3가지를 확인/저장:
   - **ACCESS LICENSE** → `NAVER_AD_API_KEY`
   - **SECRET KEY** → `NAVER_AD_SECRET_KEY` (발급 시 한 번만 보여주므로 꼭 복사해두세요)
   - **CUSTOMER ID** (화면 상단에 표시되는 숫자) → `NAVER_AD_CUSTOMER_ID`
5. 완전 무료입니다 (검색광고를 실제로 집행하지 않아도 키워드 도구 API는 호출 가능) — 다만 초당/일일
   호출 제한이 있으니 도배성으로 반복 호출하지 마세요.

### 1-2. 순위별 키워드 추출용 — 네이버 오픈API(검색)

**1-1과 완전히 별개의 키입니다.** 검색광고 계정과 무관하게 새로 발급받아야 합니다.

1. [developers.naver.com/apps/#/register](https://developers.naver.com/apps/#/register)에서 애플리케이션 등록
2. 사용 API에서 **"검색"** 체크
3. 비로그인 오픈 API 서비스 환경 → "WEB 설정"에 아무 URL이나 등록(예: `https://example.com`) — 서버에서만
   호출하므로 실제로 그 URL을 쓰지는 않지만 등록은 필수입니다
4. 등록 후 발급되는 값을 확인:
   - **Client ID** → `NAVER_OPENAPI_CLIENT_ID`
   - **Client Secret** → `NAVER_OPENAPI_CLIENT_SECRET`
5. 이것도 무료입니다 (검색 API는 하루 호출 한도 내에서 무료 제공).

### 1-3. 연령별 검색 관심도용 — 네이버 오픈API(데이터랩·검색어트렌드)

**1-2와 같은 애플리케이션을 재사용하되, API 하나를 추가로 체크해야 합니다.**

1. [developers.naver.com/apps](https://developers.naver.com/apps/#/list)에서 1-2에서 등록한
   애플리케이션을 열기 (또는 새로 등록해도 무방)
2. **사용 API**에 **"데이터랩(검색어트렌드)"**를 추가로 체크 → 저장
   (이미 있는 `NAVER_OPENAPI_CLIENT_ID`/`NAVER_OPENAPI_CLIENT_SECRET`를 그대로 재사용합니다 —
   새 키를 또 발급받는 게 아닙니다. 체크만 안 돼 있으면 호출 시 401/403 에러가 납니다.)
3. 이것도 무료입니다. 다만 **연령별 조회 1번에 데이터랩 API를 11번(연령대별로 1번씩) 호출**하므로,
   하루 호출 한도(보통 1,000회)를 검색량 조회보다 훨씬 빨리 소진합니다 — 자주 조회할 계획이면
   나중에 캐싱을 추가하는 걸 권장합니다.
4. 이 API가 주는 값은 "실제 검색자 수"가 아니라 **상대 지수**입니다. 이 도구는 연령대 11개를
   각각 조회한 지수를 다시 서로 비교해 "비중"으로 근사 환산합니다 — 엄밀한 통계가 아니라
   참고용 근사치라는 점에 유의하세요.

## 2. Edge Function 배포

로컬 PC(또는 이 저장소를 받은 곳)에서 터미널로:

```bash
npm install -g supabase        # Supabase CLI 설치 (최초 1회, 이미 하셨다면 생략)
supabase login
supabase link --project-ref <프로젝트 참조 ID>   # Supabase 대시보드 URL의 https://xxxx.supabase.co 중 xxxx 부분

# 검색량 조회 기능
supabase secrets set NAVER_AD_API_KEY=발급받은값 NAVER_AD_SECRET_KEY=발급받은값 NAVER_AD_CUSTOMER_ID=발급받은값
supabase functions deploy keyword-search

# 순위별 키워드 추출 기능
supabase secrets set NAVER_OPENAPI_CLIENT_ID=발급받은값 NAVER_OPENAPI_CLIENT_SECRET=발급받은값
supabase functions deploy rank-keyword-extract

# 연령별 검색 관심도 기능 (위와 같은 NAVER_OPENAPI_CLIENT_ID/SECRET — 이미 설정했다면 secrets set은 생략)
supabase functions deploy keyword-age-trend
```

기존 작업사진 앱과 같은 Supabase 프로젝트를 써도 되고, 완전히 새 프로젝트를 만들어도 됩니다 —
이 도구는 다른 테이블이나 데이터를 전혀 건드리지 않습니다.

배포가 끝나면 함수 URL은 다음과 같습니다:
```
https://<프로젝트 참조 ID>.supabase.co/functions/v1/keyword-search?keyword=텐트
https://<프로젝트 참조 ID>.supabase.co/functions/v1/rank-keyword-extract?keyword=텐트&from=1&to=10
https://<프로젝트 참조 ID>.supabase.co/functions/v1/keyword-age-trend?keyword=텐트
```

## 3. 프론트엔드 설정

`keyword-tool/index.html`을 열어 `<script>` 맨 위쪽의 두 값을 채워주세요. (두 기능이 같은 Supabase
프로젝트를 쓰므로 설정은 한 곳만 채우면 됩니다.)

```js
var SUPABASE_URL = 'https://xxxxxxxx.supabase.co';   // 위에서 link한 프로젝트 URL
var SUPABASE_KEY = 'sb_publishable_xxxxxxxxxxxx';    // Supabase 대시보드 > Settings > API의 anon(publishable) key
```

이후 `keyword-tool/index.html`을 웹서버(GitHub Pages 등)에 올리거나, 로컬에서 그냥 더블클릭해서
열어도 바로 동작합니다.

## 4. 주의사항

- 이 함수들도 다른 Edge Function들과 마찬가지로, 공개 anon key만 있으면 외부에서도 호출할 수 있는
  구조입니다 — 남용 시 네이버 API 일일 호출 한도를 소진하거나 일시 차단될 수 있습니다. 트래픽이
  많아질 경우 Edge Function 안에 호출 빈도 제한(rate limit)을 추가하는 걸 권장합니다.
- 검색량 조회 결과의 "월간 검색수"는 네이버 통합검색 기준이며, "< 10"처럼 소수 노출은 10 미만으로
  뭉뚱그려 나옵니다(이 도구에서는 계산 편의상 그대로 숫자로 처리합니다). 키워드는 한글/영문 모두
  가능하며, 콤마(,)로 구분하면 한 번에 최대 5개까지 관련 키워드를 함께 조회할 수 있습니다.
- 순위별 키워드 추출은 **형태소 분석기를 쓰지 않는 간단 빈도분석**입니다 — 조사가 안 떨어져 나가는
  경우가 있을 수 있어(예: "텐트를"이 "텐트"와 따로 집계) 완벽한 명사 추출은 아닙니다. 또한 블로그
  글을 하나씩 직접 열어서 읽어오기 때문에, 최대 20개 글까지만 조회하고 일부 글은 플랫폼 차단 등으로
  "본문 읽기 실패"가 나올 수 있습니다(그 경우 제목·요약만 반영됩니다).
- **"상위노출 요인 분석"은 검색엔진의 실제 순위 알고리즘을 알아내는 게 아닙니다.** 상위권 글들이
  공통으로 가진 특징(글자수, 이미지 수, 제목에 키워드 포함 여부, 발행일 최신성)을 통계로 보여줄
  뿐이고, 이건 관찰된 상관관계이지 "이렇게 쓰면 상위에 노출된다"는 인과관계를 증명하지 않습니다 —
  참고 자료로만 활용하세요.
- **"연령별 검색 관심도"는 데이터랩 API의 상대 지수를 이 도구가 다시 비중으로 환산한 근사치**입니다
  (위 1-3 참고). `keyword-age-trend` 함수 배포/키 설정을 안 했거나 실패하면, 검색량 결과는 정상
  표시되고 이 카드만 조용히 안 뜹니다 — 에러 팝업으로 방해하지 않도록 만들었습니다. 콤마로 여러
  키워드를 함께 조회했을 때는 **첫 번째 키워드 기준**으로만 연령별 데이터를 보여줍니다.
