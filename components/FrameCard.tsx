"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { FRAME_DURATIONS } from "@/lib/storyboardSchema";
import { castLabel } from "@/lib/castCharacters";

// Design Ref: 사용자 요청 — 구글 Flow Omni 2-step 워크플로우(정지 이미지 → 영상) 최적화 포맷팅.
// description+cameraNote를 imageDescription([IMAGE], 정지 이미지 프롬프트)과
// videoAction([VIDEO], 카메라 무빙+동작)으로 분리했다. audioNote는 이름 그대로 유지.
export type Frame = {
  no: number;
  imageDescription: string;
  durationSec: number;
  regenCount: number;
  // 카메라 무빙+동작 지시([VIDEO])·오디오 지시([AUDIO])는 본문(imageDescription)과 분리해서 관리한다
  // (립싱크 실패 방지 및 Flow Omni 렌더 안정성 목적)
  videoAction: string;
  audioNote: string;
  // 사용자 요청 — 대사(캐릭터 국적에 맞춰 한국어/영어)와 그에 맞는 한국어 방송 자막.
  // 대사가 없는 장면(리액션 샷 등)은 둘 다 빈 문자열일 수 있다. [IMAGE]/[VIDEO] 시각 프롬프트와는
  // 분리된 참고용 필드라 화면에도 별도로만 표시하고, 편집 UI는 두지 않는다(AI가 생성한 값 그대로).
  // 사용자 요청(2차) — 구글 Flow Omni는 발화 묘사를 립싱크로 시도하다 얼굴이 뭉개지는 렌더 오류를
  // 일으켜, 이 두 필드는 이제 PD가 화면에서 참고만 하는 값이고 구글 Flow Omni로 나가는 영어
  // 내보내기([IMAGE]/[VIDEO]/[AUDIO]/[NEGATIVE PROMPT])에는 절대 포함되지 않는다(lib/storyboardExport.ts).
  dialogue: string;
  caption: string;
  // 이 프레임에 태깅된 캐릭터(캐릭터1/2/3/4/5 설명 생성 박스) id 목록 — 인물 일관성 유지용
  castRefs: string[];
};

// PD의 수정 지시가 castRefs로 태깅된 인물의 "외형 자체"를 바꾸려는 내용인지 대략 감지하는 키워드.
// 완벽한 의미 분석은 아니고, "충돌 가능성을 알려주는" 용도의 가벼운 힌트일 뿐이다.
// 실제 차단은 서버 프롬프트(lib/storyboardPrompt.ts)가 "외형은 무시하고 나머지만 반영"하도록 지시한다.
const IDENTITY_CHANGE_KEYWORDS = [
  "남자로", "여자로", "성별", "다른 사람", "다른사람", "사람을 바꿔", "인물을 바꿔",
  "얼굴을", "나이를", "나이대", "체형을", "머리색", "머리 색", "헤어스타일", "인종",
  "키를", "외모를", "생김새",
];

function mentionsIdentityChange(instruction: string): boolean {
  return IDENTITY_CHANGE_KEYWORDS.some((kw) => instruction.includes(kw));
}

const FRAME_DESCRIPTION_MIN_LENGTH = 100;
// Plan SC: PRD 5-2절 "동일 프레임에 대한 재생성 요청은 최대 10회까지만 허용한다"
export const MAX_REGEN_COUNT = 10;

