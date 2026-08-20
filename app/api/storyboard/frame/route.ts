import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildFrameRegenPrompt } from "@/lib/storyboardPrompt";
import type { CastMemberForPrompt, ReferenceForPrompt } from "@/lib/storyboardPrompt";
import { storyboardSchema, singleFrameSchema } from "@/lib/storyboardSchema";
import type { Frame } from "@/lib/storyboardSchema";
import { requestJsonWithRetry, AiJsonFormatError } from "@/lib/aiJsonRetry";
import {
  composeIdeaText,
  OVERVIEW_MIN_LENGTH,
  OVERVIEW_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  TARGET_MAX_LENGTH,
} from "@/lib/storyboardIdea";

// Design Ref: DESIGN.md §3 API 계약 — POST /api/storyboard/frame
// Vercel 서버리스 실행시간 제한 대비 (DESIGN.md §4, /api/storyboard와 동일)
export const maxDuration = 60;

// PRD/DESIGN에 지정된 값은 없지만, 자유 입력 지시문이 너무 길어지는 것을 막기 위한 안전장치
const INSTRUCTION_MAX_LENGTH = 200;

// zod 형식 검증에 계속 실패했을 때만 던지는 전용 에러 (AI_FORMAT_ERROR와 구분하기 위함)
class FrameFormatError extends Error {}

// Design Ref: DESIGN.md §2 데이터 흐름 ② — 자동 재시도 3회 + zod 형식 재요청은 /api/storyboard
// (전체 생성)와 lib/aiJsonRetry.ts를 공유한다 (PLAN.md 8번 "12번에도 동일 적용" + 사용자 요청 3차로
// 재시도 신뢰성 강화, DESIGN.md §11 참고)
async function requestFrameRegen(
  idea: string,
  frames: Frame[],
  frameNo: number,
  instruction: string | undefined,
  styleLock: string | undefined,
  castMembers: CastMemberForPrompt[] | undefined,
  reference: ReferenceForPrompt | undefined
): Promise<Frame> {
  const { system, user } = buildFrameRegenPrompt(idea, frames, frameNo, instruction, {
    styleLock,
    castMembers,
    reference,
  });

  try {
    // 재생성은 프레임 1개짜리 응답이라 전체 생성보다 훨씬 가볍고 빠르다 — Vercel maxDuration(60s)
    // 안에서도 여유가 있어 재시도를 3회까지 허용한다 (lib/aiJsonRetry.ts 기본값 2회보다 늘림).
    const result = await requestJsonWithRetry({
      system,
      user,
      schema: singleFrameSchema,
      maxAttempts: 3,
    });
    // 번호는 항상 요청한 frameNo로 고정한다 (AI가 다른 번호를 반환해도 안전하게 무시)
    return { ...result, no: frameNo };
  } catch (err) {
    if (err instanceof AiJsonFormatError) {
      throw new FrameFormatError("AI 응답이 프레임 형식 규칙을 지키지 않았습니다.");
    }
    throw err;
  }
}

// castMembers: 이 프레임에 태깅된 캐릭터(castRefs)의 설명 전문만 골라 클라이언트가 보내온다.
// 형식이 어긋나면 조용히 무시(빈 배열)하고 재생성 자체는 계속 진행한다.
function parseCastMembers(value: unknown): CastMemberForPrompt[] {
  if (!Array.isArray(value)) return [];
  const result: CastMemberForPrompt[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (
      typeof c.id === "string" &&
      typeof c.label === "string" &&
      typeof c.role === "string" &&
      typeof c.description === "string" &&
      c.description.length > 0
    ) {
      result.push({ id: c.id, label: c.label, role: c.role, description: c.description });
    }
  }
  return result;
}

// 사용자 요청 — 레퍼런스 예능 이름/이미지 분위기 묘사. 형식이 어긋나면 조용히 무시(undefined)한다.
function parseReference(value: unknown): ReferenceForPrompt | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const showName = typeof r.showName === "string" ? r.showName : undefined;
  const description = typeof r.description === "string" ? r.description : undefined;
  if (!showName?.trim() && !description?.trim()) return undefined;
  return { showName, description };
}

export async function POST(request: NextRequest) {
  let body: {
    title?: unknown;
    genres?: unknown;
    target?: unknown;
    overview?: unknown;
    reference?: unknown;
    frameNo?: unknown;
    frames?: unknown;
    instruction?: unknown;
    styleLock?: unknown;
    castMembers?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "요청 형식이 올바르지 않습니다." } },
      { status: 400 }
    );
  }

  // 사용자 요청 — 최초 생성 때와 같은 구조화 필드(제목/장르/시청 타깃/프로그램 개요)를 재생성
  // 요청에도 그대로 받아, 최초 생성 때와 동일한 문구로 다시 조립한다(서사 맥락이 어긋나지 않도록).
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const genres = Array.isArray(body.genres)
    ? body.genres.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
    : [];
  const target = typeof body.target === "string" ? body.target.trim() : "";
  const overview = typeof body.overview === "string" ? body.overview : "";
  const reference = parseReference(body.reference);

  if (!title || title.length > TITLE_MAX_LENGTH) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: `제목은 1~${TITLE_MAX_LENGTH}자여야 합니다.` } },
      { status: 400 }
    );
  }
  if (genres.length === 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "장르를 1개 이상 선택해주세요." } },
      { status: 400 }
    );
  }
  if (!target || target.length > TARGET_MAX_LENGTH) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: `시청 타깃은 1~${TARGET_MAX_LENGTH}자여야 합니다.` } },
      { status: 400 }
    );
  }
  if (overview.length < OVERVIEW_MIN_LENGTH || overview.length > OVERVIEW_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `프로그램 개요는 ${OVERVIEW_MIN_LENGTH}~${OVERVIEW_MAX_LENGTH}자여야 합니다. (현재 ${overview.length}자)`,
        },
      },
      { status: 400 }
    );
  }

  const idea = composeIdeaText({ title, genres, target, overview });

  const frameNo = typeof body.frameNo === "number" ? body.frameNo : NaN;
  if (!Number.isInteger(frameNo) || frameNo < 1 || frameNo > 12) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "frameNo는 1~12 사이의 정수여야 합니다.",
        },
      },
      { status: 400 }
    );
  }

  // Plan SC: PRD 5-2절 "프레임 번호와 순서는 항상 고정" — 나머지 8개 프레임도 형식이 온전한지 재검증
  const framesResult = storyboardSchema.safeParse({ frames: body.frames });
  if (!framesResult.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "frames 형식이 올바르지 않습니다 (12개, 각 100자 이상, 2~10초 짝수여야 합니다).",
        },
      },
      { status: 400 }
    );
  }

  const instruction =
    typeof body.instruction === "string"
      ? body.instruction.slice(0, INSTRUCTION_MAX_LENGTH)
      : undefined;
  const styleLock = typeof body.styleLock === "string" ? body.styleLock : undefined;
  const castMembers = parseCastMembers(body.castMembers);

  try {
    const frame = await requestFrameRegen(
      idea,
      framesResult.data.frames,
      frameNo,
      instruction,
      styleLock,
      castMembers,
      reference
    );
    return NextResponse.json({ data: { frame } });
  } catch (err) {
    if (err instanceof FrameFormatError) {
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
