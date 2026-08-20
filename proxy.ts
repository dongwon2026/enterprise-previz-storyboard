import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";

// Design Ref: DESIGN.md §2 데이터 흐름 ⑤ — /api/auth를 제외한 모든 API 요청 앞단에서
// PIN 인증 쿠키를 검사한다 (없거나 만료되면 401 UNAUTHORIZED)
// Next.js 16부터 예전의 middleware.ts가 proxy.ts로 이름만 바뀌었다 (PLAN.md 3번 참고)
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = await isValidSessionCookie(cookie);

  if (!authenticated) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "인증이 필요합니다." } },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
