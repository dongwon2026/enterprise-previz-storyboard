import { z } from "zod";

// Design Ref: 사용자 요청 — "전체 복사"/".txt 다운로드"/"이 프레임 복사"는 구글 Flow Omni용으로
// 영어 번역해서 내보낸다. AI 번역 응답이 이 구조를 그대로 지켜야, 서버가 원래 프레임 번호(no)·
// 분량(durationSec, 번역 대상 아님)과 안전하게 다시 짝지어 조립할 수 있다 (storyboardSchema.ts와 같은 패턴).

// 사용자 요청(2차, ★가장 강력한 규칙) — imageDescription/videoAction 영어 번역에 발화(말하기) 동사가
// 하나라도 남아 있으면 구글 Flow Omni가 립싱크를 시도하다 얼굴이 뭉개지는 치명적 렌더 오류를 낸다.
// lib/exportTranslatePrompt.ts의 프롬프트 지시만으로는 "완전한 예외 없음"을 보장할 수 없다는 걸
// 이 세션에서 여러 번 확인했으므로(styleLock 방어 문구 재현 실패 사례 등), 여기서도
// storyboardSchema.ts의 "8초 이상 비트 분할 강제"와 같은 방식으로 코드가 직접 검사한다 — 이 검증에
// 걸리면 safeParse가 실패해서 기존 "형식 위반 시 1회 재요청" 루프(export-translate/route.ts)가
// 자동으로 다시 시도한다. styleLock/negativePrompt는 검사 대상이 아니다(예: "토크쇼" 장르 설명이
// "talk show"로 번역되는 등 정당한 사용이 있어, 인물의 발화 행위를 직접 묘사하는 imageDescription/
// videoAction에만 좁혀 적용한다).
const BANNED_SPEECH_WORDS =
  /\b(talk|talks|talking|talked|speak|speaks|speaking|spoke|spoken|say|says|saying|said|dialogue|conversation|chat|chats|chatting)\b/i;

export const exportTranslateSchema = z.object({
  styleLock: z.string(),
  negativePrompt: z.string(),
  castDescriptions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      role: z.string(),
      description: z.string(),
    })
  ),
  frames: z
    .array(
      z.object({
        no: z.number().int(),
        imageDescription: z.string(),
        videoAction: z.string(),
        audioNote: z.string(),
      })
    )
    .superRefine((frames, ctx) => {
      frames.forEach((frame, index) => {
        if (BANNED_SPEECH_WORDS.test(frame.imageDescription)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${frame.no}번 프레임 imageDescription에 발화 동사(talk/speak/say 등)가 남아 있습니다 — 표정·제스처 묘사로 바꿔야 합니다.`,
            path: [index, "imageDescription"],
          });
        }
        if (BANNED_SPEECH_WORDS.test(frame.videoAction)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${frame.no}번 프레임 videoAction에 발화 동사(talk/speak/say 등)가 남아 있습니다 — 표정·제스처 묘사로 바꿔야 합니다.`,
            path: [index, "videoAction"],
          });
        }
      });
    }),
});

export type ExportTranslateResult = z.infer<typeof exportTranslateSchema>;
