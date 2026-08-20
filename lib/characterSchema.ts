import { z } from "zod";

// 캐릭터(인물) 설명 생성 기능 — 업로드한 사진을 보고 AI가 만든 인물 묘사 결과 형식을 검사하는 스키마.
// 스토리보드 프레임처럼 "구글 Flow Omni" 프롬프트로 그대로 쓰일 수 있게, 너무 짧은 결과는 막는다.
export const CHARACTER_DESCRIPTION_MIN_LENGTH = 80;

export const characterSchema = z.object({
  description: z
    .string()
    .min(
      CHARACTER_DESCRIPTION_MIN_LENGTH,
      `캐릭터 설명은 최소 ${CHARACTER_DESCRIPTION_MIN_LENGTH}자 이상이어야 합니다.`
    ),
});

export type CharacterResult = z.infer<typeof characterSchema>;
