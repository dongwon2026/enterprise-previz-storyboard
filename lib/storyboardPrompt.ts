// Design Ref: DESIGN.md §2 데이터 흐름 ① / Plan SC: PRD 5절
// AI에게 "예능 기획 아이디어 → 12프레임 텍스트 스토리보드"를 요청할 때 쓰는 프롬프트.
// PRD 5절의 규칙 + 추가 요청 사양(구글 Flow Omni 렌더 안정성: 인물 일관성/읽는 글자 금지/
// 스태프 노출 금지/[IMAGE]·[VIDEO]·[AUDIO] 필드 분리/동작 밀도 제한/8초 이상 비트 분할)을
// 함께 지시문으로 옮겨 담았다.

/** "적용"된 캐릭터 1명의 정보 — 프롬프트에 그대로 삽입할 라벨+역할+외형 설명 */
export type CastMemberForPrompt = {
  id: string;
  label: string;
  role: string;
  description: string;
};

// 구글 Flow Omni는 "스틸 이미지를 먼저 뽑고, 그 이미지를 시작 프레임으로 물려 비디오를 생성"하는
// 2-step 워크플로우를 쓴다 (사용자 요청). 그래서 프레임 1개를 [IMAGE]/[VIDEO]/[AUDIO] 3구역으로
// 완전히 분리해서 만들어야 하고, 두 구역이 서로 다른 목적을 갖는다:
// - imageDescription([IMAGE]) = "정지된 사진 한 장"을 만드는 프롬프트 → 화각·배경·조명·표정·정지 포즈만.
//   동작(움직임)이나 카메라 무빙은 절대 섞지 않는다 (정지 이미지에는 의미가 없음).
// - videoAction([VIDEO]) = 그 정지 이미지에서 "몇 초짜리 짧은 동영상"을 만드는 프롬프트 →
//   카메라 무빙 1개 + 아주 단순한 동작 1개만. 여러 동작을 한 문장에 나열하지 않는다.
// - audioNote([AUDIO]) = 앰비언스·SFX만, 대사 절대 금지(립싱크 실패 방지).
// 동작 밀도 상한, "읽는 글자"/스태프 금지 규칙 — 두 프롬프트(최초 생성/재생성)가 공통으로 지켜야 해서
// 한 곳에 모아 재사용한다.
const RENDER_SAFETY_RULES = `- imageDescription에는 화각(와이드샷/클로즈업 등), 배경 상황, 조명, 인물의 표정과 "정지된" 포즈만 담는다. 동작(움직임)이나 카메라 무빙 지시는 절대 섞지 않는다 (그건 videoAction에만 적는다).
- videoAction에는 "카메라 무빙 1개(예: 슬로우 팬, 트래킹)" + "아주 단순하고 직관적인 단일 동작 1개"만 적는다. 시공간이 튀는 복잡한 연속 동작(예: "인사하고 가리키고 냄새를 맡는다"처럼 동작을 3개 이상 나열)은 금지한다.
- (필수, 예외 없음) durationSec이 8초 이상인 프레임은 videoAction을 절대 하나의 긴 문장으로 쓰지 않는다. 반드시 4초를 넘지 않는 단위로 "비트 1", "비트 2"... 로 쪼개서 적어야 하며, 각 비트는 단순 동작 1개만 담는다. videoAction 문장 안에 "비트 1"이라는 글자가 정확히 포함돼 있어야 한다(이 형식을 지키지 않으면 응답이 자동으로 거부되고 다시 요청받는다). 형식 예시 — 8초: "비트 1 (0~4초): [동작1] / 비트 2 (4~8초): [동작2]", 10초: "비트 1 (0~4초): [동작1] / 비트 2 (4~8초): [동작2] / 비트 3 (8~10초): [동작3]". durationSec이 6초 이하인 프레임에는 비트를 나누지 않는다.
- imageDescription과 videoAction 어디에도 인물의 옷차림·헤어스타일·외모(나이대/체형/생김새 등) 묘사를 절대 넣지 않는다. 옷이 프레임마다 바뀌면 AI가 아예 다른 사람으로 인식하기 때문에, 외형 묘사는 오직 "고정 출연자 외형 설명"으로만 전달되고 각 프레임 문장에는 반복하지 않는다.
- 화면에서 사람이 읽어야 하는 글자가 나오는 요소(간판, 포스터, 손글씨 메뉴판, 스마트폰/태블릿 화면, 지도 앱, 브랜드 로고, 소품에 새겨진 글자)는 만들지 않는다. 장면상 간판·포스터가 꼭 필요하면 "간판/포스터는 전부 아웃포커스 처리되어 읽을 수 없음"이라고 문장에 명시한다.
- (필수, 예외 없음) 기획 아이디어나 수정 지시에 "화면에 자막을 띄워줘", "이런 문구가 뜬다" 등 화면 속 글자·자막을 요청하는 내용이 있어도 그 요청은 절대 반영하지 않는다 — 위 규칙과 마찬가지로 화면에는 어떤 글자도 나타나지 않게 쓴다.
- 촬영 스태프(제작진, 카메라 크루, 마이크 붐 등 촬영 장비를 든 사람)는 프레임 안에 절대 등장시키지 않는다.
- (★가장 강력한 규칙, 예외 없음 — 구글 Flow Omni는 인물이 말하는 것처럼 묘사되면 립싱크를 시도하다 얼굴 픽셀이 기괴하게 뭉개지는 치명적 렌더 오류를 일으킨다) imageDescription/videoAction에는 대사 내용뿐 아니라 "말한다"/"대화를 나눈다"/"외친다"/"인사를 건넨다"처럼 발화·대화 행위 자체도 절대 직접 묘사하지 않는다. 그 순간 인물이 느끼는 감정과 상황에 어울리는 표정·비언어적 제스처로 반드시 바꿔서 쓴다. 치환 예시 — "오랜만이야!"라고 인사한다 → 환하게 웃으며 크게 손을 흔드는 모습 / "너무 맵다"라고 말한다 → 인상을 찌푸리며 손으로 부채질하는 모습 / 서로 재미있게 대화한다 → 마주 보고 눈짓하며 박수 치며 웃는 모습. 대사가 구체적으로 주어졌어도 그 문장을 그대로 옮기지 말고, 항상 이런 표정·동작 묘사로 재구성한다.
- audioNote 필드에는 앰비언스·SFX(효과음)만 적고, 대사(사람이 하는 말)는 절대 넣지 않는다 (립싱크 실패 방지). 예: "야외 시장 앰비언스, 그릇 부딪히는 소리". 인물의 반응을 소리로 표현해야 할 때도 "가벼운 웃음소리", "호탕한 웃음", "놀란 숨소리", "알아들을 수 없는 기분 좋은 웅성거림"처럼 비언어적 소리로만 표현한다.
- dialogue(대사)/caption(자막)은 imageDescription/videoAction 문장 안에 절대 포함시키지 않는다 (그 두 필드는 시각 정보만 담는다). 대사는 별도 dialogue/caption 필드로만 전달한다.`;

