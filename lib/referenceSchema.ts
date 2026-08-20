import { z } from "zod";

// 사용자 요청 — 레퍼런스 예능 이미지 분위기 묘사 생성 기능. 업로드한 레퍼런스 이미지를 보고
// AI가 만든 "톤앤매너 묘사" 결과 형식을 검사하는 스키마. lib/characterSchema.ts와 같은 패턴이다.
export const REFERENCE_DESCRIPTION_MIN_LENGTH = 40;

export const referenceSchema = z.object({
  description: z
    .string()
    .min(
      REFERENCE_DESCRIPTION_MIN_LENGTH,
      `레퍼런스 분위기 묘사는 최소 ${REFERENCE_DESCRIPTION_MIN_LENGTH}자 이상이어야 합니다.`
    ),
});

export type ReferenceResult = z.infer<typeof referenceSchema>;
