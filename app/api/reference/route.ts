import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOpenAIClient, REFERENCE_MODEL } from "@/lib/openai";
import { buildReferencePrompt } from "@/lib/referencePrompt";
import { referenceSchema } from "@/lib/referenceSchema";
import { withRetry } from "@/lib/retry";

// 사용자 요청 — 레퍼런스 예능 이미지 분위기 묘사 생성. app/api/character/route.ts와 완전히
// 같은 구조(이미지 검증 → 비전 모델 호출 → zod 형식 검증 + 1회 재요청)를 그대로 재사용한다.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

class ReferenceFormatError extends Error {}

function parseDataUrl(
  dataUrl: string
): { mimeType: string; base64: string } | null {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

async function requestReferenceDescription(
  imageDataUrl: string
): Promise<string> {
  const { system, user } = buildReferencePrompt();
  const client = getOpenAIClient();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const completion = await withRetry(() =>
      client.chat.completions.create({
        model: REFERENCE_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      })
    );

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // JSON 자체가 깨졌으면 형식 재요청으로 취급
    }

    const result = referenceSchema.safeParse(parsed);
    if (result.success) {
      return result.data.description;
    }
    // 마지막 시도가 아니면 같은 프롬프트로 한 번 더 요청한다
  }

  throw new ReferenceFormatError("AI 응답이 레퍼런스 묘사 형식 규칙을 지키지 않았습니다.");
}

export async function POST(request: NextRequest) {
  let body: { imageDataUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "요청 형식이 올바르지 않습니다." } },
      { status: 400 }
    );
  }

  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
  const parsed = parseDataUrl(imageDataUrl);
  if (!parsed) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "이미지 파일 형식이 올바르지 않습니다. JPG, PNG, WEBP 파일만 지원합니다.",
        },
      },
      { status: 400 }
    );
  }

  if (!ALLOWED_IMAGE_TYPES.includes(parsed.mimeType)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "JPG, PNG, WEBP 파일만 업로드할 수 있습니다.",
        },
      },
      { status: 400 }
    );
  }

  const imageBytes = Buffer.byteLength(parsed.base64, "base64");
  if (imageBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `사진 파일은 최대 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB까지 업로드할 수 있습니다.`,
        },
      },
      { status: 400 }
    );
  }

  try {
    const description = await requestReferenceDescription(imageDataUrl);
    return NextResponse.json({ data: { description } });
  } catch (err) {
    if (err instanceof ReferenceFormatError) {
      return NextResponse.json(
        { error: { code: "AI_FORMAT_ERROR", message: err.message } },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", message: "AI 호출 중 오류가 발생했습니다." } },
      { status: 502 }
    );
  }
}
