import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildStoryboardPrompt } from "@/lib/storyboardPrompt";
import type { CastMemberForPrompt, ReferenceForPrompt } from "@/lib/storyboardPrompt";
import { storyboardGenerationSchema } from "@/lib/storyboardSchema";
import type { Frame } from "@/lib/storyboardSchema";
import { requestJsonWithRetry, AiJsonFormatError } from "@/lib/aiJsonRetry";
import {
  composeIdeaText,
  OVERVIEW_MIN_LENGTH,
  OVERVIEW_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  TARGET_MAX_LENGTH,
} from "@/lib/storyboardIdea";

// Design Ref: DESIGN.md §3 API 계약 — POST /api/storyboard
// Vercel 서버리스 실행시간 제한 대비 (DESIGN.md §4)
export const maxDuration = 60;

// zod 형식 검증에 계속 실패했을 때만 던지는 전용 에러 (AI_FORMAT_ERROR와 구분하기 위함)
class StoryboardFormatError extends Error {}

// Design Ref: DESIGN.md §2 데이터 흐름 ① — zod 검증 실패 시 형식 재요청 (네트워크 오류에 대한
// 자동 재시도 3회는 PLAN.md 8번에서 별도로 감싸 붙인다, lib/aiJsonRetry.ts 내부)
// 사용자 요청 — "스타일 고정을 스토리보드에 맞게 그때그때 수정". frames와 함께 AI가 새로 제안한
// styleLock도 함께 돌려받는다 (storyboardGenerationSchema — frames 12개 검증 + styleLock 필수).
// 사용자 요청(3차) — "AI 응답이 12프레임 형식 규칙을 지키지 않았습니다"가 가끔 발생하는 문제를
// "무조건 12프레임 나오도록 강제"해달라는 요청. 실제 재시도 로직(3회 + 실패 원인 피드백 +
// 넉넉한 max_tokens)은 lib/aiJsonRetry.ts로 옮겨 3개 라우트가 공유한다 (DESIGN.md §11 참고).
async function requestStoryboard(
  idea: string,
  styleLock: string | undefined,
  castMembers: CastMemberForPrompt[] | undefined,
  reference: ReferenceForPrompt | undefined
): Promise<{ frames: Frame[]; styleLock: string }> {
  const { system, user } = buildStoryboardPrompt(idea, { styleLock, castMembers, reference });

  try {
    return await requestJsonWithRetry({ system, user, schema: storyboardGenerationSchema });
  } catch (err) {
    if (err instanceof AiJsonFormatError) {
      throw new StoryboardFormatError("AI 응답이 12프레임 형식 규칙을 지키지 않았습니다.");
    }
    throw err;
  }
}

// 캐릭터1/2/3 설명 생성 박스에서 넘어온 값 — 형식이 어긋나면 조용히 무시(빈 배열)하고
// 스토리보드 생성 자체는 계속 진행한다 (인물 일관성 기능은 선택 사항이라 필수 입력이 아님)
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

// 사용자 요청 — 레퍼런스 예능 이름/이미지 분위기 묘사. 형식이 어긋나면 조용히 무시(undefined 필드)
// 하고 스토리보드 생성 자체는 계속 진행한다 (선택 입력이라 필수가 아님).
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

  // 사용자 요청 — 기획 아이디어 입력을 제목/장르/시청 타깃/프로그램 개요 4개 구조화 필드(표 형식)로
  // 받는다. 기존 "50~500자" 규칙(PRD 5-1절)은 자유 서술형인 프로그램 개요 필드에만 적용한다.
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const genres = Array.isArray(body.genres)
    ? body.genres.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
    : [];
  const target = typeof body.target === "string" ? body.target.trim() : "";
  const overview = typeof body.overview === "string" ? body.overview : "";
  const styleLock = typeof body.styleLock === "string" ? body.styleLock : undefined;
  const castMembers = parseCastMembers(body.castMembers);
  const reference = parseReference(body.reference);

  if (!title || title.length > TITLE_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `제목은 1~${TITLE_MAX_LENGTH}자여야 합니다.`,
        },
      },
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
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `시청 타깃은 1~${TARGET_MAX_LENGTH}자여야 합니다.`,
        },
      },
      { status: 400 }
    );
  }
  // Plan SC: PRD 5절 — 50~500자 범위, 화면 검증을 우회해도 서버가 다시 막는다
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

  try {
    const result = await requestStoryboard(idea, styleLock, castMembers, reference);
    return NextResponse.json({
      data: { idea, frames: result.frames, styleLock: result.styleLock },
    });
  } catch (err) {
    if (err instanceof StoryboardFormatError) {
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