// 사용자 요청 — "스토리보드 생성시 대사도 추가해줘. 캐릭터가 한국 사람이면 한국말, 외국 사람이면
// 영어를 사용해. 대사에 맞는 자막도 추가해줘." dialogue/caption은 [IMAGE]/[VIDEO] 시각 프롬프트와는
// 완전히 분리된 "참고용 스크립트" 필드다. [IMAGE]/[VIDEO] 프롬프트에는 절대 섞이지 않는다 — 화면에
// 글자를 그리게 하거나 립싱크를 시도하게 만들지 않기 위함, 위 렌더 안정성 규칙과 충돌하지 않도록.
// 사용자 요청(2차, 대사·자막 렌더 안정성 전면 개선) — 이 두 필드는 이제 화면(FrameCard)에만 PD
// 참고용으로 표시되고, 구글 Flow Omni로 나가는 영어 내보내기([IMAGE]/[VIDEO]/[AUDIO]/[NEGATIVE
// PROMPT] 4블록)에는 더 이상 [DIALOGUE] 블록으로 포함되지 않는다 (lib/storyboardExport.ts 참고).
// 대신 imageDescription/videoAction 자체가 발화 행위를 묘사하지 않도록 위 렌더 안정성 규칙에서
// "표정·제스처로 자동 치환"하는 규칙을 강제하므로, 여기 dialogue/caption 생성 규칙 자체는 그대로 둔다.
const DIALOGUE_RULES = `- 이 장면에 실제로 대사(말하는 장면)가 있을 때만 dialogue를 채우고, 없으면(리액션 샷·이동 장면 등) dialogue와 caption을 둘 다 빈 문자열("")로 둔다.
- (중요) 기획 아이디어나 고정 출연자 설명에 "미국인", "외국인", "현지 게스트" 등 한국인이 아닌 국적·언어권 인물이 등장한다고 나와 있으면, 그 인물이 말하는 프레임의 dialogue는 반드시 영어로 쓴다 — 절대 한국어로 쓰지 않는다. 한국인 인물이 말하는 프레임은 한국어로 쓴다. 국적이 불분명한 인물만 한국어를 기본으로 한다. 외국인 인물이 하나라도 설정돼 있다면, 12프레임 중 그 인물이 대사하는 장면이 최소 1개 이상 있도록 스토리보드에 자연스럽게 반영한다.
- caption(자막)은 한국 시청자를 위한 방송 자막이다. dialogue가 한국어면 caption에 같은 문장을 그대로 옮기고, dialogue가 영어면 caption에는 그 대사의 자연스러운 한국어 번역을 적는다. dialogue가 비어 있으면 caption도 반드시 빈 문자열로 둔다.
- dialogue/caption 한 줄에는 한 사람의 짧은 대사 한 마디만 담는다(예: "다들 여기 처음 오시는 거죠?"). 여러 사람의 대사를 한 줄에 몰아 쓰지 않는다.`;

