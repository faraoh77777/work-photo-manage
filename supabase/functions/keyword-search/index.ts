// Supabase Edge Function: keyword-search
//
// keyword-tool/index.html 이 호출한다. 네이버 검색광고(SearchAd) API의 "키워드 도구"를
// 그대로 프록시해서, 입력한 키워드의 월간 검색수(PC/모바일)·연관 키워드·경쟁정도를 돌려준다.
// API_KEY/SECRET_KEY를 브라우저에 그대로 노출하면 안 되므로, generate-work-instruction과
// 동일한 패턴으로 이 함수가 서버 쪽에서 서명해 대신 호출하는 역할만 한다.
//
// 이 기능은 work-photo-manage 앱(작업사진 관리)과는 무관한 별도 도구다 — 인터넷 사용자들이
// 실제로 어떤 키워드를 얼마나 검색하는지(검색량/연관검색어) 조회하는 용도.
//
// 배포 방법 (Supabase CLI 필요, 최초 1회):
//   1) npm install -g supabase   (또는 https://supabase.com/docs/guides/cli 참고)
//   2) supabase login
//   3) supabase link --project-ref <프로젝트 참조 ID>   (Supabase 대시보드 URL의 xxxx.supabase.co 앞부분)
//   4) supabase secrets set NAVER_AD_API_KEY=xxxx NAVER_AD_SECRET_KEY=xxxx NAVER_AD_CUSTOMER_ID=xxxx
//      (searchad.naver.com에서 발급 — 자세한 절차는 KEYWORD_TOOL_SETUP.md 참고)
//   5) supabase functions deploy keyword-search
//
// 배포 후 클라이언트에서 호출하는 URL:
//   https://<프로젝트 참조 ID>.supabase.co/functions/v1/keyword-search?keyword=텐트

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const API_KEY = Deno.env.get("NAVER_AD_API_KEY");
const SECRET_KEY = Deno.env.get("NAVER_AD_SECRET_KEY");
const CUSTOMER_ID = Deno.env.get("NAVER_AD_CUSTOMER_ID");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://api.naver.com";
const API_PATH = "/keywordstool";

// 네이버 검색광고 API 서명: "타임스탬프.METHOD.경로"를 SECRET_KEY로 HMAC-SHA256 → base64
async function sign(timestamp: string, method: string, path: string, secretKey: string) {
  const message = `${timestamp}.${method}.${path}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
  let binary = "";
  for (const b of sigBytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// "< 10" 같은 문자열도 섞여 오므로 숫자만 뽑아서 정렬/합산이 가능하게 한다.
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const digits = String(v ?? "").replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
      throw new Error(
        "NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID가 설정되지 않았습니다 " +
          "(supabase secrets set ... — KEYWORD_TOOL_SETUP.md 참고)",
      );
    }

    const url = new URL(req.url);
    const rawKeyword = (url.searchParams.get("keyword") || "").trim();
    if (!rawKeyword) throw new Error("keyword 파라미터가 없습니다");

    // 네이버 API는 공백 없는 키워드만 받고, 콤마로 여러 개(최대 5개)를 함께 조회할 수 있다.
    const hintKeywords = rawKeyword
      .split(",")
      .map((k) => k.trim().replace(/\s+/g, ""))
      .filter(Boolean)
      .slice(0, 5)
      .join(",");
    if (!hintKeywords) throw new Error("유효한 키워드가 없습니다");

    const timestamp = String(Date.now());
    const signature = await sign(timestamp, "GET", API_PATH, SECRET_KEY);

    const naverResp = await fetch(
      `${BASE_URL}${API_PATH}?hintKeywords=${encodeURIComponent(hintKeywords)}&showDetail=1`,
      {
        method: "GET",
        headers: {
          "X-Timestamp": timestamp,
          "X-API-KEY": API_KEY,
          "X-Customer": CUSTOMER_ID,
          "X-Signature": signature,
        },
      },
    );

    const raw = await naverResp.json().catch(() => null);
    if (!naverResp.ok || !raw) {
      const detail = (raw && (raw.title || raw.message)) || `HTTP ${naverResp.status}`;
      throw new Error(`네이버 검색광고 API 오류: ${detail}`);
    }

    const list: Record<string, unknown>[] = Array.isArray(raw.keywordList) ? raw.keywordList : [];
    const items = list
      .map((k) => {
        const pcCount = toNum(k.monthlyPcQcCnt);
        const mobileCount = toNum(k.monthlyMobileQcCnt);
        return {
          keyword: k.relKeyword,
          pcCount,
          mobileCount,
          totalCount: pcCount + mobileCount,
          compIdx: k.compIdx || "-", // 경쟁정도: 낮음/중간/높음
          plAvgDepth: k.plAvgDepth ?? null, // 월평균노출 광고수
        };
      })
      .sort((a, b) => b.totalCount - a.totalCount);

    return new Response(
      JSON.stringify({ ok: true, keyword: rawKeyword, items }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
