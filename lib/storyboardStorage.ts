import type { Frame } from "@/components/FrameCard";
import { DEFAULT_STYLE_LOCK, DEFAULT_NEGATIVE_PROMPT } from "@/lib/styleLockDefaults";

// Design Ref: DESIGN.md §2 데이터 흐름 ③ 저장/복원
// "저장 항목: 기획 아이디어 원문, 12프레임 각각의 설명/분량/재생성횟수" — 로딩/에러/되돌리기 임시 보관 같은
// 화면 전용 상태는 저장하지 않는다 (새로고침해도 다시 만들면 되는 값들이라 저장 대상이 아님).
// 사용자 요청으로 styleLock/negativePrompt(전역 텍스트)와 characterDescriptions(캐릭터1/2/3 설명
// "텍스트")도 함께 저장한다 — 사진 원본은 여전히 저장하지 않는다(개인 사진 최소 취급 원칙 유지).
// 사용자 요청 — 기획 아이디어 입력을 제목/장르/시청 타깃/프로그램 개요 4개 구조화 필드(표 형식)로
// 바꾸면서, 기존 idea(원문 한 덩어리 문자열) 대신 이 4개 필드를 저장한다. 레퍼런스 예능 이름/분위기
// 묘사도 캐릭터 설명과 같은 원칙(원본 사진은 저장하지 않고, AI가 만든 텍스트만 저장)으로 저장한다.
const STORAGE_KEY = "ena-previz-storyboard";

export type StoredStoryboard = {
  title: string;
  genres: string[];
  target: string;
  overview: string;
  referenceShowName: string;
  referenceDescription: string | null;
  frames: Frame[] | null;
  styleLock: string;
  negativePrompt: string;
  characterDescriptions: Record<string, string | null>;
  // 사용자 요청 — "생성된 캐릭터들에 대한 역할을 작성할 수 있게 해줘" (이번 기획에서 각 인물이
  // 맡는 역할, 예: "시골 이장님"). characterDescriptions와 달리 항상 문자열(빈 문자열이 "미입력")이다.
  characterRoles: Record<string, string>;
};

// imageDescription/videoAction/audioNote/castRefs/dialogue/caption이 없는 예전 형식의 프레임은
// 새 스키마와 맞지 않아 무효로 취급한다 (구버전 저장값은 자동으로 사라지고, 새로고침 후
// 스토리보드를 새로 생성해야 한다 — 사용자 요청으로 dialogue/caption 필드가 추가되며 다시 한번 발생)
function isValidFrame(value: unknown): value is Frame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (
    typeof frame.no === "number" &&
    typeof frame.imageDescription === "string" &&
    typeof frame.durationSec === "number" &&
    typeof frame.regenCount === "number" &&
    typeof frame.videoAction === "string" &&
    typeof frame.audioNote === "string" &&
    typeof frame.dialogue === "string" &&
    typeof frame.caption === "string" &&
    Array.isArray(frame.castRefs) &&
    frame.castRefs.every((id) => typeof id === "string")
  );
}

function isValidCharacterDescriptions(value: unknown): value is Record<string, string | null> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => v === null || typeof v === "string"
  );
}

function isValidCharacterRoles(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

/** 서버 DB가 없으므로 브라우저 localStorage에서 마지막 작업 상태를 읽어온다 (없거나 손상됐으면 null) */
export function loadStoryboard(): StoredStoryboard | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const data = parsed as Record<string, unknown>;

    // 사용자 요청 — 기획 아이디어가 예전 형식(idea 한 덩어리 문자열)으로 저장돼 있으면, 그 값을
    // "프로그램 개요" 필드로 옮겨 담아 되살린다 (기존 작업 내용을 스토리보드 구조 변경만으로
    // 통째로 잃지 않도록). 제목/장르/시청 타깃은 예전 형식에 없던 값이라 빈 값으로 시작한다.
    let title: string;
    let genres: string[];
    let target: string;
    let overview: string;
    if (typeof data.overview === "string") {
      title = typeof data.title === "string" ? data.title : "";
      genres = Array.isArray(data.genres) ? data.genres.filter((g): g is string => typeof g === "string") : [];
      target = typeof data.target === "string" ? data.target : "";
      overview = data.overview;
    } else if (typeof data.idea === "string") {
      title = "";
      genres = [];
      target = "";
      overview = data.idea;
    } else {
      return null;
    }

    const referenceShowName = typeof data.referenceShowName === "string" ? data.referenceShowName : "";
    const referenceDescription =
      typeof data.referenceDescription === "string" ? data.referenceDescription : null;
    const styleLock = typeof data.styleLock === "string" ? data.styleLock : DEFAULT_STYLE_LOCK;
    const negativePrompt =
      typeof data.negativePrompt === "string" ? data.negativePrompt : DEFAULT_NEGATIVE_PROMPT;
    const characterDescriptions = isValidCharacterDescriptions(data.characterDescriptions)
      ? data.characterDescriptions
      : {};
    const characterRoles = isValidCharacterRoles(data.characterRoles) ? data.characterRoles : {};

    const base = {
      title,
      genres,
      target,
      overview,
      referenceShowName,
      referenceDescription,
      styleLock,
      negativePrompt,
      characterDescriptions,
      characterRoles,
    };

    if (data.frames === null) {
      return { ...base, frames: null };
    }
    if (Array.isArray(data.frames) && data.frames.every(isValidFrame)) {
      return { ...base, frames: data.frames as Frame[] };
    }
    return null;
  } catch {
    return null;
  }
}

/** 아이디어·프레임·스타일 설정·캐릭터 설명이 바뀔 때마다 호출해 localStorage에 그대로 덮어쓴다 */
export function saveStoryboard(state: StoredStoryboard): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 저장 공간 초과 등으로 실패해도 화면 동작 자체는 계속돼야 하므로 조용히 무시한다
  }
}