// 사용자 요청 — "장르 태그(+커스텀 텍스트) 조합 → 구글 Flow Omni 최적화 단일 마스터 스타일 고정"
// 생성 로직. 4개 그룹의 시각적 키워드(카메라 렌즈·조명·색감·무빙)를 사용자 지정 규칙 그대로 반영한다.
// 영문 필수 방어 문구("broadcast-safe exposure...")는 AI가 자유 문장으로 쓰게 두면 토씨가 미묘하게
// 달라질 위험이 있어(사용자가 "★중요, 토씨 하나 틀림없이" 명시), AI에게 맡기지 않고 내보내기 시점에
// 코드가 항상 정확히 같은 문장을 그대로 붙인다(lib/storyboardExport.ts의 STYLE_LOCK_MANDATORY_SUFFIX
// 참고) — 그래서 여기서는 "이 부분은 번역 걱정 없이 시스템이 자동으로 처리한다"고만 안내한다.
const STYLE_LOCK_GENERATION_RULES = `이번 기획 아이디어의 "장르" 목록(프리셋 태그 + 사용자가 "기타"로 직접 입력한 태그 모두 포함)을 분석해서, 아래 4개 그룹의 시각적 특징(카메라 렌즈·조명·색감·카메라 무빙)을 지능적으로 조합해 한국어 문장으로 표현하라.
- [감성/힐링 그룹](여행, 힐링, 관찰, 음식, 장사/경영, 교양, 부동산): 35mm 렌즈, 얕은 심도, 부드러운 자연광, 따뜻하고 채도 높은 색감(음식이 소재면 먹음직스러운 색감), 은은한 필름 그레인, 부드러운 핸드헬드.
- [긴장/액션 그룹](서바이벌, 두뇌게임, 스포츠): 시네마틱 와이드 렌즈, 강한 명암비(로우키 조명), 차갑고 거친 색감(틸앤오렌지), 땀·피부의 거친 질감 부각, 긴장감 있는 날것의 핸드헬드, 살짝 비튼 앵글(더치 앵글).
- [스튜디오/화사함 그룹](토크쇼, 오디션, 연애, 음악): 소프트박스 조명, 맑고 투명한 피부톤, 파스텔 또는 선명한 무대 색감, 안정적인 고정 앵글 또는 부드러운 짐벌 무빙.
- [방송 리얼리티 그룹](버라이어티, 리얼리티, 페이크다큐, 크로스오버): 하이엔드 방송용 디지털 카메라 룩, 배경까지 선명한 깊은 심도, 쨍한 콘트라스트, 깨끗한 해상도.
- 선택된 태그가 여러 그룹에 걸쳐 있으면(예: #서바이벌+#음식) 두 그룹의 시각적 특징을 어색하지 않게 융합하라(예: 어둡고 긴장감 있는 로우키 조명 속에서도 음식의 채도·윤기만은 강하게 살아나도록).
- 위 4개 그룹의 프리셋 18종에 없는, 사용자가 직접 입력한 태그(예: "직업 체험", "납량 특집")는 절대 문자 그대로의 내용 설명으로 옮기지 말고, 그 컨셉에 어울리는 시각적 무드(앵글의 역동성, 화질, 색감의 냉온, 조명 톤 등)로 능동적으로 해석해서 스타일에 녹여라(예: "직업 체험" → 현장감을 살리는 역동적 앵글과 쨍한 화질 / "납량 특집" → 차갑고 어두운 색감과 거친 노이즈).
- 문장 마지막에는 "화면 내 자막·그래픽·글자·UI 오버레이 노출 절대 금지, 간판 등 글자가 보이는 요소는 전부 아웃포커스 처리, CG가 아닌 실사(포토리얼)·하이엔드 방송 퀄리티"라는 취지를 한국어로 담아라(정확한 문구는 자유 — 이에 대응하는 영문 방어 문구는 내보내기 시 시스템이 자동으로 정확히 덧붙이므로 번역 걱정은 하지 않아도 된다).
- 전체 3~6문장, "스타일:"로 시작하는 자연스러운 한국어 문장으로 작성한다.`;

