"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";

// 목적: 예능 기획 아이디어 입력 위에 두는 독립 기능 — 인물 사진 1장을 올리면 AI가 그 사람의 외형을
// 상세한 한국어 문장으로 묘사해 준다. 결과는 별도 박스에 표시 + 복사 버튼을 제공하고,
// "이 인물을 프레임에 적용" 버튼으로 12프레임 스토리보드의 castRefs에 태깅해 인물 일관성을
// 유지하는 데도 쓸 수 있다 (사용자 요청: 인물 일관성 유지 기능).
// 사진은 화면(브라우저 메모리)에만 잠깐 있다가 API 호출에 한 번 쓰이고 사라진다 —
// localStorage에도, 서버에도 저장하지 않는다 (개인 사진이라 최소한으로만 다룬다).
// 설명 텍스트(description)는 스토리보드 생성/재생성/내보내기에 함께 쓰여야 해서 부모
// (StoryboardWorkspace)가 소유하는 controlled 값으로 바꿨다 — 사진/미리보기/로딩/에러 같은
// 이 박스 안에서만 필요한 상태는 여전히 로컬로 둔다.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function CharacterDescriber({
  characterId,
  label = "캐릭터 설명 생성",
  description,
  onDescriptionChange,
  appliedToAllFrames,
  onToggleApplyAll,
  hasStoryboard,
}: {
  characterId: string;
  label?: string;
  description: string | null;
  onDescriptionChange: (characterId: string, description: string | null) => void;
  appliedToAllFrames: boolean;
  onToggleApplyAll: (characterId: string) => void;
  hasStoryboard: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 미리보기용 객체 URL은 더 이상 안 쓰게 되면 반드시 해제해야 메모리가 쌓이지 않는다
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = ""; // 같은 파일을 다시 선택해도 change 이벤트가 나도록 초기화

    if (!selected) return;

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError("JPG, PNG, WEBP 파일만 업로드할 수 있습니다.");
      return;
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      setError(`사진 파일은 최대 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB까지 업로드할 수 있습니다.`);
      return;
    }

    setError(null);
    // 새 사진을 고르면 이전 설명은 더 이상 이 사진을 묘사한 게 아니므로 비운다
    onDescriptionChange(characterId, null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(selected));
    setFile(selected);
  }

  async function handleGenerate() {
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const imageDataUrl = await readAsDataUrl(file);
      const res = await fetch("/api/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body?.error?.message ?? "캐릭터 설명 생성에 실패했습니다.");
        return;
      }

      onDescriptionChange(characterId, body.data.description as string);
    } catch {
      setError("네트워크 오류로 요청을 보내지 못했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!description) return;
    try {
      await navigator.clipboard.writeText(description);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    // 사용자 요청 — 캐릭터 행이 5개 박스로 균등한 폭을 갖도록(grid-cols-5), 개별 박스의 max-w-xs
    // 상한을 없애고 부모 그리드 칸 너비를 그대로 채운다 (가로길이 균일화)
    <section className="w-full rounded border border-gray-200 p-4 shadow-sm">
      {/* 사용자 요청 — "예능 기획 아이디어"처럼 검은색 볼드 제목으로 통일 (기존 ena-blue 색상 제거) */}
      <h2 className="mb-2 font-bold">{label}</h2>
      <p className="mb-3 text-xs text-gray-500">
        인물 사진을 올리면 구글 Flow Omni 캐릭터 생성에 붙여넣을 수 있는 외형 묘사를 만들어줘요.
        (사진은 저장되지 않고 설명 생성에만 사용됩니다)
      </p>

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="block w-full text-xs"
      />

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- 사용자가 방금 고른 로컬 파일 미리보기라 next/image 최적화 대상이 아님
        <img
          src={previewUrl}
          alt="선택한 인물 사진 미리보기"
          className="mt-3 h-40 w-full rounded border border-gray-200 object-cover"
        />
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={!file || loading}
        className="mt-3 w-full rounded bg-ena-blue py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "설명 생성 중..." : "캐릭터 설명 생성"}
      </button>

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!file || loading}
            className="mt-1 rounded border border-red-400 bg-white px-2 py-1 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            재시도
          </button>
        </div>
      )}

      {description && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{description}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-gray-300 px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100"
            >
              {copied ? "복사됨!" : "설명 복사"}
            </button>
            {/* 사용자 요청: "이 인물을 프레임에 적용" — 12프레임 전체 castRefs에 이 캐릭터를 태깅/해제한다.
                스토리보드가 아직 없으면(frames가 없으면) 태깅할 대상이 없어 비활성화한다. */}
            <button
              type="button"
              onClick={() => onToggleApplyAll(characterId)}
              disabled={!hasStoryboard}
              title={
                !hasStoryboard
                  ? "먼저 스토리보드를 생성해야 프레임에 적용할 수 있습니다"
                  : appliedToAllFrames
                    ? "12개 프레임 전체에서 이 인물 태그를 뺍니다"
                    : "12개 프레임 전체에 이 인물을 태깅합니다 (개별 프레임에서 태그를 뺄 수도 있습니다)"
              }
              className={`rounded border px-2 py-1 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
                appliedToAllFrames
                  ? "border-ena-blue bg-ena-blue text-white"
                  : "border-ena-blue text-ena-blue hover:bg-blue-50"
              }`}
            >
              {appliedToAllFrames ? "프레임 적용됨 ✓" : "이 인물을 프레임에 적용"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
