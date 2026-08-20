import { cookies } from "next/headers";
import { isValidSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";
import PinGate from "@/components/PinGate";
import StoryboardWorkspace from "@/components/StoryboardWorkspace";

// Design Ref: DESIGN.md §1 화면 구성 — PIN 게이트를 통과해야 아래 메인 화면이 보인다
// 입력창(IdeaInput)만 있던 자리를 StoryboardWorkspace로 교체 — 생성 결과(9프레임 카드)까지
// 함께 표시해야 해서 상태를 같이 관리하는 컴포넌트로 옮겼다 (PLAN.md 9번)
export default async function Home() {
  const cookieStore = await cookies();
  const authenticated = await isValidSessionCookie(
    cookieStore.get(SESSION_COOKIE_NAME)?.value
  );

  if (!authenticated) {
    return <PinGate />;
  }

  return (
    <main className="p-10">
      <h1 className="text-center text-4xl font-black text-ena-blue">예능 기획안 Pre-viz</h1>
      <StoryboardWorkspace />
    </main>
  );
}