function buildCastContextBlock(castMembers: CastMemberForPrompt[] | undefined): string {
  if (!castMembers || castMembers.length === 0) return "";
  const lines = castMembers
    .map((c) => `- ${c.label}(${c.role}): ${c.description}`)
    .join("\n");
  return `\n\n고정 출연자 외형 설명 (반드시 이 외형을 유지하며 등장시킬 것, 프레임 문장에는 옷차림·외모를 다시 묘사하지 말 것):\n${lines}`;
}

function buildStyleLockBlock(styleLock: string | undefined): string {
  if (!styleLock || styleLock.trim().length === 0) return "";
  return `\n\n전체 영상의 스타일 톤(참고용, 문장 분위기를 여기에 맞출 것):\n"""\n${styleLock.trim()}\n"""`;
}

/** 레퍼런스 예능(이름/이미지 분위기 묘사) 정보 — 사용자 요청: 스토리보드 생성에 톤앤매너 참고로 반영 */
export type ReferenceForPrompt = {
  showName?: string;
  description?: string;
};

// 사용자 요청 — "레퍼런스 예능 이름과 이미지를 넣게 해주고 스토리보드에도 반영해줘". 이미지 원본은
// 서버에 전달하지 않고(캐릭터 사진과 같은 원칙: 최소 취급), 화면에서 미리 AI 비전 호출로 만든
// "분위기 묘사" 텍스트(lib/referencePrompt.ts)만 프롬프트에 참고 자료로 끼워 넣는다.
function buildReferenceBlock(reference: ReferenceForPrompt | undefined): string {
  const showName = reference?.showName?.trim();
  const description = reference?.description?.trim();
  if (!showName && !description) return "";
  const nameLine = showName ? `- 프로그램명: ${showName}\n` : "";
  const descLine = description ? `- 연출 분위기 묘사: ${description}\n` : "";
  return `\n\n레퍼런스 예능 참고 (연출 톤앤매너·색감·구도만 참고할 것 — 스토리·소재·인물을 그대로 베끼지 말 것):\n${nameLine}${descLine}`;
}

