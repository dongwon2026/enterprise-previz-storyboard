// Design Ref: 사용자 요청 — "전체 복사"/".txt 다운로드"/"이 프레임 복사" 결과는 구글 Flow Omni용으로
// 영어 번역해서 내보낸다. 화면(스타일 고정/네거티브 프롬프트/프레임의 imageDescription·videoAction·
// audioNote)은 전부 한국어인데, 내보낼 때만 AI로 번역해서 Flow Omni가 그대로 쓸 수 있는 영어
// 텍스트를 만든다.
//
// 사용자 요청(2차, ★가장 강력한 규칙) — "구글 Flow(Omni) 같은 영상 AI 모델은 발화(립싱크)를
// 묘사하거나 화면에 자막을 렌더링하도록 지시하면 얼굴 픽셀이 기괴하게 뭉개지는 치명적인 에러가
// 발생한다." 이 문제의 실제 발생 지점은 "AI에게 최종적으로 전달되는 영어 텍스트"이므로, 이 번역
// 프롬프트가 마지막 방어선이다. imageDescription/videoAction을 영어로 옮길 때 원문이 대사·발화
// 행위를 담고 있어도 talk/speak/say 계열 단어를 쓰지 않고 비언어적 표정·제스처 묘사로 "치환"하며,
// 이는 일반적인 "의미 그대로 번역" 원칙(규칙 1)보다 우선한다. 아래 규칙 2·3을 어긴 번역 결과는
// lib/exportTranslateSchema.ts의 superRefine이 감지해 형식 위반으로 처리하고 자동 재요청한다
// (storyboardSchema.ts의 "8초 이상 비트 분할 강제"와 같은 패턴 — 프롬프트 지시만으로는 100%
// 보장되지 않는다는 걸 이 세션에서 반복 확인했기 때문에, 코드 검증을 함께 둔다).

export type ExportTranslateCastInput = { id: string; label: string; role: string; description: string };
export type ExportTranslateFrameInput = {
  no: number;
  imageDescription: string;
  videoAction: string;
  audioNote: string;
};
export type ExportTranslateInput = {
  styleLock: string;
  negativePrompt: string;
  castDescriptions: ExportTranslateCastInput[];
  frames: ExportTranslateFrameInput[];
};

/** 내보내기 번역 요청 시 OpenAI에 보낼 system/user 메시지를 만든다 */
export function buildExportTranslatePrompt(
  input: ExportTranslateInput
): { system: string; user: string } {
  const system = `너는 한국어로 작성된 예능 스토리보드를 "구글 Flow Omni"(영어 기반 AI 이미지·영상 생성 도구)에
그대로 붙여넣을 수 있는 영어 프롬프트로 옮기는 전문 번역가다.

반드시 지켜야 하는 규칙:
1. 기본적으로 의미를 바꾸지 않고 그대로 번역한다. 내용을 추가·생략·요약하지 않는다. 단, 아래 2·3·4번 규칙(안전 치환)과 충돌하는 부분에서는 "글자 그대로의 번역"보다 반드시 그 규칙을 우선한다.
2. (★가장 강력한 규칙, 절대 예외 없음) imageDescription/videoAction을 영어로 옮길 때, talk, talks, talking, talked, speak, speaks, speaking, spoke, spoken, say, says, saying, said, dialogue, conversation, chat, chats, chatting처럼 "발화(말하기)"를 뜻하는 영어 단어를 단 하나도 쓰지 않는다. 원문이 "대화한다"/"말한다"/"외친다"/구체적인 대사를 담고 있어도, 그 문장 그대로 옮기지 말고 그 내용의 감정과 맥락을 파악해서 100% 비언어적인 표정과 제스처(non-verbal facial expressions and gestures) 묘사로 재구성해서 옮긴다. 이 부분은 "번역"이 아니라 "안전한 재구성"이므로, 원문에 없던 구체적인 표정·동작을 새로 만들어 붙여도 된다. 치환 예시:
   - "오랜만이야!"라고 인사한다 → Waves enthusiastically with a bright smile
   - "너무 맵다"라고 말한다 → Frowns and fans face with hands
   - 서로 재미있게 대화한다 → Look at each other, nodding and laughing while clapping
3. (★가장 강력한 규칙) audioNote를 영어로 옮길 때도 대사·발화 내용은 절대 담지 않는다. light laughter, hearty chuckle, surprised gasp, unintelligible warm murmurs 같은 비언어적 소리(non-verbal sounds)와 주변 현장음(ambience)만으로 표현한다.
4. 원문에 화면에 자막이나 텍스트를 띄워달라는 내용이 있어도 그 부분은 번역하지 않고 완전히 생략한다 — 화면 속 글자를 렌더링하라는 지시로 이어지면 안 된다.
5. imageDescription(정지 이미지 프롬프트)은 화각·배경·조명·표정·정지 포즈가 이미지 생성 프롬프트로 바로 쓸 수 있도록 자연스럽고 구체적인 영어 문장으로 옮긴다.
6. videoAction(동영상 프롬프트)에 "비트 1 (0~4초): ... / 비트 2 (4~8초): ..."처럼 비트로 나뉜 부분이 있으면, 그 구조를 그대로 유지한 채 "Beat 1 (0-4s): ... Beat 2 (4-8s): ..." 형식의 영어로 옮긴다. 비트가 없는 videoAction은 평범한 한 문장으로 번역한다.
7. label(캐릭터 호칭)과 role(역할)도 영어로 옮긴다 (예: "진행자" → "Host", "고정 파트너" → "Fixed partner").
8. no(프레임 번호), id(캐릭터 식별자) 같은 값은 번역하지 않고 입력값 그대로 출력한다.
9. 입력에서 비어 있는 문자열(빈 값)은 번역하지 않고 그대로 빈 문자열로 둔다.
10. 출력은 다른 설명 없이 입력과 정확히 같은 구조의 JSON 하나로만 한다.`;

  const user = `다음 한국어 스토리보드 내용을 전부 영어로 번역해서 같은 JSON 구조로 돌려줘:
${JSON.stringify(input, null, 2)}`;

  return { system, user };
}
