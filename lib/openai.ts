import OpenAI from "openai";

// 사용자 요청 — "현재 openAI API KEY를 활용하고 있다면 ChatGPT 모델을 GPT4o-mini로 고정해줘".
// 이 앱이 호출하는 OpenAI 모델 3개(스토리보드/캐릭터 비전/레퍼런스 비전) 전부를 gpt-4o-mini로
// 고정한다 — JSON 응답 모드(response_format: json_object)와 이미지 입력(비전) 둘 다 지원해서
// 세 용도 모두에 그대로 쓸 수 있다. 이후 모델을 다시 바꿀 일이 생겨도 이 파일 한 곳만 고치면 된다.
export const STORYBOARD_MODEL = "gpt-4o-mini";

// 캐릭터(인물) 사진 설명 생성 기능용 모델. 스토리보드 모델과 값은 같지만, 나중에 필요에 따라
// 서로 다른 모델로 바꿀 수 있도록 상수를 분리해 둔다.
export const CHARACTER_MODEL = "gpt-4o-mini";

// 사용자 요청 — 레퍼런스 예능 이미지 분위기 묘사 생성 기능용 모델. CHARACTER_MODEL과 값은 같지만,
// 같은 이유(추후 독립적으로 모델을 바꿀 수 있도록)로 상수를 분리해 둔다.
export const REFERENCE_MODEL = "gpt-4o-mini";

let client: OpenAI | null = null;

/** OpenAI 클라이언트를 요청마다 새로 만들지 않고 하나만 만들어 재사용한다 */
export function getOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}