function buildSystemPrompt(castMembers: CastMemberForPrompt[] | undefined): string {
  const hasDefaultDuo = (castMembers ?? []).some((c) => c.id === "character1" || c.id === "character2");

  const castRule = hasDefaultDuo
    ? `8. 캐릭터1(진행자)/캐릭터2(고정 파트너)의 외형 설명이 주어졌다면, 12개 프레임 전부 같은 두 사람이 등장하는 것을 기본값으로 한다. 국가·에피소드 설정이 바뀌어도 진행자와 파트너는 항상 같은 인물로 유지한다. 기획 아이디어가 "여러 회차를 몽타주로 보여주며 파트너가 바뀐다"처럼 명시적으로 요청할 때만 예외를 허용한다.`
    : `8. 인물이 여러 프레임에 걸쳐 반복 등장한다면, 프레임끼리 인물이 달라 보이지 않게 한다. 단, 옷차림·외모 묘사는 프레임 문장에 넣지 않는다(위 렌더 안정성 규칙 참고) — "현지 푸드파이터", "체격 좋은 도전자" 같은 무명 지칭도 쓰지 않는다.`;

  return `너는 한국 방송사 예능 프로그램의 스토리보드 작가다.
PD가 준 예능 기획 아이디어 한 편을, 12개 프레임(장면)으로 구성된 텍스트 스토리보드로 바꿔라.
이 스토리보드는 구글 Flow Omni에서 "① 정지 이미지 생성 → ② 그 이미지를 시작 프레임으로 영상 생성"
2단계로 쓰이므로, 각 프레임은 imageDescription([IMAGE])/videoAction([VIDEO])/audioNote([AUDIO])
3개 필드로 완전히 분리해서 작성해야 한다.

반드시 지켜야 하는 규칙:
1. (★필수, 절대 예외 없음) 프레임은 반드시 정확히 12개를 만든다 — 11개 이하도, 13개 이상도 절대 안 된다. 번호는 1번부터 12번까지 빠짐없이, 이야기의 기승전결(시작→전개→절정→마무리) 흐름에 맞게 순서대로 배치한다. 임의의 순서로 늘어놓지 않는다. 응답을 보내기 전에 frames 배열의 길이를 스스로 세어서 정확히 12인지 반드시 확인한다.
2. 12개를 다 만든 뒤, 그 순서가 실제로 기승전결 흐름과 자연스럽게 이어지는지 스스로 다시 검토한다. 흐름이 어색하면 번호를 다시 배치해서 바로잡는다.
3. PD가 준 아이디어가 50자를 넘더라도 설정이나 정보가 부족하다고 판단되면, 예능 방송에 어울리도록 부족한 부분(인물, 장소, 상황 등)을 네가 합리적으로 보완해서 12프레임을 완성한다.
4. (★필수, 절대 예외 없음) imageDescription은 반드시 최소 100자 이상으로 쓴다 — 12개 중 단 하나라도 100자를 못 채우면 전체 응답이 거부된다. 이 문장은 그대로 "구글 Flow Omni"의 정지 이미지 생성 프롬프트로 사용되므로, 화각(와이드샷/클로즈업 등)·배경(장소·시간대·분위기)·조명·인물의 표정과 정지된 포즈를 구체적으로 담는다. 동작이나 카메라 무빙은 절대 섞지 않는다(videoAction에만 적는다). 여유 있게 120자 이상을 목표로 쓰고, 각 문장을 완성한 뒤 글자 수가 100자 미만인 프레임이 없는지 12개 전부를 스스로 다시 확인한다.
5. 각 프레임의 durationSec(분량, 초)은 반드시 2, 4, 6, 8, 10 중 하나여야 한다. 그 외의 숫자(홀수 등)는 절대 쓰지 않는다. 장면 내용에 어울리는 길이를 골라라.
6. 모든 문장은 한국어로 작성한다.
7. 다음 렌더 안정성 규칙을 지킨다:
${RENDER_SAFETY_RULES}
${castRule}
9. 레퍼런스 예능 정보가 함께 주어지면, 그 프로그램의 스토리·소재·인물을 그대로 베끼지 말고 오직 촬영 톤앤매너(색감·조명·구도·편집 리듬)만 참고해서 imageDescription 묘사에 은은하게 반영한다.
10. 각 프레임의 dialogue(대사)/caption(자막)은 다음 규칙을 지킨다:
${DIALOGUE_RULES}
11. 응답 최상위(top-level)에 styleLock 필드를 함께 만든다 — 다음 규칙에 따라 이번 기획에 맞는 "스타일 고정" 문구를 새로 제안한다(빈 문자열로 두지 않는다):
${STYLE_LOCK_GENERATION_RULES}
12. 출력은 다른 설명 없이 아래 JSON 형식 하나로만 한다:
{"frames":[{"no":1,"imageDescription":"...","videoAction":"...","durationSec":4,"audioNote":"...","dialogue":"...","caption":"..."}, ... 총 12개 ...],"styleLock":"..."}`;
}

