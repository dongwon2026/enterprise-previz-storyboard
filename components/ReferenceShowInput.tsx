"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";

// 사용자 요청 — "예능 기획 아이디어 옆에 레퍼런스 예능 이름과 이미지를 넣게 해주고 스토리보드에도
// 반영해줘". components/CharacterDescriber.tsx와 같은 원칙(사진 원본은 화면 메모리에만 잠깐 있다가
// 분위기 묘사 생성 1회 호출에만 쓰이고 사라짐 — localStorage·서버 모두 저장하지 않음)을 그대로 따른다.
// 이름(showName)과 AI가 만든 분위기 묘사(description) "텍스트"만 부모(StoryboardWorkspace)가 들고
// localStorage에 저장하고, 스토리보드 생성/재생성 프롬프트(lib/storyboardPrompt.ts)에 참고 자료로 넘긴다.
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

export default function ReferenceShowInput({
  showName,
  onShowNameChange,
  description,
  onDescriptionChange,
}: {
  showName: string;
  onShowNameChange: (value: string) => void;
  description: string | null;
  onDescriptionChange: (description: string | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";

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
    // 새 이미지를 고르면 이전 분위기 묘사는 더 이상 이 이미지를 묘사한 게 아니므로 비운다
    onDescriptionChange(null);
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
      const res = await fetch("/api/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body?.error?.message ?? "레퍼런스 분위기 분석에 실패했습니다.");
        return;
      }

      onDescriptionChange(body.data.description as string);
    } catch {
      setError("네트워크 오류로 요청을 보내지 못했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    // 사용자 요청 — 제목("레퍼런스 예능")은 이제 박스 바깥(부모 StoryboardWorkspace)에 왼쪽 정렬로
    // 표시하므로 여기서는 렌더링하지 않는다. flex-1로 부모의 h-full 컬럼을 채워, 예능 기획 아이디어
    // 박스와 높이를 맞춘다(items-stretch).
    <section className="flex w-full max-w-xs flex-1 flex-col rounded border border-gray-200 p-4 shadow-sm">
      <p className="mb-3 text-xs text-gray-500">
        참고하고 싶은 예능 프로그램의 이름과 장면 이미지를 넣으면, 그 촬영 톤앤매너(색감·조명·구도)를
        스토리보드 생성에 참고 자료로 반영해요. (이미지는 저장되지 않고 분위기 분석에만 사용됩니다)
      </p>

      <label htmlFor="reference-show-name" className="mb-1 block text-xs font-bold text-gray-600">
        레퍼런스 예능 이름
      </label>
      <input
        id="reference-show-name"
        type="text"
        value={showName}
        onChange={(e) => onShowNameChange(e.target.value)}
        placeholder="예: 1박 2일"
        maxLength={60}
        className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-ena-blue"
      />

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
          alt="선택한 레퍼런스 이미지 미리보기"
          className="mt-3 h-40 w-full rounded border border-gray-200 object-cover"
        />
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={!file || loading}
        className="mt-3 w-full rounded bg-ena-blue py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "분위기 분석 중..." : "레퍼런스 분위기 분석"}
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
          <p className="mt-2 text-xs text-gray-500">
            이 분위기 묘사는 스토리보드 생성/재생성 시 자동으로 함께 참고됩니다.
          </p>
        </div>
      )}
    </section>
  );
}
