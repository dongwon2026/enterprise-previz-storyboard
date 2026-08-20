import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildExportTranslatePrompt } from "@/lib/exportTranslatePrompt";
import type { ExportTranslateInput, ExportTranslateCastInput, ExportTranslateFrameInput } from "@/lib/exportTranslatePrompt";
import { exportTranslateSchema } from "@/lib/exportTranslateSchema";
import type { ExportTranslateResult } from "@/lib/exportTranslateSchema";
import { requestJsonWithRetry, AiJsonFormatError } from "@/lib/aiJsonRetry";

// Design Ref: 사용자 요청 — "전체 복사"/".txt 다운로드" 결과는 구글 Flow Omni용으로 영어 번역해서 내보낸다.
// Vercel 서버리스 실행시간 제한 대비 (다른 storyboard 라우트와 동일)
export const maxDuration = 60;

// zod 형식 검증에 계속 실패했을 때만 던지는 전용 에러 (AI_FORMAT_ERROR와 구분하기 위함)
class ExportTranslateFormatError extends Error {}

// Design Ref: /api/storyboard, /api/storyboard/frame과 동일한 재시도 구조를 lib/aiJsonRetry.ts로
// 공유한다 (네트워크 자동 재시도 3회 + 형식 위반 시 실패 원인을 알려주며 재요청, 사용자 요청 3차로
// 신뢰성 강화 — DESIGN.md §11 참고)
async function requestExportTranslate(input: ExportTranslateInput): Promise<ExportTranslateResult> {
  const { system, user } = buildExportTranslatePrompt(input);

  try {
    return await requestJsonWithRetry({ system, user, schema: exportTranslateSchema });
  } catch (err) {
    if (err instanceof AiJsonFormatError) {
      throw new ExportTranslateFormatError("AI 응답이 번역 결과 형식 규칙을 지키지 않았습니다.");
    }
    throw err;
  }
}

function parseCastDescriptions(value: unknown): ExportTranslateCastInput[] {
  if (!Array.isArray(value)) return [];
  const result: ExportTranslateCastInput[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (
      typeof c.id === "string" &&
      typeof c.label === "string" &&
      typeof c.role === "string" &&
      typeof c.description === "string"
    ) {
      result.push({ id: c.id, label: c.label, role: c.role, description: c.description });
    }
  }
  return result;
}

function parseFrames(value: unknown): ExportTranslateFrameInput[] {
  if (!Array.isArray(value)) return [];
  const result: ExportTranslateFrameInput[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const f = item as Record<string, unknown>;
    if (
      typeof f.no === "number" &&
      typeof f.imageDescription === "string" &&
      typeof f.videoAction === "string" &&
      typeof f.audioNote === "string"
    ) {
      result.push({
        no: f.no,
        imageDescription: f.imageDescription,
        videoAction: f.videoAction,
        audioNote: f.audioNote,
      });
    }
  }
  return result;
}

export async function POST(request: NextRequest) {
  let body: {
    styleLock?: unknown;
    negativePrompt?: unknown;
    castDescriptions?: unknown;
    frames?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "요청 형식이 올바르지 않습니다." } },
      { status: 400 }
    );
  }

  const frames = parseFrames(body.frames);
  if (frames.length === 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "번역할 프레임이 없습니다." } },
      { status: 400 }
    );
  }

  const input: ExportTranslateInput = {
    styleLock: typeof body.styleLock === "string" ? body.styleLock : "",
    negativePrompt: typeof body.negativePrompt === "string" ? body.negativePrompt : "",
    castDescriptions: parseCastDescriptions(body.castDescriptions),
    frames,
  };

  try {
    const result = await requestExportTranslate(input);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof ExportTranslateFormatError) {
      return NextResponse.json(
        { error: { code: "AI_FORMAT_ERROR", message: err.message } },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", message: "번역 중 오류가 발생했습니다." } },
      { status: 502 }
    );
  }
}
