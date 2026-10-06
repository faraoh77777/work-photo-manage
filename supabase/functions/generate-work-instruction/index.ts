// Supabase Edge Function: generate-work-instruction
//
// gallery/share.html의 "✨ AI로 작성하기" 버튼이 호출한다. 사용자가 대충 적은 메모(hint)를
// 정식 작업지시서 "제목"+"내용"으로 다듬어 돌려준다. Claude API 키를 브라우저에 그대로
// 노출하면 안 되므로, send-instruction-email과 동일한 패턴으로 이 함수가 서버 쪽에서
// 대신 호출하는 역할만 한다 — 로직은 최소한만 담았다.
//
// 배포 방법 (Supabase CLI 필요, 최초 1회):
//   1) npm install -g supabase   (또는 https://supabase.com/docs/guides/cli 참고)
//   2) supabase login
//   3) supabase link --project-ref <프로젝트 참조 ID>   (Supabase 대시보드 URL의 xxxx.supabase.co 앞부분)
//   4) supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
//      (console.anthropic.com에서 발급받은 키)
//   5) supabase functions deploy generate-work-instruction
//
// 배포 후 클라이언트에서 호출하는 URL:
//   https://<프로젝트 참조 ID>.supabase.co/functions/v1/generate-work-instruction

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// 이 프로젝트(현장) 자체의 URL/anon key — Edge Function 배포 시 Supabase가 자동으로
// 넣어주는 환경변수라 별도 secrets set이 필요 없다.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 이 함수는 무인증이라 anon key만 있으면 앱을 거치지 않고도 누구나 직접 호출해 Claude API
// 비용을 무제한으로 유발할 수 있었다(QA-AUDIT.md §11-5). 로그인된 사람만 쓰도록,
// 클라이언트가 같이 보낸 세션 토큰을 rpc_verify_session으로 확인한다(관리자 전용까지는
// 아니고 유효한 로그인 세션이면 충분 — share.html은 일반 근로자도 쓰도록 설계됨).
async function verifySession(token: unknown): Promise<boolean> {
  if (!token || typeof token !== "string" || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_verify_session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data?.valid;
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT = `당신은 건설 현장 작업지시서를 작성하는 보조원입니다. 사용자가 대충 적은 메모를 바탕으로
현장에서 실제로 쓸 수 있는 정식 작업지시서의 "제목"과 "내용"을 작성합니다.
- 제목은 20자 이내로 핵심만 담아 간결하게 작성합니다.
- 내용은 존댓말로, 지시 대상/작업 내용/기한/주의사항이 드러나도록 문단으로 작성합니다.
- 메모에 없는 사실(정확한 날짜, 수량, 담당자 이름 등)은 절대 지어내지 말고, 메모에 있는 내용만 사용합니다.
- 반드시 아래 JSON 형식으로만 응답하세요. 그 외 설명, 인사말, 코드블록 표시(\`\`\`)는 절대 붙이지 마세요.
{"title": "...", "content": "..."}`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다 (supabase secrets set ANTHROPIC_API_KEY=...)");
    }

    const { hint, project, company, photoCount, token } = await req.json();
    if (!(await verifySession(token))) {
      return new Response(
        JSON.stringify({ ok: false, error: "로그인이 필요합니다" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!hint || !String(hint).trim()) throw new Error("메모(hint)가 없습니다");

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const userText = [
      project ? `현장명: ${project}` : null,
      company ? `회사명: ${company}` : null,
      typeof photoCount === "number" && photoCount > 0 ? `첨부 사진: ${photoCount}장` : null,
      `메모: ${hint}`,
    ].filter(Boolean).join("\n");

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const raw = (textBlock?.text || "").trim();
    // 혹시 코드블록(```json ... ```)으로 감싸서 응답하면 그 안의 JSON만 추출
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 응답을 이해하지 못했습니다: " + raw.slice(0, 200));
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.title || !parsed.content) throw new Error("AI 응답에 제목/내용이 없습니다");

    return new Response(
      JSON.stringify({ ok: true, title: parsed.title, content: parsed.content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
