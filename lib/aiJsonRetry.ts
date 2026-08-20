import type { ZodType } from "zod";
import { getOpenAIClient, STORYBOARD_MODEL } from "@/lib/openai";
import { withRetry } from "@/lib/retry";

// 사용자 요청 — "AI 응답이 12프레임 형식 규칙을 지키지 않았습니다"가 가끔 발생하는데
// "무조건 12프레임 나오도록 강제해줘". /api/storyboard, /api/storyboard/frame,
// /api/storyboard/export-translate 3개 라우트가 전부 "AI 호출 → JSON 파싱 → zod 검증,
// 실패 시 형식 재요청" 구조를 각자 복붙해서 갖고 있었는데(최대 2회, 실패해도 완전히 같은
// 프롬프트를 그대로 다시 보냄), 이번 요청을 계기로 한 곳에 모으면서 신뢰성을 함께 올린다.
// 100%를 코드로 "보장"할 수는 없다(창의적 생성 결과라 완벽한 강제는 불가능) — 실측 결과
// 실제 실패 원인은 "12개 미만/초과"가 아니라 "12개 중 1~2개 프레임의 imageDescription이
// 100자를 살짝 못 채움" 같은 부분 위반이 대부분이었다(디버그 로그로 직접 확인). 그래서:
//  1) 형식 위반 시 "같은 프롬프트 반복"이 아니라, 실패한 응답 + zod가 잡아낸 구체적인 문제
//     목록(어느 프레임의 어느 필드가 왜 틀렸는지)을 대화 기록(messages)에 남겨서 "그 부분만
//     정확히 고쳐서 전체를 다시 보내라"고 요청한다 — 실제로 이 방식으로 재시도 1회 만에
//     100자 미달 프레임이 정확히 고쳐지는 것을 확인했다. 이게 이 유틸의 핵심 개선점이다.
//  2) max_tokens를 넉넉하게 고정해, 12프레임 분량 응답이 도중에 잘려 JSON 자체가 깨지는
//     경우를 방지한다(실제 비용은 사용한 토큰만큼만 청구되므로 상한을 넉넉히 잡아도 손해가 없다).
//  3) (★중요) 재시도 횟수는 기본값 2회로 "유지"한다 — 3회로 늘려서 실측해보니, 매 시도가
//     실제 OpenAI 호출 1회(약 20~60초, 상황에 따라 편차 큼)라 3회를 다 채우면 총 소요 시간이
//     Vercel의 maxDuration(60초, app/api/storyboard/route.ts 등)을 가볍게 넘겨버렸다(로컬
//     테스트에서 100초 이상 걸린 사례 확인). "형식 위반 시 1회 재요청"이라는 기존 설계는
//     그대로 두고, 그 1회를 "맹목적 반복"에서 "정확한 피드백 기반 수정"으로 바꾼 것이 이번
//     개선의 핵심이다. 프레임 재생성(단일 프레임이라 훨씬 가볍고 빠름)처럼 호출부가 판단해
//     여유가 있는 곳만 개별적으로 maxAttempts를 늘려 쓴다.
export class AiJsonFormatError extends Error {}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function requestJsonWithRetry<T>({
  system,
  user,
  schema,
  maxAttempts = 2,
  maxTokens = 12000,
}: {
  system: string;
  user: string;
  schema: ZodType<T>;
  maxAttempts?: number;
  maxTokens?: number;
}): Promise<T> {
  const client = getOpenAIClient();
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Plan SC: PLAN.md 8번 — 네트워크/OpenAI 서버 오류로 이 호출 자체가 실패하면 1~2초 간격으로
    // 최대 3회까지 자동으로 다시 시도한다 (여기 형식 재요청 루프와는 별개 계층).
    const completion = await withRetry(() =>
      client.chat.completions.create({
        model: STORYBOARD_MODEL,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        messages,
      })
    );

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const isLastAttempt = attempt >= maxAttempts;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (!isLastAttempt) {
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content:
            "방금 응답이 올바른 JSON이 아니었어. 다른 설명 없이 유효한 JSON 형식으로만 다시 응답해줘.",
        });
      }
      continue; // JSON 자체가 깨졌으면 형식 재요청으로 취급
    }

    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    if (!isLastAttempt) {
      // zod가 잡아낸 문제를 구체적으로 알려줘서, 같은 실수를 반복하지 않고 그 부분만 고쳐서
      // 완전한 JSON 전체를 다시 보내도록 요청한다(부분 수정 응답을 허용하지 않는다).
      const issues = result.error.issues
        .slice(0, 12)
        .map((issue) => `- ${issue.path.join(".") || "(전체)"}: ${issue.message}`)
        .join("\n");
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `방금 응답이 아래 규칙을 지키지 않았어. 지적된 부분을 정확히 고쳐서, 빠지거나 줄어든 내용 없이 완전한 JSON 전체를 처음부터 다시 응답해줘:\n${issues}`,
      });
    }
  }

  throw new AiJsonFormatError("AI 응답이 형식 규칙을 지키지 않았습니다.");
}
