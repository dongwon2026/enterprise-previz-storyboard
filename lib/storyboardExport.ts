import type { ExportTranslateResult } from "@/lib/exportTranslateSchema";
import { detectSafetyTags } from "@/lib/videoSafetyTags";

// Design Ref: 사용자 요청 — 구글 Flow Omni 2-step 워크플로우(정지 이미지 → 영상) 최적화 포맷팅.
// 화면(imageDescription/videoAction/audioNote/styleLock/negativePrompt)은 전부 한국어로 편집하고,
// 이 파일은 app/api/storyboard/export-translate가 돌려준 "번역된" 결과(ExportTranslateResult)만
// [IMAGE]/[VIDEO]/[AUDIO] 블록으로 조립한다. 실제 번역 호출은 StoryboardWorkspace.tsx가 한다 —
// 이 파일은 순수 조립(포맷팅)만 담당한다.

export type TranslatedFrame = ExportTranslateResult["frames"][number];
export type TranslatedCast = ExportTranslateResult["castDescriptions"][number];

// 사용자 요청(★중요, "구글 Flow 붕괴 방지용 필수 방어 텍스트") — 스타일 고정(styleLock) 영문 끝에
// 토씨 하나 틀림없이 무조건 붙어야 하는 문장. AI 번역에 맡기면 매번 미묘하게 다른 문장이 나올 수
// 있어(export-translate는 일반 번역 프롬프트라 이 문장의 "정확한 재현"을 보장하지 않음), 번역 결과와
// 무관하게 코드가 항상 이 문자열 그대로를 붙인다 — styleLock이 비어 있어도(PD가 지워도) 예외 없이 붙는다.
export const STYLE_LOCK_MANDATORY_SUFFIX =
  "broadcast-safe exposure. No on-screen text, no graphics, no subtitles, no UI overlays. All signage kept strictly out of focus and non-legible. Photoreal, high-end broadcast quality, not CGI.";

// 사용자 요청(2차, ★가장 강력한 규칙) — "audioNote 프롬프트 맨 마지막에는 무조건 'No intelligible
// dialogue.'를 덧붙여라." STYLE_LOCK_MANDATORY_SUFFIX와 같은 이유로(AI 번역에 맡기면 문구가 매번
// 미묘하게 달라질 수 있음) 번역 결과와 무관하게 코드가 항상 이 문자열 그대로를 붙인다 — audioNote가
// 비어 있어도(원문이 빈 값이어도) 예외 없이 붙는다.
export const AUDIO_NO_DIALOGUE_SUFFIX = "No intelligible dialogue.";

