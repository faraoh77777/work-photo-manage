// Supabase Edge Function: send-instruction-email
//
// gallery/share.html이 만든 작업지시서 PDF(base64)를 받아 Resend로 이메일 발송한다.
// 브라우저에서 Resend API를 직접 호출하면 API 키가 그대로 노출되므로,
// 이 함수가 서버 쪽에서 대신 호출하는 역할만 한다 — 로직은 최소한만 담았다.
//
// 배포 방법 (Supabase CLI 필요, 최초 1회):
//   1) npm install -g supabase   (또는 https://supabase.com/docs/guides/cli 참고)
//   2) supabase login
//   3) supabase link --project-ref <프로젝트 참조 ID>   (Supabase 대시보드 URL의 xxxx.supabase.co 앞부분)
//   4) supabase secrets set RESEND_API_KEY=re_xxxxxxxx
//      supabase secrets set RESEND_FROM="작업지시 <instruction@내도메인.com>"
//      (도메인 인증 전이라면 RESEND_FROM을 생략 — onboarding@resend.dev로 기본 발신되지만
//       이 경우 Resend 계정 소유자 본인 이메일로만 테스트 발송 가능)
//   5) supabase functions deploy send-instruction-email
//
// 배포 후 클라이언트에서 호출하는 URL:
//   https://<프로젝트 참조 ID>.supabase.co/functions/v1/send-instruction-email

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY가 설정되지 않았습니다 (supabase secrets set RESEND_API_KEY=...)");
    }

    const { to, subject, text, pdfBase64, filename } = await req.json();

    if (!Array.isArray(to) || !to.length) throw new Error("받는사람(to)이 없습니다");
    if (!pdfBase64) throw new Error("PDF 데이터(pdfBase64)가 없습니다");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to,
        subject: subject || "현장 작업지시서",
        text: text || "첨부된 작업지시서 PDF를 확인해 주세요.",
        attachments: [
          { filename: filename || "작업지시서.pdf", content: pdfBase64 },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || `Resend 발송 실패 (HTTP ${res.status})`);
    }

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
