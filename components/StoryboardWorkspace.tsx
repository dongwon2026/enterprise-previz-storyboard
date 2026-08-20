"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import FrameCard, { MAX_REGEN_COUNT } from "@/components/FrameCard";
import type { Frame } from "@/components/FrameCard";
import CharacterDescriber from "@/components/CharacterDescriber";
import ReferenceShowInput from "@/components/ReferenceShowInput";
import { loadStoryboard, saveStoryboard } from "@/lib/storyboardStorage";
import type { ExportFrameContext } from "@/lib/storyboardExport";
import {
  buildFrameExportBlockEn,
  buildStoryboardExportTextEn,
  buildStoryboardFilename,
} from "@/lib/storyboardExport";
import { CAST_CHARACTERS, DEFAULT_CAST_IDS, ROLE_MAX_LENGTH } from "@/lib/castCharacters";
import type { CastMemberForPrompt } from "@/lib/storyboardPrompt";
import type { ExportTranslateInput } from "@/lib/exportTranslatePrompt";
import type { ExportTranslateResult } from "@/lib/exportTranslateSchema";
import { DEFAULT_STYLE_LOCK, DEFAULT_NEGATIVE_PROMPT } from "@/lib/styleLockDefaults";
import {
  GENRE_PRESETS,
  OVERVIEW_MIN_LENGTH,
  OVERVIEW_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  TARGET_MAX_LENGTH,
  MAX_GENRE_COUNT,
} from "@/lib/storyboardIdea";

// /api/storyboard 응답에는 재생성 횟수·castRefs 개념이 없다 (서버가 세지 않고, 클라이언트 상태로만
// 관리) — 응답을 그대로 Frame으로 쓰지 않고 regenCount: 0 + castRefs(기본 출연자 자동 태깅)를
// 붙여서 화면용 Frame으로 만든다 (PLAN.md 13번 / 사용자 요청 §1·§2 인물 일관성 기능)
type ApiFrame = {
  no: number;
  imageDescription: string;
  durationSec: number;
  videoAction: string;
  audioNote: string;
  dialogue: string;
  caption: string;
};

