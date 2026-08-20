import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOpenAIClient, CHARACTER_MODEL } from "@/lib/openai";
import { buildCharacterPrompt } from "@/lib/characterPrompt";
import { characterSchema } from "@/lib/characterSchema";
import { withRetry } from "@/lib/retry";

// Vercel 서버리스 실행시간 제한 대비 (다른 AI 호출 라우트와 동일하게 60초로 맞춘다)
export const maxDuration = 60;

// Vercel 서버리스 함수의 요청 본문 크기 제한(기본 약 4.5MB)에 걸리지 않도록,
// 원본 사진 파일 크기를 4MB로 제한한다 (base64로 인코딩하면 약 1.33배로 커짐)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

class CharacterFormatError extends Error {}

function parseDataUrl(
  dataUrl: string
): { mimeType: string; base64: string } | null {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

async function requestCharacterDescription(
  imageDataUrl: string
): Promise<string> {
  const { system, user } = buildCharacterPrompt();
  const client = getOpenAIClient();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const completion = await withRetry(() =>
      client.chat.completions.create({
        model: CHARACTER_MODEL,
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

    const result = characterSchema.safeParse(parsed);
    if (result.success) {
      return result.data.description;
    }
    // 마지막 시도가 아니면 같은 프롬프트로 한 번 더 요청한다
  }

  throw new CharacterFormatError("AI 응답이 캐릭터 설명 형식 규칙을 지키지 않았습니다.");
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
    const description = await requestCharacterDescription(imageDataUrl);
    return NextResponse.json({ data: { description } });
  } catch (err) {
    if (err instanceof CharacterFormatError) {
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