// Design Ref: 사용자 요청 §3 — "CAST & STYLE 텍스트 자동 병합(Auto-Append)" — 앱의 가장 중요한
// 인물 일관성 뼈대 로직. 모든 씬의 [IMAGE] 프롬프트 맨 마지막에 "이 씬에 태깅된 캐릭터의 영문
// 외형 묘사"와 "스타일 고정 영문 묘사" 전문을 무조건 자동으로 덧붙인다. 그래야 PD가 씬 하나만
// 골라서 복사해 구글 Flow에 붙여넣어도 룩앤필과 캐릭터가 그대로 유지된다 — 그래서 프레임 1개짜리
// 블록([IMAGE]+[VIDEO]+[AUDIO]+[NEGATIVE PROMPT])이 항상 "자기 완결형"이 되도록 만든다.
// (사용자 요청 §5) [VIDEO] 프롬프트 끝에는, 원본 한국어 문장에서 감지된 장르별 방어 태그를
// 코드가 결정적으로(=AI에게 맡기지 않고) 덧붙인다.
// 사용자 요청(2차, ★가장 강력한 규칙) — "발화(립싱크)를 묘사하거나 화면에 자막을 렌더링하도록
// 지시하면 얼굴 픽셀이 기괴하게 뭉개지는 치명적 에러가 발생한다." 그래서 [DIALOGUE] 블록을
// 100% 제거했다 — dialogue/caption 필드는 이제 화면(FrameCard)에서 PD 참고용으로만 보여주고,
// 구글 Flow Omni로 나가는 이 함수의 최종 출력에는 절대 포함시키지 않는다. 최종 출력은 항상
// [IMAGE]/[VIDEO]/[AUDIO]/[NEGATIVE PROMPT] 4블록으로만 구성된다.
export function buildFrameExportBlockEn({
  translatedFrame,
  durationSec,
  castTexts,
  styleLockEn,
  negativePromptEn,
  koreanSourceText,
}: {
  translatedFrame: TranslatedFrame;
  durationSec: number;
  castTexts: TranslatedCast[];
  styleLockEn: string;
  negativePromptEn: string;
  koreanSourceText: string;
}): string {
  const imageLines = [translatedFrame.imageDescription.trim()];
  for (const cast of castTexts) {
    if (cast.description.trim()) {
      imageLines.push(`${cast.label} (${cast.role}): ${cast.description.trim()}`);
    }
  }
  // 사용자 요청 — 방어 문구는 styleLock이 비어 있어도 무조건 붙는다("예외 없이")
  imageLines.push([styleLockEn.trim(), STYLE_LOCK_MANDATORY_SUFFIX].filter(Boolean).join(" "));

  const videoLines = [translatedFrame.videoAction.trim()];
  // 사용자 요청 §5 — 장르별 방어 태그는 AI 번역 결과가 아니라 원본 한국어 문장을 코드가 직접
  // 검사해서 결정한다 ("예외 없이 완벽하게 작동"해야 하므로 AI 판단에 맡기지 않는다).
  videoLines.push(...detectSafetyTags(koreanSourceText));

  // 사용자 요청(2차) — audioNote 끝에 "No intelligible dialogue."를 무조건 코드로 붙인다
  // (audioNote가 비어 있어도 예외 없이 붙는다 — STYLE_LOCK_MANDATORY_SUFFIX와 동일한 원칙).
  const audioLine = [translatedFrame.audioNote.trim(), AUDIO_NO_DIALOGUE_SUFFIX]
    .filter(Boolean)
    .join(" ");

  const parts = [
    `[IMAGE]\n${imageLines.join("\n")}`,
    `[VIDEO - ${durationSec}s]\n${videoLines.join("\n")}`,
    `[AUDIO]\n${audioLine}`,
  ];

  if (negativePromptEn.trim()) {
    parts.push(`[NEGATIVE PROMPT]\n${negativePromptEn.trim()}`);
  }

  return parts.join("\n\n");
}

/** 프레임 1개 분량의 입력 — buildStoryboardExportTextEn/buildFrameExportBlockEn 호출부가 함께 넘긴다 */
export type ExportFrameContext = {
  no: number;
  durationSec: number;
  castTexts: TranslatedCast[];
  koreanSourceText: string;
};

// 전체 12프레임을 각각 자기완결형 블록으로 만든 뒤 "Frame N (Ns)" 헤더와 함께 이어 붙인다
// ("전체 복사"/".txt 다운로드"용 — 사용자 요청 §3에 따라 STYLE LOCK/CAST를 한 번만 상단에 두지
// 않고, 각 프레임 블록 안에 반복해서 자동으로 덧붙인다).
export function buildStoryboardExportTextEn(
  translated: ExportTranslateResult,
  frameContexts: ExportFrameContext[]
): string {
  const contextByNo = new Map(frameContexts.map((c) => [c.no, c]));

  const blocks = translated.frames.map((frame) => {
    const ctx = contextByNo.get(frame.no);
    const block = buildFrameExportBlockEn({
      translatedFrame: frame,
      durationSec: ctx?.durationSec ?? 0,
      castTexts: ctx?.castTexts ?? [],
      styleLockEn: translated.styleLock,
      negativePromptEn: translated.negativePrompt,
      koreanSourceText: ctx?.koreanSourceText ?? "",
    });
    return `Frame ${frame.no} (${ctx?.durationSec ?? 0}s)\n${block}`;
  });

  return blocks.join("\n\n---\n\n");
}

// Design Ref: DESIGN.md §1 화면 구성 [하단] 내보내기 영역 — "파일명: storyboard_YYYYMMDD-HHmm.txt"
export function buildStoryboardFilename(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `storyboard_${y}${m}${d}-${hh}${mm}.txt`;
}
