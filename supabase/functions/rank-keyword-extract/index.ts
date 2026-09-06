// Supabase Edge Function: rank-keyword-extract
//
// keyword-tool/index.html의 "순위별 키워드 추출" 섹션이 호출한다. 키워드로 검색했을 때
// 상위(1위~선택한 순위)에 뜨는 블로그 글들을 가져와서, 그 글들이 실제로 어떤 단어를 많이
// 쓰는지 간단한 빈도분석으로 뽑아준다 — "상위노출 글들은 어떤 키워드를 쓰는가"를 보는 용도.
//
// 이 기능은 work-photo-manage 앱(작업사진 관리)과는 무관한 별도 도구다.
//
// ⚠ 형태소 분석기(NLP)를 쓰지 않는 "간단 빈도분석" 버전이다. 조사가 안 떨어져 나가는 경우가
//   있을 수 있어(예: "텐트를"이 "텐트"와 따로 집계될 수 있음) 흔한 조사만 휴리스틱으로 뗀다.
//   완벽한 명사 추출이 필요하면 나중에 외부 형태소분석 API로 교체하면 된다.
//
// 필요한 API 키: 네이버 "오픈API(검색)" — keyword-search 함수가 쓰는 "검색광고 API"와는
// 완전히 별개로, developers.naver.com에서 새로 발급받아야 한다. 자세한 절차는
// KEYWORD_TOOL_SETUP.md 참고.
//
// 배포 방법:
//   supabase secrets set NAVER_OPENAPI_CLIENT_ID=xxxx NAVER_OPENAPI_CLIENT_SECRET=xxxx
//   supabase functions deploy rank-keyword-extract
//
// 호출 예:
//   https://<프로젝트 참조 ID>.supabase.co/functions/v1/rank-keyword-extract?keyword=캠핑텐트&from=1&to=10

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const CLIENT_ID = Deno.env.get("NAVER_OPENAPI_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("NAVER_OPENAPI_CLIENT_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 한 번에 너무 많이 크롤링하면 응답이 느려지고 상대 서버에도 부담을 주므로 상한을 둔다.
const MAX_DOCS = 20;
const FETCH_TIMEOUT_MS = 6000;

// 완벽한 형태소 분석은 아니지만, 흔히 붙는 조사를 뒤에서부터 하나 떼어내는 휴리스틱.
// 긴 조사부터 검사해야 짧은 조사가 먼저 걸려서 잘못 잘리는 걸 줄일 수 있다.
const PARTICLES = [
  "으로는", "에서는", "에게서", "한테서", "까지는", "부터는", "이라는", "이라고",
  "으로", "에서", "이나", "에게", "한테", "부터", "까지", "에는", "와는", "과는",
  "이고", "이며", "라고", "라는", "들의", "들은", "들을", "들이", "들도",
  "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "만", "로", "나", "랑",
];

// 조사를 떼도 뜻이 남는 실질적인 단어가 되도록, 너무 짧아지면 떼지 않는다.
function stripParticle(word: string): string {
  for (const p of PARTICLES) {
    if (word.length - p.length >= 2 && word.endsWith(p)) {
      return word.slice(0, word.length - p.length);
    }
  }
  return word;
}

// 조사/접속사/대명사 등 키워드로 의미가 없는 흔한 단어들 — 형태소분석기 없이 쓰는 최소한의 불용어.
const STOPWORDS = new Set([
  "그리고", "그러나", "하지만", "그런데", "그래서", "또한", "그러면", "그러므로",
  "이번", "정말", "너무", "우리", "저는", "제가", "위해", "통해", "대한", "대해",
  "있는", "없는", "하는", "되는", "것을", "것은", "것이", "등을", "등의", "등이",
  "에서", "으로", "합니다", "습니다", "입니다", "했습니다", "됩니다", "있습니다",
  "같은", "많은", "이렇게", "그렇게", "저렇게", "그런", "이런", "저런",
  "오늘", "이제", "먼저", "다시", "바로", "역시", "역시나", "혹시", "만약",
  "블로그", "포스팅", "포스트", "공유", "안녕하세요", "감사합니다", "링크",
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

// 텍스트를 한글/영문/숫자 단위 토큰으로 쪼갠 뒤, 조사 제거 + 불용어 제외 + 2글자 이상만 남긴다.
function extractWords(text: string): string[] {
  const tokens = text
    .split(/[^가-힣a-zA-Z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const words: string[] = [];
  for (const t of tokens) {
    if (/^[0-9]+$/.test(t)) continue; // 숫자만인 토큰은 제외
    const w = /[가-힣]/.test(t) ? stripParticle(t) : t;
    if (w.length < 2) continue;
    if (STOPWORDS.has(w)) continue;
    words.push(w.toLowerCase());
  }
  return words;
}

async function fetchWithTimeout(url: string, ms: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; keyword-tool-bot/1.0)" },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 네이버 블로그는 PC 링크(blog.naver.com/아이디/글번호)가 본문을 iframe으로 물고 있어
// 그대로 fetch하면 본문이 안 잡힌다 — 모바일 페이지(m.blog.naver.com)로 바꾸면 본문이 그대로 나온다.
function toScrapableUrl(link: string): string {
  try {
    const u = new URL(link);
    if (u.hostname === "blog.naver.com") {
      u.hostname = "m.blog.naver.com";
      return u.toString();
    }
    return link;
  } catch {
    return link;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        "NAVER_OPENAPI_CLIENT_ID / NAVER_OPENAPI_CLIENT_SECRET이 설정되지 않았습니다 " +
          "(supabase secrets set ... — KEYWORD_TOOL_SETUP.md 참고)",
      );
    }

    const url = new URL(req.url);
    const keyword = (url.searchParams.get("keyword") || "").trim();
    if (!keyword) throw new Error("keyword 파라미터가 없습니다");

    let from = parseInt(url.searchParams.get("from") || "1", 10);
    let to = parseInt(url.searchParams.get("to") || "10", 10);
    if (!Number.isFinite(from) || from < 1) from = 1;
    if (!Number.isFinite(to) || to < from) to = from;
    if (to - from + 1 > MAX_DOCS) to = from + MAX_DOCS - 1;

    // 1) 네이버 오픈API로 이 키워드의 실제 검색 순위(블로그) 문서 목록을 가져온다.
    const display = to - from + 1;
    const searchResp = await fetch(
      `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(keyword)}` +
        `&display=${display}&start=${from}&sort=sim`,
      {
        headers: {
          "X-Naver-Client-Id": CLIENT_ID,
          "X-Naver-Client-Secret": CLIENT_SECRET,
        },
      },
    );
    const searchRaw = await searchResp.json().catch(() => null);
    if (!searchResp.ok || !searchRaw) {
      const detail = (searchRaw && (searchRaw.errorMessage || searchRaw.message)) || `HTTP ${searchResp.status}`;
      throw new Error(`네이버 검색 API 오류: ${detail}`);
    }

    const items: { title: string; link: string; description: string }[] = Array.isArray(searchRaw.items)
      ? searchRaw.items
      : [];

    // 2) 각 문서를 병렬로 가져와 본문 텍스트를 뽑는다 — 하나 실패해도 나머지로 계속 진행한다.
    const docs = await Promise.all(
      items.map(async (item, idx) => {
        const rank = from + idx;
        const title = stripHtml(item.title || "");
        const description = stripHtml(item.description || "");
        const html = await fetchWithTimeout(toScrapableUrl(item.link), FETCH_TIMEOUT_MS);
        const bodyText = html ? stripHtml(html) : "";
        return {
          rank,
          title,
          link: item.link,
          ok: !!html,
          text: [title, description, bodyText].join(" "),
        };
      }),
    );

    // 3) 문서별 등장 여부(문서빈도)를 기준으로 집계한다 — 한 문서에서 같은 단어를 100번 써도
    //    "여러 상위 문서가 공통으로 쓰는 키워드"를 보는 목적엔 1번으로 세는 게 더 의미 있다.
    const docFreq = new Map<string, number>();
    const totalFreq = new Map<string, number>();
    for (const doc of docs) {
      const words = extractWords(doc.text);
      const seenInDoc = new Set<string>();
      for (const w of words) {
        totalFreq.set(w, (totalFreq.get(w) || 0) + 1);
        if (!seenInDoc.has(w)) {
          seenInDoc.add(w);
          docFreq.set(w, (docFreq.get(w) || 0) + 1);
        }
      }
    }

    const keywords = Array.from(docFreq.entries())
      .map(([word, df]) => ({ word, docFreq: df, totalFreq: totalFreq.get(word) || 0 }))
      .filter((k) => k.docFreq >= 2) // 문서 하나에만 등장한 단어는 노이즈일 확률이 높아 제외
      .sort((a, b) => b.docFreq - a.docFreq || b.totalFreq - a.totalFreq)
      .slice(0, 40);

    return new Response(
      JSON.stringify({
        ok: true,
        keyword,
        from,
        to,
        docs: docs.map((d) => ({ rank: d.rank, title: d.title, link: d.link, ok: d.ok })),
        keywords,
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
