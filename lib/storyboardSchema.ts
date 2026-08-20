import { z } from "zod";

// Design Ref: DESIGN.md §2 데이터 흐름 ① / Plan SC: PRD 5절
// AI가 만든 프레임 결과가 "12개 고정 / imageDescription 100자 이상 / 2~10초 짝수" 규칙을 지켰는지
// 코드가 자동으로 검사하도록 만든 스키마. 이걸 통과하지 못하면 화면에 내보내지 않는다.
// 사용자 요청(구글 Flow Omni 2-step 워크플로우 최적화) — 프레임 필드를 [IMAGE]/[VIDEO]/[AUDIO]
// 3구역에 대응하는 imageDescription/videoAction/audioNote로 재구성했다 (기존 description+cameraNote를
// imageDescription+videoAction으로 분리·재편, audioNote는 이름 그대로 유지).

/** 프레임 분량으로 허용하는 초 단위 (UI 드롭다운 등에서도 재사용) */
export const FRAME_DURATIONS = [2, 4, 6, 8, 10] as const;

// imageDescription/videoAction/audioNote를 본문 문장과 분리한 필드로 유지하는 이유(사용자 요청 사양):
// 정지 이미지([IMAGE])와 동영상 동작([VIDEO])을 완전히 분리해야 구글 Flow의 "이미지 먼저 생성 →
// 그 이미지를 시작 프레임으로 영상 생성" 2-step 워크플로우에 그대로 맞출 수 있다.
// "동작(beat) 밀도"·"옷차림 묘사 금지" 같은 문장 내용 규칙은 zod로 구조적으로 검증할 수 없어
// 프롬프트 지시(lib/storyboardPrompt.ts)로만 강제한다.
// 사용자 요청 §4 — "8초 이상 씬의 [VIDEO] 프롬프트 강제 분할". 프롬프트 지시만으로는 AI가 종종
// 비트로 나누지 않고 한 문장으로 써버리는 경우가 있어(실제 확인됨), "강제"가 되도록 zod 구조
// 검증에도 넣는다. 이 검증에 걸리면 storyboardSchema.safeParse가 실패해서 기존 "형식 위반 시
// 1회 재요청" 재시도 루프(app/api/storyboard(/frame)/route.ts)가 자동으로 다시 시도하게 된다.
// 사용자 요청 — "스토리보드 생성 시 대사도 추가, 대사에 맞는 자막도 추가". dialogue(대사)/
// caption(자막)은 imageDescription/videoAction과 달리 "시각 정보"가 아니라 "참고용 스크립트"라
// 별도 필드로 분리한다(내보내기 시 [IMAGE]/[VIDEO] 프롬프트에 섞이지 않고 별도 [DIALOGUE] 블록으로만
// 나간다 — lib/storyboardExport.ts 참고, 립싱크/화면 속 글자 렌더 실패 방지 원칙과 충돌하지 않도록).
// 대사가 없는 장면(리액션 샷 등)도 많으므로 둘 다 빈 문자열을 허용하되, "대사가 있으면 자막도
// 있어야 한다"는 짝을 zod로 검증한다.
export const frameSchema = z
  .object({
    no: z.number().int().min(1).max(12),
    imageDescription: z.string().min(100, "imageDescription(장면 설명)은 100자 이상이어야 합니다."),
    durationSec: z.union([
      z.literal(2),
      z.literal(4),
      z.literal(6),
      z.literal(8),
      z.literal(10),
    ]),
    videoAction: z.string().min(10, "videoAction(카메라 무빙+동작)은 필수입니다."),
    audioNote: z.string().min(2, "audioNote(앰비언스·SFX)는 필수입니다."),
    dialogue: z.string(),
    caption: z.string(),
  })
  .refine((frame) => frame.durationSec < 8 || /비트\s*1/.test(frame.videoAction), {
    message: "8초 이상 프레임의 videoAction은 '비트 1 (0~4초): ...' 형식으로 나눠 써야 합니다.",
    path: ["videoAction"],
  })
  .refine((frame) => frame.dialogue.trim().length === 0 === (frame.caption.trim().length === 0), {
    message: "caption(자막)은 dialogue(대사)가 있을 때만, 있을 때는 반드시 채워야 합니다.",
    path: ["caption"],
  });

/** 최초 생성 시 응답 형식 — 정확히 12개, 번호는 1번부터 12번까지 순서 고정 (PRD 5-1절, 12개로 확장) */
export const storyboardSchema = z
  .object({
    frames: z.array(frameSchema).length(12, "프레임은 정확히 12개여야 합니다."),
  })
  .refine((data) => data.frames.every((frame, index) => frame.no === index + 1), {
    message: "프레임 번호는 1번부터 12번까지 순서대로 있어야 합니다.",
  });

// 사용자 요청 — "스타일 고정을 스토리보드에 맞게 그때그때 수정". 최초 생성 응답에만 AI가 이번
// 기획 아이디어에 맞춰 새로 제안하는 styleLock 문구를 함께 받는다 (재생성 시에는 요청하지 않음 —
// 프레임 재생성 라우트가 storyboardSchema로 "나머지 프레임 목록"만 재검증하는 기존 용도와 겹치지
// 않도록 별도 스키마로 둔다).
export const storyboardGenerationSchema = storyboardSchema.and(
  z.object({ styleLock: z.string().min(1, "styleLock 추천 문구가 비어 있습니다.") })
);

/** 프레임 1개 재생성 시 응답 형식 (PLAN.md 12번 재생성 API 라우트에서 사용) */
export const singleFrameSchema = frameSchema;

export type Frame = z.infer<typeof frameSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