// Design Ref: DESIGN.md §1 화면 구성 — 상단 "기획 아이디어 입력 영역" + 중단 "12프레임 카드 그리드"를
// 한 화면 안에서 함께 다루는 컴포넌트. 기존 IdeaInput.tsx는 입력창만 갖고 있었지만,
// 이번 작업(PLAN.md 9번)부터는 입력→생성→결과 표시가 하나의 상태 흐름으로 이어져야 해서
// idea/frames/loading/error 상태를 이 컴포넌트가 함께 소유하도록 합쳤다.
// 프레임 카드 자체(클릭 편집 등)는 FrameCard.tsx로 분리 (PLAN.md 10번)
// Plan SC: PLAN.md 14번 — 생성 실패 시 에러 배너 옆에 전용 "재시도" 버튼을 별도로 노출한다
// Plan SC: PLAN.md 15번 — 재생성 직전 상태는 "버전 이력"이 아니라 딱 1개(가장 최근 재생성)만
// lastRegenSnapshot 하나로 보관한다. 다른 프레임을 재생성하면 이전 보관 내용은 덮어써진다.
// Plan SC: PLAN.md 16번 — idea/frames가 바뀔 때마다 lib/storyboardStorage.ts를 통해 localStorage에
// 자동 저장하고, 새로고침 시 그 값을 읽어 복원한다 (서버 DB가 없어서 브라우저 저장소만 사용)
// 사용자 요청(인물 일관성 기능): styleLock/negativePrompt(전역 텍스트)와 characterDescriptions
// (캐릭터1/2/3 설명 텍스트)도 이 컴포넌트가 함께 소유한다 — 스토리보드 생성/재생성 프롬프트와
// "전체 복사"/.txt 내보내기 조립에 모두 필요하기 때문
export default function StoryboardWorkspace() {
  // 사용자 요청 — "예능 기획 아이디어" 입력을 제목/장르/시청 타깃/프로그램 개요 4개 구조화 필드
  // (표 형식)로 나눈다. AI 프롬프트에는 lib/storyboardIdea.ts의 composeIdeaText로 합쳐서 보낸다
  // (서버가 최종 조립을 하지만, 유효성 검사 등 화면 로직은 이 4개 필드 각각을 기준으로 한다).
  const [title, setTitle] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [customGenreInput, setCustomGenreInput] = useState("");
  const [target, setTarget] = useState("");
  const [overview, setOverview] = useState("");
  // 사용자 요청 — 레퍼런스 예능 이름 + 이미지 분위기 묘사(텍스트만 보관, 사진 원본은 저장 안 함)
  const [referenceShowName, setReferenceShowName] = useState("");
  const [referenceDescription, setReferenceDescription] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Design Ref: DESIGN.md §1 — "재생성 중에는 해당 카드만 로딩 표시" / "실패 시 카드 안에 에러 문구"
  const [regeneratingNos, setRegeneratingNos] = useState<number[]>([]);
  const [frameErrors, setFrameErrors] = useState<Record<number, string>>({});
  // Design Ref: DESIGN.md §1 — "'방금 되돌리기' 버튼 (직전에 재생성한 카드만 활성)"
  const [lastRegenSnapshot, setLastRegenSnapshot] = useState<{
    no: number;
    imageDescription: string;
    durationSec: number;
  } | null>(null);
  // Design Ref: DESIGN.md §2 데이터 흐름 ③ — localStorage에서 다 불러오기 전까지는 저장(덮어쓰기)을
  // 하지 않는다. 이 값이 false인 동안 저장하면, 불러오기 전의 빈 초기 상태로 기존 저장값을 지워버린다.
  const [hydrated, setHydrated] = useState(false);
  // Design Ref: DESIGN.md §1 화면 구성 [하단] 내보내기 영역 — "전체 복사" 버튼 (PLAN.md 17번)
  const [allCopied, setAllCopied] = useState(false);
  // 사용자 요청 — "전체 복사"/".txt 다운로드"는 구글 Flow Omni용으로 영어로 번역해서 내보낸다.
  // 번역은 AI 호출이 필요해 시간이 걸리므로 버튼에 로딩/에러 상태를 별도로 둔다.
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // 마지막으로 번역에 성공한 원본 내용(JSON 문자열)과 그 번역 결과(ExportTranslateResult)를
  // 기억해둔다 — 화면 내용이 바뀌지 않았는데 "전체 복사"→".txt 다운로드"→"이 프레임 복사"처럼
  // 연달아 누르면 매번 새로 번역 호출하지 않고 재사용한다.
  const translateCacheRef = useRef<{ sourceKey: string; result: ExportTranslateResult } | null>(null);
  // 사용자 요청 §3 — "이 프레임 복사"도 이제 번역이 필요해서, 어느 프레임을 복사 중인지 표시해야 한다
  const [copyingFrameNo, setCopyingFrameNo] = useState<number | null>(null);

  // 사용자 요청 §1 — 전역 상태: 스타일 고정(Style Lock)/네거티브 프롬프트. PD가 텍스트 영역에서
  // 직접 편집 가능하고, 기본값은 lib/styleLockDefaults.ts의 템플릿(한국어, PD 친화성을 위해 사용자 요청으로 변경).
  // 구글 Flow Omni에 들어갈 영어 버전은 내보내기 시점에 AI가 번역해서 만든다 (아래 getEnglishExportText).
  const [styleLock, setStyleLock] = useState(DEFAULT_STYLE_LOCK);
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  // 캐릭터1/2/3 설명 생성 박스의 "결과 텍스트"만 여기서 함께 관리한다 (사진 원본은 각 박스 내부
  // 로컬 상태로만 존재하고 절대 여기로 올라오지 않음 — 저장/전송하지 않는다는 원칙 유지)
  // 사용자 요청 — 캐릭터4/5 추가 (3개 → 5개)
  const [characterDescriptions, setCharacterDescriptions] = useState<
    Record<string, string | null>
  >({ character1: null, character2: null, character3: null, character4: null, character5: null });
  // 사용자 요청 — "프로그램 개요 위에 생성된 캐릭터들에 대한 역할을 작성할 수 있게 해줘". 캐릭터
  // 슬롯의 고정 role(진행자/고정 파트너 등, lib/castCharacters.ts)과 별개로, "이번 기획에서 이
  // 인물이 맡는 역할"을 PD가 매번 새로 적는 텍스트다 — 프롬프트에 보낼 때 고정 role보다 우선한다
  // (resolveCastMembers 참고).
  const [characterRoles, setCharacterRoles] = useState<Record<string, string>>({});
  // 사용자 요청 §3 — "캐릭터 패널이 비어 있는 상태로 스토리보드를 생성하면, 생성 직후 안내 배너"
  const [showCastBanner, setShowCastBanner] = useState(false);

  // 최초 마운트 시 한 번만: localStorage(외부 저장소)에 저장된 마지막 작업 내용을 읽어와 화면에 복원한다.
  // useState의 초기값 함수로 바로 읽지 않는 이유: 서버 렌더링 시점에는 localStorage가 없어서
  // 항상 빈 값으로 그려지는데, 초기값 함수로 읽으면 브라우저에서는 곧바로 채워진 값으로 그려져
  // 하이드레이션(서버 결과와 첫 화면 비교) 불일치가 난다. 그래서 마운트 후 이 effect에서 한 번만
  // React 상태를 외부 저장소 값과 동기화한다 (react-hooks/set-state-in-effect가 우려하는
  // "렌더 중 계산 가능한 값을 effect로 미루는" 경우가 아니라, 이런 외부 시스템 동기화가 정확한 용례다).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       localStorage(외부 저장소)와 React 상태를 최초 1회 동기화하는 지점이라 의도된 처리 */
    const stored = loadStoryboard();
    if (stored) {
      setTitle(stored.title);
      setGenres(stored.genres);
      setTarget(stored.target);
      setOverview(stored.overview);
      setReferenceShowName(stored.referenceShowName);
      setReferenceDescription(stored.referenceDescription);
      setFrames(stored.frames);
      setStyleLock(stored.styleLock);
      setNegativePrompt(stored.negativePrompt);
      setCharacterDescriptions((prev) => ({ ...prev, ...stored.characterDescriptions }));
      setCharacterRoles((prev) => ({ ...prev, ...stored.characterRoles }));
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // 상태가 바뀔 때마다 localStorage에 자동 저장한다 (사진 원본은 애초에 이 컴포넌트가 들고 있지 않음)
  useEffect(() => {
    if (!hydrated) return;
    saveStoryboard({
      title,
      genres,
      target,
      overview,
      referenceShowName,
      referenceDescription,
      frames,
      styleLock,
      negativePrompt,
      characterDescriptions,
      characterRoles,
    });
  }, [
    hydrated,
    title,
    genres,
    target,
    overview,
    referenceShowName,
    referenceDescription,
    frames,
    styleLock,
    negativePrompt,
    characterDescriptions,
    characterRoles,
  ]);

  const overviewLength = overview.length;
  const overviewTooShort = overviewLength < OVERVIEW_MIN_LENGTH;
  const canSubmit =
    title.trim().length > 0 &&
    genres.length > 0 &&
    target.trim().length > 0 &&
    overviewLength >= OVERVIEW_MIN_LENGTH &&
    overviewLength <= OVERVIEW_MAX_LENGTH &&
    !loading;

  function handleOverviewChange(event: ChangeEvent<HTMLTextAreaElement>) {
    // maxLength 속성으로 대부분 막히지만, 붙여넣기 같은 예외 상황을 대비해 한 번 더 잘라낸다
    setOverview(event.target.value.slice(0, OVERVIEW_MAX_LENGTH));
  }

  // 프리셋 장르 칩 클릭 — 이미 선택돼 있으면 빼고, 아니면 더한다 (최대 개수 제한)
  function toggleGenre(genre: string) {
    setGenres((prev) => {
      if (prev.includes(genre)) return prev.filter((g) => g !== genre);
      if (prev.length >= MAX_GENRE_COUNT) return prev;
      return [...prev, genre];
    });
  }

  // "기타" 직접 입력 태그 추가 — 프리셋에 없는 값만, 중복 없이, 최대 개수까지만 추가한다
  function addCustomGenre() {
    const value = customGenreInput.trim();
    if (!value) return;
    setGenres((prev) => {
      if (prev.includes(value) || prev.length >= MAX_GENRE_COUNT) return prev;
      return [...prev, value];
    });
    setCustomGenreInput("");
  }

  function handleCustomGenreKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomGenre();
    }
  }

  function removeGenre(genre: string) {
    setGenres((prev) => prev.filter((g) => g !== genre));
  }

  // Design Ref: DESIGN.md §2 데이터 흐름 ② "PD가 프레임 설명을 직접 타이핑해서 수정할 때"
  // FrameCard 내부에서 100자 이상 검증까지 마친 뒤에만 호출되므로, 여기서는 해당 프레임만 교체한다
  function handleFrameSave(no: number, imageDescription: string) {
    setFrames((prev) =>
      prev ? prev.map((f) => (f.no === no ? { ...f, imageDescription } : f)) : prev
    );
  }

  // Design Ref: DESIGN.md §1 — "분량(초) 선택 (2/4/6/8/10초 중 하나, 직접 변경 가능)"
  // Plan SC: PLAN.md 11번 — AI를 호출하지 않는 순수 클라이언트 동작
  function handleFrameDurationChange(no: number, durationSec: number) {
    setFrames((prev) =>
      prev ? prev.map((f) => (f.no === no ? { ...f, durationSec } : f)) : prev
    );
  }

  // 사용자 요청 §3/§1 — 캐릭터 설명 결과 텍스트가 바뀔 때(생성 성공/새 사진 선택으로 초기화)
  function handleCharacterDescriptionChange(characterId: string, description: string | null) {
    setCharacterDescriptions((prev) => ({ ...prev, [characterId]: description }));
  }

  // 사용자 요청 — "생성된 캐릭터들에 대한 역할을 작성" (예능 기획 아이디어 표, 프로그램 개요 위)
  function handleCharacterRoleChange(characterId: string, role: string) {
    setCharacterRoles((prev) => ({ ...prev, [characterId]: role.slice(0, ROLE_MAX_LENGTH) }));
  }

  // 사용자 요청 §3 — "이 인물을 프레임에 적용" 버튼: 12프레임 전체에 태깅/해제를 토글한다.
  // 개별 프레임에서 태그를 뺀 상태라도 이 버튼을 다시 누르면 전체가 같은 상태로 맞춰진다.
  function handleToggleApplyAll(characterId: string) {
    setFrames((prev) => {
      if (!prev) return prev;
      const appliedToAll = prev.every((f) => f.castRefs.includes(characterId));
      return prev.map((f) => ({
        ...f,
        castRefs: appliedToAll
          ? f.castRefs.filter((id) => id !== characterId)
          : f.castRefs.includes(characterId)
            ? f.castRefs
            : [...f.castRefs, characterId],
      }));
    });
  }

  // 프레임 카드의 태그 칩 클릭 — 그 프레임 1개에서만 캐릭터 태그를 뺀다 (사용자 요청 §1 예시:
  // "1번 프레임 = 캐릭터1, 2번 프레임 = 캐릭터1+캐릭터2"처럼 프레임별로 다르게 유지할 수 있어야 함)
  function handleToggleCastRef(no: number, characterId: string) {
    setFrames((prev) =>
      prev
        ? prev.map((f) =>
            f.no === no
              ? {
                  ...f,
                  castRefs: f.castRefs.includes(characterId)
                    ? f.castRefs.filter((id) => id !== characterId)
                    : [...f.castRefs, characterId],
                }
              : f
          )
        : prev
    );
  }

  // characterDescriptions에서 castRefs id 목록에 해당하는 인물만 프롬프트용 형태로 뽑아낸다.
  // 사용자 요청 — PD가 이번 기획용으로 별도 역할(characterRoles)을 적어뒀으면 캐릭터 슬롯의 고정
  // role("진행자" 등)보다 그 값을 우선해서 AI 프롬프트에 보낸다(비어 있으면 기존 고정 role 사용).
  function resolveCastMembers(castRefs: string[]): CastMemberForPrompt[] {
    return CAST_CHARACTERS.filter(
      (c) => castRefs.includes(c.id) && characterDescriptions[c.id]
    ).map((c) => ({
      id: c.id,
      label: c.label,
      role: characterRoles[c.id]?.trim() || c.role,
      description: characterDescriptions[c.id] as string,
    }));
  }

  // Design Ref: DESIGN.md §2 데이터 흐름 ② — 기획 아이디어 원문 + 나머지 8개 프레임 + (선택) 수정 지시를
  // 함께 전송해 해당 프레임만 새로 받는다. 분량(초)은 PD가 정해둔 값을 그대로 유지하고,
  // AI가 새로 제안한 durationSec으로 덮어쓰지 않는다 (PLAN.md 12번).
  // 사용자 요청 §4 — castRefs/styleLock은 항상 고정으로 함께 보내고, 수정 지시는 동작·구도·소품에만
  // 반영되도록 서버 프롬프트(lib/storyboardPrompt.ts)가 처리한다.
  async function handleFrameRegenerate(no: number, instruction: string) {
    if (!frames) return;

    // Plan SC: PRD 5-2절 "재생성 요청은 최대 10회까지만 허용" — 버튼도 비활성화되지만,
    // 방어적으로 여기서도 한 번 더 막는다 (버튼 비활성화 로직을 우회해도 API를 부르지 않도록)
    // 지역 변수명을 targetFrame으로 둔다 — "시청 타깃" 상태(target)와 이름이 겹치는 것을 피하기 위함
    const targetFrame = frames.find((f) => f.no === no);
    if (targetFrame && targetFrame.regenCount >= MAX_REGEN_COUNT) {
      setFrameErrors((prev) => ({
        ...prev,
        [no]: `이 프레임은 이미 ${MAX_REGEN_COUNT}회 재생성해서 더 이상 재생성할 수 없습니다.`,
      }));
      return;
    }

    setFrameErrors((prev) => {
      const next = { ...prev };
      delete next[no];
      return next;
    });
    setRegeneratingNos((prev) => [...prev, no]);

    try {
      const res = await fetch("/api/storyboard/frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          genres,
          target,
          overview,
          reference: { showName: referenceShowName, description: referenceDescription ?? undefined },
          frameNo: no,
          frames,
          instruction: instruction.trim() || undefined,
          styleLock,
          castMembers: targetFrame ? resolveCastMembers(targetFrame.castRefs) : [],
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setFrameErrors((prev) => ({
          ...prev,
          [no]: body?.error?.message ?? "재생성에 실패했습니다.",
        }));
        return;
      }

      const newImageDescription = body.data.frame.imageDescription as string;
      const newVideoAction = body.data.frame.videoAction as string;
      const newAudioNote = body.data.frame.audioNote as string;
      // Design Ref: DESIGN.md §2 데이터 흐름 ② "재생성 직전 상태(설명·분량)를 임시로 1개만 보관"
      // targetFrame은 이 재생성을 시작하기 직전(위 규칙 검사 시점)의 프레임 상태 — 바로 그 값을 보관해둔다
      if (targetFrame) {
        setLastRegenSnapshot({
          no: targetFrame.no,
          imageDescription: targetFrame.imageDescription,
          durationSec: targetFrame.durationSec,
        });
      }
      // 성공적으로 재생성됐을 때만 횟수를 1 늘린다 (실패한 시도는 세지 않음)
      // castRefs는 재생성해도 그대로 유지한다 (인물 태깅은 PD가 직접 바꾸기 전까지 유지되는 값)
      setFrames((prev) =>
        prev
          ? prev.map((f) =>
              f.no === no
                ? {
                    ...f,
                    imageDescription: newImageDescription,
                    videoAction: newVideoAction,
                    audioNote: newAudioNote,
                    regenCount: f.regenCount + 1,
                  }
                : f
            )
          : prev
      );
    } catch {
      setFrameErrors((prev) => ({
        ...prev,
        [no]: "네트워크 오류로 요청을 보내지 못했습니다. 다시 시도해주세요.",
      }));
    } finally {
      setRegeneratingNos((prev) => prev.filter((n) => n !== no));
    }
  }

  // Design Ref: DESIGN.md §2 데이터 흐름 ② — "임시 보관해둔 직전 상태로 그 프레임만 되돌리고,
  // 임시 보관은 비움 / 재생성 횟수는 되돌리지 않고 그대로 유지" (videoAction/audioNote는 되돌리기
  // 대상에 원래 없던 값이라 건드리지 않는다 — 직전 재생성 결과 그대로 남는다)
  function handleUndoRegenerate(no: number) {
    if (!lastRegenSnapshot || lastRegenSnapshot.no !== no) return;
    const snapshot = lastRegenSnapshot;
    setFrames((prev) =>
      prev
        ? prev.map((f) =>
            f.no === no
              ? { ...f, imageDescription: snapshot.imageDescription, durationSec: snapshot.durationSec }
              : f
          )
        : prev
    );
    setLastRegenSnapshot(null);
  }

  // 실제로 어느 프레임에서든 태깅된 캐릭터만, 정해진 순서(캐릭터1→2→3)로 한 번씩만 번역 대상에 넣는다.
  // id를 함께 보내야 번역 후에도 "이 프레임에는 어느 캐릭터가 태깅됐는지"를 다시 매칭할 수 있다
  // (사용자 요청 §3 — 프레임별 [IMAGE] 자동 병합에 필요).
  function collectUsedCastDescriptions(
    currentFrames: Frame[]
  ): { id: string; label: string; role: string; description: string }[] {
    const usedCharacterIds = new Set(currentFrames.flatMap((f) => f.castRefs));
    const result: { id: string; label: string; role: string; description: string }[] = [];
    for (const c of CAST_CHARACTERS) {
      const description = characterDescriptions[c.id];
      if (usedCharacterIds.has(c.id) && description && description.trim()) {
        result.push({ id: c.id, label: c.label, role: c.role, description: description.trim() });
      }
    }
    return result;
  }

  // 사용자 요청 — "전체 복사"/".txt 다운로드"/"이 프레임 복사" 결과는 모두 구글 Flow Omni용으로
  // 영어로 번역해서 내보낸다. 화면 내용(한국어)을 그대로 /api/storyboard/export-translate로 보내
  // 번역받은 "원본 구조 그대로의" 결과(ExportTranslateResult)를 돌려준다 — 실제 [IMAGE]/[VIDEO]/
  // [AUDIO] 블록 조립은 호출부(전체 내보내기 vs 프레임 1개)에서 각자 한다. 실패하면 null을 돌려주고
  // translateError에 안내 문구를 남긴다.
  async function getTranslatedExport(): Promise<ExportTranslateResult | null> {
    if (!frames) return null;

    const input: ExportTranslateInput = {
      styleLock,
      negativePrompt,
      castDescriptions: collectUsedCastDescriptions(frames),
      frames: frames.map((f) => ({
        no: f.no,
        imageDescription: f.imageDescription,
        videoAction: f.videoAction,
        audioNote: f.audioNote,
      })),
    };
    const sourceKey = JSON.stringify(input);

    // 직전 번역 이후 내용이 하나도 안 바뀌었으면 다시 AI를 부르지 않고 캐시된 결과를 재사용한다
    if (translateCacheRef.current && translateCacheRef.current.sourceKey === sourceKey) {
      return translateCacheRef.current.result;
    }

    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch("/api/storyboard/export-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();

      if (!res.ok) {
        setTranslateError(body?.error?.message ?? "영어 번역에 실패했습니다.");
        return null;
      }

      const result = body.data as ExportTranslateResult;
      translateCacheRef.current = { sourceKey, result };
      return result;
    } catch {
      setTranslateError("네트워크 오류로 번역 요청을 보내지 못했습니다. 다시 시도해주세요.");
      return null;
    } finally {
      setTranslating(false);
    }
  }

  // 번역된 결과와 원본 프레임(castRefs·durationSec·한국어 원문)을 짝지어, 조립 함수가 프레임별로
  // 필요한 "이 씬에 태깅된 캐릭터"·"장르별 방어 태그 판단용 원문"을 만들어준다.
  function buildFrameContexts(currentFrames: Frame[], translated: ExportTranslateResult): ExportFrameContext[] {
    return currentFrames.map((f) => ({
      no: f.no,
      durationSec: f.durationSec,
      castTexts: translated.castDescriptions.filter((c) => f.castRefs.includes(c.id)),
      koreanSourceText: `${f.imageDescription}\n${f.videoAction}`,
    }));
  }

  // Design Ref: DESIGN.md §2 데이터 흐름 ④ 내보내기 — "'전체 복사' 클릭 → 클립보드로 텍스트 복사"
  // 사용자 요청 — 클립보드에는 (한국어 화면 내용을 번역한) 영어 [IMAGE]/[VIDEO]/[AUDIO] 텍스트가 복사된다
  async function handleCopyAll() {
    if (!frames) return;
    const translated = await getTranslatedExport();
    if (!translated) return;
    const text = buildStoryboardExportTextEn(translated, buildFrameContexts(frames, translated));
    try {
      await navigator.clipboard.writeText(text);
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 1500);
    } catch {
      setAllCopied(false);
    }
  }

  // Design Ref: DESIGN.md §1 화면 구성 [하단] — "'텍스트 파일(.txt) 다운로드' 버튼,
  // 파일명: storyboard_YYYYMMDD-HHmm.txt" — 사용자 요청으로 다운로드 파일 내용도 영어로 번역해서 담는다
  async function handleDownloadTxt() {
    if (!frames) return;
    const translated = await getTranslatedExport();
    if (!translated) return;
    const text = buildStoryboardExportTextEn(translated, buildFrameContexts(frames, translated));
    // Windows 메모장 등에서 글자가 깨지지 않도록 UTF-8 BOM(﻿)을 앞에 붙인다
    const content = "﻿" + text;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildStoryboardFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // 사용자 요청 §3 — "유저가 단 한 씬만 복사해서 구글 Flow에 넣어도 룩앤필과 캐릭터가 완벽히
  // 유지되도록" "이 프레임 복사"도 번역 + [IMAGE]/[VIDEO]/[AUDIO] 조립 + 캐릭터·스타일 자동
  // 병합까지 마친, 그 프레임 하나만으로 자기완결된 텍스트를 돌려준다 (FrameCard.tsx가 호출).
  async function handleCopyFrame(no: number): Promise<string | null> {
    if (!frames) return null;
    const original = frames.find((f) => f.no === no);
    if (!original) return null;

    setCopyingFrameNo(no);
    try {
      const translated = await getTranslatedExport();
      if (!translated) return null;
      const translatedFrame = translated.frames.find((f) => f.no === no);
      if (!translatedFrame) return null;

      return buildFrameExportBlockEn({
        translatedFrame,
        durationSec: original.durationSec,
        castTexts: translated.castDescriptions.filter((c) => original.castRefs.includes(c.id)),
        styleLockEn: translated.styleLock,
        negativePromptEn: translated.negativePrompt,
        koreanSourceText: `${original.imageDescription}\n${original.videoAction}`,
      });
    } finally {
      setCopyingFrameNo(null);
    }
  }

  // Design Ref: DESIGN.md §1 — "이미 생성된 결과가 있으면 클릭 시 확인 후 진행"
  // Design Ref: DESIGN.md §2 데이터 흐름 ① — 생성 중 화면 전체 로딩 표시, 실패 시 에러 배너
  // 사용자 요청 §2/§3 — 캐릭터1/2(진행자/고정 파트너) 설명을 프롬프트 컨텍스트로 함께 보내고,
  // 응답으로 받은 12프레임에는 채워진 캐릭터1/2를 기본 출연자로 자동 태깅한다
  async function handleSubmit() {
    if (frames) {
      const confirmed = window.confirm(
        "새로 만들면 기존 내용이 사라집니다. 계속하시겠습니까?"
      );
      if (!confirmed) return;
    }

    setError(null);
    setLoading(true);
    setShowCastBanner(false);

    try {
      const castMembers = resolveCastMembers(CAST_CHARACTERS.map((c) => c.id));
      const res = await fetch("/api/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          genres,
          target,
          overview,
          reference: { showName: referenceShowName, description: referenceDescription ?? undefined },
          styleLock,
          castMembers,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body?.error?.message ?? "스토리보드 생성에 실패했습니다.");
        setFrames(null);
        return;
      }

      // 캐릭터1/2(진행자/고정 파트너)가 채워져 있으면 기본 출연자로 12프레임 전체에 자동 태깅한다.
      // 캐릭터3/4/5(추가 출연자)는 자동 태깅하지 않고, PD가 "이 인물을 프레임에 적용"으로 수동 태깅한다.
      const defaultCastRefs = DEFAULT_CAST_IDS.filter((id) => characterDescriptions[id]);
      const newFrames = (body.data.frames as ApiFrame[]).map((f) => ({
        ...f,
        regenCount: 0,
        castRefs: defaultCastRefs,
      }));
      setFrames(newFrames);
      // 새 스토리보드가 만들어졌으니, 이전 스토리보드에 대한 되돌리기 임시 보관은 더 이상 의미가 없다
      setLastRegenSnapshot(null);
      // 사용자 요청 — "스타일 고정을 스토리보드에 맞게 그때그때 수정해줘": 생성 성공 시 AI가 이번
      // 기획 아이디어에 맞춰 새로 제안한 styleLock으로 자동 교체한다 (PD가 텍스트 영역에서 계속
      // 직접 고칠 수 있음 — 네거티브 프롬프트는 사용자 요청대로 고정값이라 여기서 건드리지 않는다).
      if (typeof body.data.styleLock === "string" && body.data.styleLock.trim()) {
        setStyleLock(body.data.styleLock);
      }

      // 사용자 요청 §3 — 진행자/파트너 캐릭터가 둘 다 비어 있으면 안내 배너를 보여준다
      if (!characterDescriptions.character1 && !characterDescriptions.character2) {
        setShowCastBanner(true);
      }
    } catch {
      // 브라우저→서버 전송 자체가 실패한 경우 (네트워크 단절 등) — 자동 재시도 없이 안내만 표시
      setError("네트워크 오류로 요청을 보내지 못했습니다. 다시 시도해주세요.");
      setFrames(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80">
          <p className="text-lg font-bold text-ena-blue">
            스토리보드를 생성하고 있습니다...
          </p>
        </div>
      )}

      {/* 사용자 요청 — 화면 순서: ① 캐릭터1~5 설명 생성 → ② 예능 기획 아이디어 입력 및 스토리보드
          생성 → ③ 스토리보드 결과(프레임 그리드). 세 구역 모두 같은 max-w-[1720px] 컨테이너 안에서
          가로 폭을 꽉 채우도록 그리드/flex-1을 써서, 전체 가로길이가 균일하게 보이도록 맞췄다
          (PC 전용, 최소 1440px 화면 기준). */}
      <div className="mx-auto mt-10 w-full max-w-[1720px]">
        {/* 사용자 요청 — "예능 기획 아이디어"처럼 박스 바깥 위쪽에 왼쪽 정렬 제목을 둔다. 개별
            박스 안 제목은 "카릭터N 설명 생성"처럼 중복되지 않도록 번호만 남긴다(label prop). */}
        <h2 className="mb-2 font-bold">캐릭터 생성</h2>
        {/* 캐릭터 설명 생성 — 인물 사진 → 외형 묘사. 캐릭터1~5(5개)를 균등한 폭으로 나란히 둔다.
            사진/미리보기/로딩 상태는 각 박스가 갖고 있지만, 설명 결과 텍스트는 프레임 태깅·프롬프트·
            내보내기에 필요해 부모(StoryboardWorkspace)가 함께 관리한다. */}
        <div className="grid grid-cols-5 items-start gap-4">
          {CAST_CHARACTERS.map((c) => (
            <CharacterDescriber
              key={c.id}
              characterId={c.id}
              label={c.label}
              description={characterDescriptions[c.id] ?? null}
              onDescriptionChange={handleCharacterDescriptionChange}
              appliedToAllFrames={!!frames && frames.every((f) => f.castRefs.includes(c.id))}
              onToggleApplyAll={handleToggleApplyAll}
              hasStoryboard={!!frames}
            />
          ))}
        </div>

        {/* 사용자 요청 — 예능 기획 아이디어 입력을 제목/장르/시청 타깃/프로그램 개요 4행짜리 표로
            바꾸고, 그 옆에 레퍼런스 예능(이름+이미지) 입력 박스를 나란히 둔다. 캐릭터 행·프레임
            그리드와 가로길이를 맞추기 위해 폭을 좁히던 max-w-[1200px]을 없애고 flex-1로 꽉 채운다.
            사용자 요청 — items-start(위쪽 정렬) 대신 items-stretch로 바꿔, 레퍼런스 예능 박스가
            예능 기획 아이디어 박스와 같은 높이로 늘어나도록 한다. */}
        <div className="mt-8 flex w-full items-stretch gap-4">
          <section className="min-w-0 flex-1">
            <h2 className="mb-2 font-bold">예능 기획 아이디어</h2>
            <table className="w-full table-fixed border-collapse border border-gray-300 text-sm">
              <colgroup>
                <col className="w-28" />
                <col />
              </colgroup>
              <tbody>
                <tr className="border-b border-gray-300">
                  <th scope="row" className="border-r border-gray-300 bg-gray-50 p-3 text-left align-top font-bold">
                    제목
                  </th>
                  <td className="p-3">
                    <input
                      id="idea-title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX_LENGTH))}
                      maxLength={TITLE_MAX_LENGTH}
                      placeholder="예: 이장님이 된 아이돌"
                      className="w-full rounded border border-gray-300 px-2 py-1.5 outline-none focus:border-ena-blue"
                    />
                  </td>
                </tr>
                <tr className="border-b border-gray-300">
                  <th scope="row" className="border-r border-gray-300 bg-gray-50 p-3 text-left align-top font-bold">
                    장르
                  </th>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {GENRE_PRESETS.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => toggleGenre(g)}
                          className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                            genres.includes(g)
                              ? "border-ena-blue bg-ena-blue text-white"
                              : "border-gray-300 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <input
                        type="text"
                        value={customGenreInput}
                        onChange={(e) => setCustomGenreInput(e.target.value)}
                        onKeyDown={handleCustomGenreKeyDown}
                        placeholder="기타 (직접 입력 후 Enter)"
                        maxLength={20}
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-ena-blue"
                      />
                      <button
                        type="button"
                        onClick={addCustomGenre}
                        className="rounded border border-ena-blue px-2 py-1 text-xs font-bold text-ena-blue hover:bg-blue-50"
                      >
                        추가
                      </button>
                    </div>
                    {genres.filter((g) => !(GENRE_PRESETS as readonly string[]).includes(g)).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {genres
                          .filter((g) => !(GENRE_PRESETS as readonly string[]).includes(g))
                          .map((g) => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => removeGenre(g)}
                              title="클릭하면 태그를 뺍니다"
                              className="rounded-full border border-ena-blue bg-blue-50 px-2.5 py-1 text-xs font-bold text-ena-blue hover:bg-blue-100"
                            >
                              {g} ×
                            </button>
                          ))}
                      </div>
                    )}
                    {genres.length === 0 && (
                      <p className="mt-2 text-xs text-red-600">장르를 1개 이상 선택해주세요.</p>
                    )}
                  </td>
                </tr>
                <tr className="border-b border-gray-300">
                  <th scope="row" className="border-r border-gray-300 bg-gray-50 p-3 text-left align-top font-bold">
                    시청 타깃
                  </th>
                  <td className="p-3">
                    <input
                      id="idea-target"
                      type="text"
                      value={target}
                      onChange={(e) => setTarget(e.target.value.slice(0, TARGET_MAX_LENGTH))}
                      maxLength={TARGET_MAX_LENGTH}
                      placeholder="예: 20대 여성"
                      className="w-full rounded border border-gray-300 px-2 py-1.5 outline-none focus:border-ena-blue"
                    />
                  </td>
                </tr>
                {/* 사용자 요청 — "프로그램 개요 위에 생성된 캐릭터들에 대한 역할을 작성할 수 있게
                    해줘". 설명이 생성된 캐릭터만 골라 보여주고, 하나도 없으면 안내 문구만 표시한다. */}
                <tr className="border-b border-gray-300">
                  <th scope="row" className="border-r border-gray-300 bg-gray-50 p-3 text-left align-top font-bold">
                    출연진 역할
                  </th>
                  <td className="p-3">
                    {CAST_CHARACTERS.filter((c) => characterDescriptions[c.id]).length === 0 ? (
                      <p className="text-xs text-gray-500">
                        위에서 캐릭터 설명을 먼저 생성하면, 이곳에서 이번 기획 속 역할을 적을 수 있어요.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {CAST_CHARACTERS.filter((c) => characterDescriptions[c.id]).map((c) => (
                          <div key={c.id}>
                            <label
                              htmlFor={`role-${c.id}`}
                              className="mb-1 block text-xs font-bold text-gray-600"
                            >
                              {c.label}
                            </label>
                            <input
                              id={`role-${c.id}`}
                              type="text"
                              value={characterRoles[c.id] ?? ""}
                              onChange={(e) => handleCharacterRoleChange(c.id, e.target.value)}
                              maxLength={ROLE_MAX_LENGTH}
                              placeholder="예: 시골 이장님"
                              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-ena-blue"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="border-r border-gray-300 bg-gray-50 p-3 text-left align-top font-bold">
                    프로그램 개요
                  </th>
                  <td className="p-3">
                    <textarea
                      id="idea-overview"
                      value={overview}
                      onChange={handleOverviewChange}
                      maxLength={OVERVIEW_MAX_LENGTH}
                      rows={6}
                      placeholder="예: 아이돌 연습생들이 시골 마을에서 일주일간 이장 업무를 대신 맡아보는 예능..."
                      className="w-full resize-none rounded border border-gray-300 p-2 outline-none focus:border-ena-blue"
                    />
                    <p
                      className={`mt-1 text-xs ${overviewTooShort ? "text-red-600" : "text-gray-500"}`}
                      aria-live="polite"
                    >
                      {overviewTooShort
                        ? `최소 50자 이상 입력해주세요 (${overviewLength} / ${OVERVIEW_MAX_LENGTH})`
                        : `${overviewLength} / ${OVERVIEW_MAX_LENGTH} (최소 50자)`}
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="mt-4 w-full rounded bg-ena-blue py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {frames ? "새로 스토리보드 생성" : "스토리보드 생성"}
          </button>

          {error && (
            <div
              className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              <p>{error}</p>
              {/* Design Ref: DESIGN.md §1 — "오류 발생 시: 에러 배너 + '재시도' 버튼(수동)" */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="mt-2 rounded border border-red-400 bg-white px-3 py-1 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                재시도
              </button>
            </div>
          )}

          {/* 사용자 요청 §1 — 전역 스타일 고정(Style Lock)/네거티브 프롬프트 편집 영역. 한국어로
              편하게 확인·수정하고, 내보내기(전체 복사/.txt/이 프레임 복사) 시점에 AI가 영어로
              번역되어 프레임마다 자동으로 덧붙는다 (사용자 요청 §3 — 씬 하나만 복사해도
              캐릭터·스타일이 유지되도록 매 프레임 [IMAGE] 끝에 반복해서 붙인다).
              사용자 요청 — 스타일 고정은 "스토리보드 생성" 시마다 이번 기획 아이디어에 맞춰
              AI가 새로 제안해 자동으로 값을 갱신한다(직접 수정도 계속 가능). 네거티브 프롬프트는
              반대로 스토리보드 내용과 무관하게 항상 고정값을 쓴다(사용자가 지정). */}
          <div className="mt-6 rounded border border-gray-200 p-3">
            <p className="mb-2 text-xs font-bold text-gray-600">
              스타일 고정 (Style Lock) — 스토리보드를 생성할 때마다 이 기획에 맞게 AI가 자동으로 새로
              제안합니다(직접 수정 가능). 내보내기 시 영어로 번역되어 프레임마다 [IMAGE] 끝에 자동으로 붙습니다
            </p>
            <textarea
              value={styleLock}
              onChange={(e) => setStyleLock(e.target.value)}
              rows={4}
              className="w-full resize-none rounded border border-gray-300 p-2 text-xs outline-none focus:border-ena-blue"
            />
            <p className="mb-2 mt-3 text-xs font-bold text-gray-600">
              네거티브 프롬프트 (Negative Prompt) — 스토리보드 내용과 무관하게 항상 고정값입니다. 내보내기 시 영어로 번역되어 프레임마다 자동으로 붙습니다
            </p>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={4}
              className="w-full resize-none rounded border border-gray-300 p-2 text-xs outline-none focus:border-ena-blue"
            />
          </div>
          </section>

          {/* 사용자 요청 — "레퍼런스 예능" 제목을 박스 안이 아니라 "예능 기획 아이디어"처럼 박스
              바깥 위쪽에 왼쪽 정렬로 둔다. flex flex-col + h-full로 감싸서, 부모 행의 items-stretch에
              맞춰 박스가 예능 기획 아이디어 박스와 같은 높이로 늘어나도록 한다. */}
          <div className="flex h-full shrink-0 flex-col">
            <h2 className="mb-2 font-bold">레퍼런스 예능</h2>
            <ReferenceShowInput
              showName={referenceShowName}
              onShowNameChange={setReferenceShowName}
              description={referenceDescription}
              onDescriptionChange={setReferenceDescription}
            />
          </div>
        </div>
      </div>

      {/* 사용자 요청 — 1~12번 프레임 그리드를 4x3(4열)로, 캐릭터 행/아이디어 행과 같은
          max-w-[1720px]로 가로길이를 맞춘다 (기존 max-w-5xl은 훨씬 좁았음) */}
      {frames && (
        <section className="mx-auto mt-8 w-full max-w-[1720px]">
          {showCastBanner && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded border border-ena-blue bg-blue-50 p-3 text-sm text-ena-blue">
              <p>
                진행자/파트너 캐릭터를 먼저 만들면 프레임 인물이 훨씬 안정적으로 유지됩니다.
                (캐릭터1/캐릭터2 설명 생성 후 &quot;이 인물을 프레임에 적용&quot;을 눌러보세요)
              </p>
              <button
                type="button"
                onClick={() => setShowCastBanner(false)}
                className="shrink-0 text-xs font-bold text-ena-blue underline"
              >
                닫기
              </button>
            </div>
          )}

          <div className="grid grid-cols-4 gap-4">
            {frames.map((frame) => (
              <FrameCard
                key={frame.no}
                frame={frame}
                onSave={handleFrameSave}
                onDurationChange={handleFrameDurationChange}
                regenerating={regeneratingNos.includes(frame.no)}
                regenerateError={frameErrors[frame.no]}
                onRegenerate={handleFrameRegenerate}
                canUndo={lastRegenSnapshot?.no === frame.no}
                onUndo={handleUndoRegenerate}
                onToggleCastRef={handleToggleCastRef}
                onCopyFrame={handleCopyFrame}
                copyingFrame={copyingFrameNo === frame.no}
              />
            ))}
          </div>
        </section>
      )}

      {frames && (
        <section className="mx-auto mt-8 w-full max-w-[1720px]">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCopyAll}
              disabled={translating}
              className="rounded border border-ena-blue px-4 py-2 text-sm font-bold text-ena-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {translating ? "영어로 번역 중..." : allCopied ? "전체 복사됨!" : "전체 복사"}
            </button>
            <button
              type="button"
              onClick={handleDownloadTxt}
              disabled={translating}
              className="rounded border border-ena-blue px-4 py-2 text-sm font-bold text-ena-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {translating ? "영어로 번역 중..." : "텍스트 파일(.txt) 다운로드"}
            </button>
          </div>
          {/* 사용자 요청 — 내보내기용 영어 번역은 AI 호출이라 실패할 수 있다 (네트워크/형식 오류 등).
              생성/재생성과 같은 방식으로 에러 문구 + 다시 누르면 재시도되는 안내를 보여준다. */}
          {translateError && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {translateError} (버튼을 다시 누르면 재시도합니다)
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            화면은 한국어로 표시되지만, 복사/다운로드 결과는 구글 Flow Omni의 이미지→영상 2단계
            워크플로우에 맞춰 프레임마다 [IMAGE]/[VIDEO]/[AUDIO]로 나뉜 영어 텍스트로 자동 번역되며,
            캐릭터·스타일 고정 묘사가 매 프레임에 자동으로 함께 붙습니다.
          </p>
        </section>
      )}
    </>
  );
}
