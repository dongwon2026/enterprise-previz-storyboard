import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/auth";

// Design Ref: DESIGN.md §3 API 계약 — POST /api/auth
// PIN이 .env의 APP_ACCESS_PIN과 같으면 서명된 HttpOnly 쿠키를 발급한다
export async function POST(request: NextRequest) {
  let body: { pin?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "요청 형식이 올바르지 않습니다." } },
      { status: 400 }
    );
  }

  const pin = typeof body.pin === "string" ? body.pin : "";
  const correctPin = process.env.APP_ACCESS_PIN ?? "";

  if (!correctPin) {
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: "서버에 접속 비밀번호가 설정되어 있지 않습니다. 관리자에게 문의하세요.",
        },
      },
      { status: 500 }
    );
  }

  if (!pin || pin !== correctPin) {
    return NextResponse.json(
      { error: { code: "INVALID_PIN", message: "비밀번호가 올바르지 않습니다." } },
      { status: 401 }
    );
  }

  const { value, maxAgeSeconds } = await createSessionCookieValue();
  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
  return response;
}