// Design Ref: DESIGN.md §1 화면 구성 — "클릭하면 직접 타이핑해서 수정 가능 (100자 미만으로 줄이면 저장 차단 + 안내)"
// Plan SC: PLAN.md 10번 — AI를 호출하지 않는 순수 클라이언트 동작. 편집 상태(editing/draft/error)는
// 이 카드 하나 안에서만 필요해서 부모(StoryboardWorkspace)로 올리지 않고 여기서 직접 들고 있는다.
// Plan SC: PLAN.md 11번 — 분량(초) 선택은 2/4/6/8/10초만 허용 (lib/storyboardSchema.ts의 값과 동일하게 재사용)
// Plan SC: PLAN.md 12번 — "재생성" 버튼 + 선택 지시 입력창. 실제 API 호출/로딩/에러 상태는
// idea·frames 전체를 알아야 해서 부모(StoryboardWorkspace)가 소유하고, 여기서는 props로만 받는다.
// (재생성 지시문 입력창의 값 자체는 이 카드 안에서만 필요해 로컬 상태로 둔다)
// Plan SC: PLAN.md 14번 — 재생성 실패 시 에러 문구 옆에 전용 "재시도" 버튼을 별도로 노출한다
// Plan SC: PLAN.md 15번 — "방금 되돌리기"는 항상 카드에 보이되, 이 카드가 가장 최근에
// 재생성된 카드일 때(canUndo)만 눌리도록 한다 (버전 이력이 아니라 1단계만 지원)
// 사용자 요청 §3 — "이 프레임 복사"는 이제 이 프레임 하나만으로도 구글 Flow Omni에 바로 붙여넣을 수
// 있도록, 영어로 번역 + [IMAGE]/[VIDEO]/[AUDIO] 블록 조립 + 캐릭터·스타일 자동 병합까지 마친 텍스트를
// 복사해야 한다. 번역은 네트워크 호출이 필요해 부모(StoryboardWorkspace)가 처리하고, 이 카드는
// onCopyFrame(no)를 호출해 결과 텍스트(or 실패 시 null)를 돌려받기만 한다.
export default function FrameCard({
  frame,
  onSave,
  onDurationChange,
  regenerating,
  regenerateError,
  onRegenerate,
  canUndo,
  onUndo,
  onToggleCastRef,
  onCopyFrame,
  copyingFrame,
}: {
  frame: Frame;
  onSave: (no: number, imageDescription: string) => void;
  onDurationChange: (no: number, durationSec: number) => void;
  regenerating: boolean;
  regenerateError?: string;
  onRegenerate: (no: number, instruction: string) => void;
  canUndo: boolean;
  onUndo: (no: number) => void;
  onToggleCastRef: (no: number, characterId: string) => void;
  onCopyFrame: (no: number) => Promise<string | null>;
  copyingFrame: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(frame.imageDescription);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);

  function startEdit() {
    setDraft(frame.imageDescription);
    setError(null);
    setEditing(true);
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(event.target.value);
    if (event.target.value.length >= FRAME_DESCRIPTION_MIN_LENGTH) {
      setError(null);
    }
  }

  function handleSave() {
    if (draft.length < FRAME_DESCRIPTION_MIN_LENGTH) {
      setError(
        `프레임 설명은 최소 ${FRAME_DESCRIPTION_MIN_LENGTH}자 이상이어야 합니다. (현재 ${draft.length}자)`
      );
      return;
    }
    onSave(frame.no, draft);
    setEditing(false);
    setError(null);
  }

  function handleCancel() {
    setDraft(frame.imageDescription);
    setError(null);
    setEditing(false);
  }

  function handleDurationChange(event: ChangeEvent<HTMLSelectElement>) {
    onDurationChange(frame.no, Number(event.target.value));
  }

  function handleRegenerateClick() {
    onRegenerate(frame.no, instruction);
  }

  async function handleCopy() {
    const text = await onCopyFrame(frame.no);
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없는 등 드문 경우 — 별도 에러 배너 없이 조용히 무시(버튼 문구만 원상 복구)
      setCopied(false);
    }
  }

  const regenLimitReached = frame.regenCount >= MAX_REGEN_COUNT;

  return (
    <article className="relative rounded border border-gray-200 p-4 shadow-sm">
      {regenerating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded bg-white/80">
          <p className="text-sm font-bold text-ena-blue">재생성 중...</p>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold text-ena-blue">{frame.no}번</p>
        <label className="flex items-center gap-1 text-sm text-gray-600">
          분량
          <select
            value={frame.durationSec}
            onChange={handleDurationChange}
            className="rounded border border-gray-300 px-1 py-0.5 text-sm outline-none focus:border-ena-blue"
          >
            {FRAME_DURATIONS.map((sec) => (
              <option key={sec} value={sec}>
                {sec}초
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 이 프레임에 태깅된 캐릭터 — 칩을 눌러 이 프레임에서만 태그를 뺄 수 있다.
          태그를 추가하려면 캐릭터 설명 박스의 "이 인물을 프레임에 적용"을 사용한다. */}
      {frame.castRefs.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {frame.castRefs.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onToggleCastRef(frame.no, id)}
              title="클릭하면 이 프레임에서만 태그를 뺍니다"
              className="rounded-full border border-ena-blue bg-blue-50 px-2 py-0.5 text-xs font-bold text-ena-blue hover:bg-blue-100"
            >
              {castLabel(id)} ×
            </button>
          ))}
        </div>
      )}

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={handleChange}
            rows={6}
            autoFocus
            className="w-full resize-none rounded border border-gray-300 p-2 text-sm outline-none focus:border-ena-blue"
          />
          <p
            className={`mt-1 text-xs ${
              draft.length < FRAME_DESCRIPTION_MIN_LENGTH
                ? "text-red-600"
                : "text-gray-500"
            }`}
            aria-live="polite"
          >
            {draft.length}자 (최소 {FRAME_DESCRIPTION_MIN_LENGTH}자)
          </p>
          {error && (
            <p className="mt-1 text-xs text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded bg-ena-blue px-3 py-1 text-xs font-bold text-white"
            >
              저장
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <>
          <p
            onClick={startEdit}
            title="클릭해서 수정"
            className="cursor-text rounded text-sm leading-relaxed text-gray-800 hover:bg-gray-50"
          >
            {frame.imageDescription}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            disabled={copyingFrame}
            className="mt-2 rounded border border-gray-300 px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copyingFrame ? "영어로 번역 중..." : copied ? "복사됨!" : "이 프레임 복사"}
          </button>
        </>
      )}

      {/* 카메라 무빙+동작([VIDEO])·오디오([AUDIO]) 지시는 본문과 분리된 필드라 편집 중이든 아니든
          항상 그대로 보여준다 (직접 타이핑 수정 대상이 아니라 AI가 생성한 값을 그대로 표시만 함) */}
      <div className="mt-2 space-y-0.5 text-xs text-gray-500">
        <p>카메라·동작: {frame.videoAction}</p>
        <p>오디오: {frame.audioNote}</p>
        {/* 사용자 요청 — 대사/자막은 있을 때만 표시 (리액션 샷 등 대사 없는 프레임이 더 많음).
            사용자 요청(2차) — 구글 Flow Omni 렌더 오류 방지를 위해 실제 영상에는 반영되지 않고
            PD 참고용으로만 화면에 남는다는 점을 함께 안내한다. */}
        {frame.dialogue && (
          <p>
            대사: {frame.dialogue}{" "}
            <span className="text-gray-400">
              (참고용 — 영상에는 표정·제스처로만 반영되고 대사로 렌더링되지 않습니다)
            </span>
          </p>
        )}
        {frame.caption && <p>자막: {frame.caption}</p>}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <input
          type="text"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="수정 지시 (선택, 예: 더 밝게)"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-ena-blue"
        />
        {/* 캐릭터가 태깅된 프레임에서 외형을 바꾸는 듯한 지시를 입력하면 미리 알려준다.
            실제로 외형이 바뀌지 않도록 막는 건 서버 프롬프트(lib/storyboardPrompt.ts) 쪽 지시이고,
            여기서는 PD에게 "충돌할 수 있다"는 안내만 보여준다(차단하지 않음). */}
        {frame.castRefs.length > 0 && mentionsIdentityChange(instruction) && (
          <p className="mt-1 text-xs text-orange-600" role="alert">
            ⚠️ 이 프레임에는 캐릭터({frame.castRefs.map(castLabel).join(", ")})가 태깅되어 있어,
            외형을 바꾸는 지시는 인물 일관성과 충돌할 수 있습니다. (태깅된 인물의 외형은 유지된 채
            나머지 지시만 반영됩니다)
          </p>
        )}
        <button
          type="button"
          onClick={handleRegenerateClick}
          disabled={regenerating || regenLimitReached}
          className="mt-2 w-full rounded border border-ena-blue py-1.5 text-xs font-bold text-ena-blue disabled:cursor-not-allowed disabled:opacity-40"
        >
          재생성
        </button>
        <p
          className={`mt-1 text-xs ${regenLimitReached ? "text-red-600" : "text-gray-500"}`}
        >
          {regenLimitReached
            ? `재생성 ${frame.regenCount}/${MAX_REGEN_COUNT}회 사용 (더 이상 재생성할 수 없습니다)`
            : `재생성 ${frame.regenCount}/${MAX_REGEN_COUNT}회 사용`}
        </p>

        <button
          type="button"
          onClick={() => onUndo(frame.no)}
          disabled={!canUndo}
          title={canUndo ? "재생성 직전 상태로 되돌리기" : "가장 최근에 재생성한 프레임만 되돌릴 수 있습니다"}
          className="mt-2 w-full rounded border border-gray-300 py-1.5 text-xs font-bold text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          방금 되돌리기
        </button>

        {regenerateError && (
          <div className="mt-1">
            <p className="text-xs text-red-600" role="alert">
              {regenerateError}
            </p>
            {/* Design Ref: DESIGN.md §1 — "재생성 실패 시 카드 안에 에러 문구 + '재시도' 버튼 인라인 표시" */}
            <button
              type="button"
              onClick={handleRegenerateClick}
              disabled={regenerating || regenLimitReached}
              className="mt-1 rounded border border-red-400 px-2 py-1 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              재시도
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
