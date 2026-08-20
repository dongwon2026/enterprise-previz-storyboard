// Design Ref: 사용자 요청 §5 — 특정 액션 장르별 방어 태그 자동 삽입 (Auto-Safe Tags)
// "이 5가지 범용적 규칙이 예외 없이 완벽하게 작동"해야 하므로, AI 판단에 맡기지 않고
// 코드가 프레임의 한국어 원문(imageDescription+videoAction)에서 키워드를 직접 찾아 결정한다.
// 감지되면 영어로 번역된 [VIDEO] 프롬프트 맨 끝에 해당 방어 문장을 그대로 덧붙인다
// (FrameCard.tsx의 IDENTITY_CHANGE_KEYWORDS와 같은 "가벼운 키워드 매칭" 패턴을 재사용).

type SafetyTagRule = {
  id: string;
  keywords: string[];
  tag: string;
};

const SAFETY_TAG_RULES: SafetyTagRule[] = [
  {
    // "먹"/"마시" 어간만으로는 "베어 문다"(bite)·"삼킨다"(swallow)·"들이킨다"(gulp)처럼 문자 그대로
    // "먹다/마시다"를 안 쓰는 흔한 표현을 놓쳐서(실제 생성 결과에서 확인됨), 어간 변형을 넉넉히 추가했다.
    id: "eating",
    keywords: [
      "먹", "마시", "시식", "맛보", "식사", "먹방", "한입", "한 입",
      "베어물", "베어 물", "베어먹", "베어 먹", "씹", "삼키", "삼킨", "들이킨", "들이켜", "우물",
    ],
    tag: "Keep hands in natural motion blur. Do not hold on an open chewing mouth for more than one second.",
  },
  {
    id: "fast-action",
    keywords: ["뛰", "달리", "싸우", "격투", "넘어지", "구르", "춤", "댄스", "몸싸움"],
    tag: "Keep rapid limb movements in natural motion blur. Avoid extreme body contortions.",
  },
  {
    id: "crowd",
    keywords: ["군중", "인파", "붐비", "행인", "관광객", "사람들 사이", "지나가는 사람", "시장 거리"],
    tag: "Keep background crowd out of focus. Maintain clear focus only on main characters.",
  },
  {
    id: "on-screen-text",
    keywords: ["미션 카드", "미션카드", "스마트폰", "휴대폰", "핸드폰", "간판", "포스터", "화면을 보"],
    tag: "Keep all text, UI overlays, and signage entirely blurred and non-legible.",
  },
];

/** 프레임의 한국어 원문(장면 설명 + 동작)에서 장르 키워드를 찾아, 해당하는 영어 방어 태그를 전부 돌려준다 */
export function detectSafetyTags(koreanText: string): string[] {
  const tags: string[] = [];
  for (const rule of SAFETY_TAG_RULES) {
    if (rule.keywords.some((kw) => koreanText.includes(kw))) {
      tags.push(rule.tag);
    }
  }
  return tags;
}