/** 최초 생성 요청 시 OpenAI에 보낼 system/user 메시지를 만든다 */
export function buildStoryboardPrompt(
  idea: string,
  options?: { styleLock?: string; castMembers?: CastMemberForPrompt[]; reference?: ReferenceForPrompt }
): {
  system: string;
  user: string;
} {
  const castBlock = buildCastContextBlock(options?.castMembers);
  const referenceBlock = buildReferenceBlock(options?.reference);
  // 사용자 요청 — styleLock은 이제 "이전 초안의 톤을 참고"하는 방식이 아니라, 장르 태그(+커스텀
  // 입력) 조합을 분석하는 STYLE_LOCK_GENERATION_RULES로 완전히 새로 만든다. 기존 styleLock 텍스트를
  // 함께 보내면 "그 분위기에 맞추라"는 예전 지시와 섞여 장르 매핑 규칙이 흐려질 수 있어, 최초 생성
  // 요청에는 더 이상 현재 styleLock 값을 컨텍스트로 넣지 않는다(프레임 재생성은 여전히 참고용으로
  // 넣는다 — buildFrameRegenPrompt 참고, 거기는 새 styleLock을 만드는 게 아니라 기존 스타일을 유지해야 함).
  return {
    system: buildSystemPrompt(options?.castMembers),
    user: `PD가 입력한 예능 기획 아이디어:\n"""\n${idea}\n"""${castBlock}${referenceBlock}\n\n위 아이디어로 12프레임 스토리보드를 JSON으로 만들어줘.`,
  };
}

