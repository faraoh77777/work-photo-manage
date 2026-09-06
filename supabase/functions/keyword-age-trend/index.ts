// Supabase Edge Function: keyword-age-trend
//
// keyword-tool/index.html의 "검색량 조회" 탭이 키워드를 조회한 뒤 함께 호출한다. 네이버
// 데이터랩(DataLab) "검색어트렌드" API로 그 키워드를 실제로 어느 연령대가 많이 검색하는지를
// 알아본다.
//
// ⚠ 이 기능은 rank-keyword-extract/keyword-search와는 또 다른 네이버 API를 쓴다 — 검색광고
// API도, 오픈API "검색"도 아닌 오픈API "데이터랩(검색어트렌드)"다. developers.naver.com에
// 등록한 애플리케이션에 이 API가 추가로 체크되어 있어야 한다(안 체크돼 있으면 401/403).
// 자세한 절차는 KEYWORD_TOOL_SETUP.md 참고.
//
// ⚠ 데이터랩 검색어트렌드 API는 "이 키워드를 검색한 사람이 몇 명"이 아니라, 요청한 조건(연령대
// 등) 안에서 상대적으로 얼마나 검색됐는지를 나타내는 0~100 지수를 준다 — 그것도 "그 요청 한 번"
// 안에서의 상대값이라, 연령대별로 지수를 그대로 비교할 수 없다. 그래서 이 함수는 같은 키워드로
// 연령대(1~11) 각각에 대해 데이터랩 API를 따로 호출한 뒤, 그 결과(월별 지수의 평균)를 다시
// 서로 비교해서 "이 키워드 검색자 중 연령대별 비중이 대략 이 정도"로 정규화한다. 엄밀한 절대
// 수치가 아니라 근사치라는 점에 유의 — 검색엔진의 원자료를 그대로 보여주는 게 아니라 이 함수가
// 계산한 추정치다.
//
// ⚠ 연령대 하나당 API 호출이 1번이라 총 11번 호출한다 — 데이터랩 API는 앱당 하루 호출 한도가
// 있으므로(보통 1,000회) 이 기능을 자주 쓰면 한도를 빨리 소진한다. 트래픽이 늘면 결과 캐싱을
// 추가하는 걸 권장한다.
//
// 배포 방법:
//   supabase secrets set NAVER_OPENAPI_CLIENT_ID=xxxx NAVER_OPENAPI_CLIENT_SECRET=xxxx
//   supabase functions deploy keyword-age-trend
//
// 호출 예:
//   https://<프로젝트 참조 ID>.supabase.co/functions/v1/keyword-age-trend?keyword=캠핑텐트

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const CLIENT_ID = Deno.env.get("NAVER_OPENAPI_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("NAVER_OPENAPI_CLIENT_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DATALAB_URL = "https://openapi.naver.com/v1/datalab/search";

// 네이버 데이터랩이 정의한 연령대 코드 — 10년 단위가 아니라 이 그대로가 공식 구간이다.
// (임의로 "10대/20대"처럼 다시 묶으면 실제 API 구간과 어긋나 오해를 부를 수 있어 그대로 쓴다.)
const AGE_BRACKETS: { code: string; label: string }[] = [
  { code: "1", label: "0~12세" },
  { code: "2", label: "13~18세" },
  { code: "3", label: "19~24세" },
  { code: "4", label: "25~29세" },
  { code: "5", label: "30~34세" },
  { code: "6", label: "35~39세" },
  { code: "7", label: "40~44세" },
  { code: "8", label: "45~49세" },
  { code: "9", label: "50~54세" },
  { code: "10", label: "55~59세" },
  { code: "11", label: "60세 이상" },
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 데이터랩 API 한 번 호출 — 이 연령대 코드 하나에 대한 최근 3개월치 월별 지수를 받아온다.
async function fetchAgeRatio(
  keyword: string,
  ageCode: string,
  startDate: string,
  endDate: string,
): Promise<number | null> {
  const resp = await fetch(DATALAB_URL, {
    method: "POST",
    headers: {
      "X-Naver-Client-Id": CLIENT_ID!,
      "X-Naver-Client-Secret": CLIENT_SECRET!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate,
      endDate,
      timeUnit: "month",
      device: "",
      gender: "",
      ages: [ageCode],
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    }),
  });
  const raw = await resp.json().catch(() => null);
  if (!resp.ok || !raw) return null;

  const points: { ratio?: number }[] = raw?.results?.[0]?.data || [];
  if (!points.length) return 0;
  const sum = points.reduce((a, p) => a + (Number(p.ratio) || 0), 0);
  return sum / points.length;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        "NAVER_OPENAPI_CLIENT_ID / NAVER_OPENAPI_CLIENT_SECRET이 설정되지 않았습니다 " +
          "(supabase secrets set ... — KEYWORD_TOOL_SETUP.md 참고). 이 값은 rank-keyword-extract와 " +
          "같은 키를 쓰지만, 네이버 개발자센터 애플리케이션에 '데이터랩(검색어트렌드)' API가 추가로 " +
          "체크돼 있어야 합니다.",
      );
    }

    const url = new URL(req.url);
    const keyword = (url.searchParams.get("keyword") || "").trim();
    if (!keyword) throw new Error("keyword 파라미터가 없습니다");

    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 3);
    const startDate = ymd(start);
    const endDate = ymd(end);

    // 연령대 11개를 병렬로 조회한다 — 하나가 실패해도 나머지로 계속 진행한다.
    const results = await Promise.all(
      AGE_BRACKETS.map(async (b) => {
        const avgRatio = await fetchAgeRatio(keyword, b.code, startDate, endDate);
        return { ...b, avgRatio };
      }),
    );

    const okResults = results.filter((r) => r.avgRatio != null) as
      (typeof results[number] & { avgRatio: number })[];
    if (!okResults.length) {
      throw new Error("네이버 데이터랩 API에서 연령대별 데이터를 하나도 받지 못했습니다");
    }

    // 각 연령대 지수 합계 대비 비중으로 정규화한다 — 위 주석대로 엄밀한 절대치가 아니라 근사치.
    const total = okResults.reduce((a, r) => a + r.avgRatio, 0);
    const ages = results.map((r) => ({
      code: r.code,
      label: r.label,
      avgRatio: r.avgRatio,
      sharePct: r.avgRatio != null && total > 0 ? Math.round((r.avgRatio / total) * 1000) / 10 : null,
    }));

    return new Response(
      JSON.stringify({
        ok: true,
        keyword,
        period: { startDate, endDate, timeUnit: "month" },
        ages,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
