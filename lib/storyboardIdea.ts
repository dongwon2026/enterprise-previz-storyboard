// 사용자 요청 — "예능 기획 아이디어" 입력 칸을 표 형식(제목/장르/시청 타깃/프로그램 개요 4행)으로
// 바꾼다. AI 프롬프트(lib/storyboardPrompt.ts)에는 여전히 한 덩어리의 텍스트로 넘겨야 하므로,
// 화면(StoryboardWorkspace.tsx)과 서버(app/api/storyboard(/frame)/route.ts)가 공통으로 쓰는
// "구조화 필드 → 한 덩어리 텍스트" 조립 함수를 이 파일 한 곳에 둔다 — 두 쪽이 서로 다른 문구로
// 조립하면 AI에게 전달되는 맥락이 어긋나기 때문.
export type IdeaFields = {
  title: string;
  genres: string[];
  target: string;
  overview: string;
};

// 기존 "입력 글자 수는 50~500자만 허용" 규칙(PRD 5-1절)은 이제 자유 서술형인 "프로그램 개요"
// 필드에만 적용한다. 제목/시청 타깃은 짧은 구조화 필드라 별도로 상한만 둔다.
export const OVERVIEW_MIN_LENGTH = 50;
export const OVERVIEW_MAX_LENGTH = 500;
export const TITLE_MAX_LENGTH = 60;
export const TARGET_MAX_LENGTH = 60;
export const MAX_GENRE_COUNT = 10;

// 사용자 요청에 명시된 장르 프리셋 태그 목록 (순서 그대로 노출) — "기타"는 프리셋이 아니라
// 화면에서 직접 입력한 값을 태그로 추가하는 별도 입력창으로 구현한다.
export const GENRE_PRESETS = [
  "여행", "음악", "음식", "관찰", "스포츠", "연애", "두뇌게임", "장사/경영", "교양",
  "페이크다큐", "힐링", "부동산", "토크쇼", "오디션", "서바이벌", "버라이어티", "리얼리티", "크로스오버",
] as const;

/** 구조화된 4개 필드를 AI 프롬프트/미리보기에 쓸 한 덩어리의 한국어 텍스트로 합친다 */
export function composeIdeaText(fields: IdeaFields): string {
  return `제목: ${fields.title.trim()}\n장르: ${fields.genres.join(", ")}\n시청 타깃: ${fields.target.trim()}\n프로그램 개요: ${fields.overview.trim()}`;
}
