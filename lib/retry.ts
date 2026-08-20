// Design Ref: DESIGN.md §2 데이터 흐름 ① / PLAN.md 8번
// 서버 ↔ OpenAI 통신이 네트워크 문제 등으로 실패했을 때 쓰는 "재사용 가능한" 자동 재시도 유틸.
// 1~2초 간격으로 최대 3회까지 같은 호출을 다시 시도한다.
// (storyboard route.ts 안에 있는 "AI 응답 형식이 틀렸을 때 1회 재요청"과는 완전히 다른 별개 로직이다.
//  이 유틸은 "요청 자체가 실패(네트워크 끊김, OpenAI 서버 오류 등)"했을 때만 동작한다.)

const RETRY_COUNT = 3;
const RETRY_DELAY_MIN_MS = 1000;
const RETRY_DELAY_MAX_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 1000~2000ms 사이의 임의의 대기 시간을 만든다 (요청이 한꺼번에 몰리는 것을 피하기 위함) */
function randomDelay(): number {
  return RETRY_DELAY_MIN_MS + Math.random() * (RETRY_DELAY_MAX_MS - RETRY_DELAY_MIN_MS);
}

/**
 * 비동기 함수 fn을 실행하고, 실패하면 1~2초 뒤 다시 실행하기를 최대 3회까지 반복한다.
 * 3회 모두 실패하면 마지막으로 발생한 에러를 그대로 던진다 (호출한 쪽에서 UPSTREAM_ERROR 등으로 변환).
 *
 * 사용 예: const completion = await withRetry(() => client.chat.completions.create({...}));
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_COUNT) {
        await sleep(randomDelay());
      }
    }
  }

  throw lastError;
}