// Design Ref: DESIGN.md §2 데이터 흐름 ② / Plan SC: PRD 5-2절 "재생성해도 나머지 8개 프레임은 변경하지 않는다"
function buildFrameRegenSystemPrompt(castMembers: CastMemberForPrompt[] | undefined): string {
  const castLockRule =
    castMembers && castMembers.length > 0
      ? `5. 이 프레임에는 아래 고정 출연자가 등장한다. 이 인물들의 외형(나이대·체형·머리·의상 등)은 절대 바꾸지 않는다. PD의 수정 지시는 오직 동작·구도·소품에만 반영한다. 만약 수정 지시 중 일부가 이 인물들의 성별·나이·체형·외형 자체를 바꾸라는 내용이면, 그 부분은 무시하고 나머지 지시만 반영한다. imageDescription/videoAction 문장에는 이 인물들의 옷차림·외모를 다시 묘사하지 않는다(렌더 안정성 규칙 참고).\n${castMembers.map((c) => `   - ${c.label}(${c.role}): ${c.description}`).join("\n")}`
      : `5. PD가 수정 지시를 함께 주면 그 지시를 최우선으로 반영한다.`;

  return `너는 한국 방송사 예능 프로그램의 스토리보드 작가다.
이미 만들어진 12프레임 스토리보드 중 PD가 지정한 프레임 딱 1개만 새로 다시 써야 한다.
이 스토리보드는 구글 Flow Omni에서 2단계(정지 이미지→영상)로 쓰이므로, imageDescription([IMAGE])/
videoAction([VIDEO])/audioNote([AUDIO]) 3개 필드로 완전히 분리해서 작성한다.

반드시 지켜야 하는 규칙:
1. 요청받은 프레임 번호(no)는 그대로 유지한다. 다른 번호로 바꾸지 않는다.
2. imageDescription은 최소 100자 이상으로 쓴다. 화각·배경·조명·인물의 표정과 정지된 포즈를 구체적으로 담고, 동작·카메라 무빙은 절대 섞지 않는다(videoAction에만 적는다).
3. durationSec(분량, 초)은 반드시 2, 4, 6, 8, 10 중 하나여야 한다.
4. 함께 제공되는 나머지 11개 프레임 내용을 참고해서, 전체 서사(기승전결) 흐름과 자연스럽게 이어지도록 새로 쓴다. 나머지 11개 프레임 내용은 절대 다시 출력하지 않는다.
${castLockRule}
6. 모든 문장은 한국어로 작성한다.
7. 다음 렌더 안정성 규칙을 지킨다:
${RENDER_SAFETY_RULES}
8. 레퍼런스 예능 정보가 함께 주어지면, 그 프로그램의 스토리·소재·인물을 그대로 베끼지 말고 오직 촬영 톤앤매너(색감·조명·구도·편집 리듬)만 참고해서 imageDescription 묘사에 은은하게 반영한다.
9. dialogue(대사)/caption(자막)은 다음 규칙을 지킨다:
${DIALOGUE_RULES}
10. 출력은 다른 설명 없이 아래 JSON 형식 하나로만 한다 (지정된 프레임 1개만):
{"no":<지정된 프레임 번호>,"imageDescription":"...","videoAction":"...","durationSec":4,"audioNote":"...","dialogue":"...","caption":"..."}`;
}

type FrameForPrompt = {
  no: number;
  imageDescription: string;
  durationSec: number;
  videoAction: string;
  audioNote: string;
};

/** 프레임 1개 재생성 요청 시 OpenAI에 보낼 system/user 메시지를 만든다 */
export function buildFrameRegenPrompt(
  idea: string,
  frames: FrameForPrompt[],
  frameNo: number,
  instruction?: string,
  options?: { styleLock?: string; castMembers?: CastMemberForPrompt[]; reference?: ReferenceForPrompt }
): { system: string; user: string } {
  const otherFramesText = frames
    .filter((frame) => frame.no !== frameNo)
    .map((frame) => `${frame.no}번 (${frame.durationSec}초): ${frame.imageDescription}`)
    .join("\n");

  const instructionText =
    instruction && instruction.trim().length > 0
      ? `\n\n이번 재생성에서 반영해야 할 PD의 수정 지시(동작·구도·소품에만 반영, 위 고정 출연자 외형은 바꾸지 말 것): "${instruction.trim()}"`
      : "";

  const castBlock = buildCastContextBlock(options?.castMembers);
  const styleBlock = buildStyleLockBlock(options?.styleLock);
  const referenceBlock = buildReferenceBlock(options?.reference);

  return {
    system: buildFrameRegenSystemPrompt(options?.castMembers),
    user: `PD가 입력한 예능 기획 아이디어:\n"""\n${idea}\n"""\n\n전체 12프레임 스토리보드 중 나머지 11개 프레임(참고용, 그대로 유지됨):\n${otherFramesText}\n\n지금 다시 만들어야 할 프레임 번호: ${frameNo}번${castBlock}${styleBlock}${referenceBlock}${instructionText}\n\n${frameNo}번 프레임만 새로 써서 JSON으로 만들어줘.`,
  };
}
