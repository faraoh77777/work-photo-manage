// Supabase Edge Function: analyze-scaffold
//
// "AI 비계 물량산출" 기능(scaffold.html, work-photo-scaffold.js)의 "설치 후 실측" 모드가 호출한다.
// 사진 속 비계의 가로 스팬(칸) 수 / 세로 단(층) 수 / 4개 모서리 위치를 Claude Vision으로 추정해
// 돌려준다. 다른 Edge Function(generate-work-instruction, send-instruction-email)과 로직/코드를
// 공유하지 않고 완전히 독립적으로 작성했다 — 이 기능을 나중에 별도 저장소로 옮길 때 이 파일 하나만
// 그대로 복사하면 되도록 하기 위함이다.
//
// 배포 방법 (Supabase CLI 필요, 최초 1회):
//   1) npm install -g supabase
//   2) supabase login
//   3) supabase link --project-ref <프로젝트 참조 ID>
//   4) supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
//      (generate-work-instruction에서 이미 설정했다면 이 단계는 생략 가능 — 같은 프로젝트면 secret 공유)
//   5) supabase functions deploy analyze-scaffold
//
// 배포 후 클라이언트에서 호출하는 URL:
//   https://<프로젝트 참조 ID>.supabase.co/functions/v1/analyze-scaffold

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildSystemPrompt(spanLengthM: number, widthM: number, levelHeightM: number): string {
  return `당신은 건설 현장에 설치된 강관 비계(scaffolding) 사진을 보고 물량을 추정하는 보조원입니다.
기준 모듈값(비계 1칸의 표준 규격)은 다음과 같습니다:
- 스팬(가로 1칸) 길이: ${spanLengthM}m
- 폭(전후 방향): ${widthM}m
- 단(층) 높이: ${levelHeightM}m

사진에서 비계 구조물을 보고 다음을 판단하세요:
1. 가로 방향으로 몇 칸(스팬)이 보이는지 (span_count)
2. 세로 방향으로 몇 단(층)이 보이는지 (level_count)
3. 비계 전체 영역의 4개 모서리를, 이미지 전체 크기를 0~1 비율로 환산한 좌표로 추정 (좌상단 tl, 우상단 tr,
   좌하단 bl, 우하단 br — 각 {"x":0~1,"y":0~1})

사진이 흐릿하거나, 비계 일부만 보이거나, 각도 때문에 칸/단을 세기 어렵다면 절대 추측해서 지어내지 말고
confidence를 "low"로 표시하고 notes에 이유를 적으세요. 확실할 때만 confidence를 "high"로 표시하세요.

반드시 아래 JSON 형식으로만 응답하세요. 그 외 설명, 인사말, 코드블록 표시(\`\`\`)는 절대 붙이지 마세요.
{
  "span_count": 숫자,
  "level_count": 숫자,
  "confidence": "high" | "medium" | "low",
  "corners": {"tl": {"x":0~1,"y":0~1}, "tr": {"x":0~1,"y":0~1}, "bl": {"x":0~1,"y":0~1}, "br": {"x":0~1,"y":0~1}},
  "notes": "판단 근거 또는 불확실한 이유"
}`;
}

function parseDataUrl(input: string): { mediaType: string; base64: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(input);
  if (match) return { mediaType: match[1], base64: match[2] };
  // data URL 접두사 없이 순수 base64만 온 경우
  return { mediaType: "image/jpeg", base64: input };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다 (supabase secrets set ANTHROPIC_API_KEY=...)");
    }

    const body = await req.json();
    const imageInput = body?.image_base64;
    if (!imageInput || typeof imageInput !== "string") {
      throw new Error("사진 데이터(image_base64)가 없습니다");
    }
    const spanLengthM = Number(body?.span_length_m) > 0 ? Number(body.span_length_m) : 1.8;
    const widthM = Number(body?.width_m) > 0 ? Number(body.width_m) : 0.4;
    const levelHeightM = Number(body?.level_height_m) > 0 ? Number(body.level_height_m) : 1.8;

    const { mediaType, base64 } = parseDataUrl(imageInput);

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: buildSystemPrompt(spanLengthM, widthM, levelHeightM),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg", data: base64 },
            },
            { type: "text", text: "이 사진 속 비계의 스팬 수/단 수/모서리 좌표를 위 형식으로 추정해주세요." },
          ],
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const raw = (textBlock?.text || "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 응답을 이해하지 못했습니다: " + raw.slice(0, 200));
    const parsed = JSON.parse(jsonMatch[0]);

    const corners = parsed.corners || {};
    const okCorner = (c: unknown) =>
      c && typeof (c as { x?: unknown }).x === "number" && typeof (c as { y?: unknown }).y === "number";
    if (!okCorner(corners.tl) || !okCorner(corners.tr) || !okCorner(corners.bl) || !okCorner(corners.br)) {
      throw new Error("AI 응답에 모서리 좌표가 없습니다");
    }
    if (typeof parsed.span_count !== "number" || typeof parsed.level_count !== "number") {
      throw new Error("AI 응답에 칸수/단수가 없습니다");
    }

    return new Response(
      JSON.stringify({
        ok: true,
        span_count: parsed.span_count,
        level_count: parsed.level_count,
        confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
        corners,
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
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
