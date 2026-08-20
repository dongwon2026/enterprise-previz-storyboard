"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

// Design Ref: DESIGN.md §1 화면 구성 — PIN 게이트 (미입력/오답 시 차단)
export default function PinGate() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pin) {
      setError("비밀번호를 입력해주세요.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "비밀번호가 올바르지 않습니다.");
        return;
      }

      // 서버가 인증 쿠키를 내려줬으니, 화면을 다시 불러와 메인 화면으로 전환한다
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-80 rounded-lg border border-gray-200 p-8 text-center shadow-sm"
      >
        <h1 className="mb-6 text-xl font-bold">예능 기획안 Pre-viz</h1>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="비밀번호를 입력하세요"
          autoFocus
          className="w-full rounded border border-gray-300 px-3 py-2 text-center outline-none focus:border-ena-blue"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-4 w-full rounded bg-ena-blue py-2 font-bold text-white disabled:opacity-50"
        >
          {submitting ? "확인 중..." : "확인"}
        </button>
      </form>
    </main>
  );
}
