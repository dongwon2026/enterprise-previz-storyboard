// 캐릭터 설명 생성 박스(캐릭터1/2/3)와 프레임의 castRefs가 공통으로 참조하는 고정 목록.
// 슬롯 개수·순서를 한 곳에서만 관리해 컴포넌트 여러 곳에서 어긋나지 않게 한다.
// role은 프롬프트에서 "기본 고정 출연자(진행자/파트너)"인지 "추가 출연자"인지 AI에게 알려주는 용도.
// 사용자 요청 — 캐릭터 슬롯을 3개에서 5개로 확장 (캐릭터4/5 추가). 캐릭터1/2(진행자/고정 파트너)만
// 기본 자동 태깅 대상이고, 3/4/5는 전부 "추가 출연자" 계열이라 PD가 필요한 프레임에 수동 태깅한다.
export const CAST_CHARACTERS = [
  { id: "character1", label: "캐릭터1", role: "진행자" },
  { id: "character2", label: "캐릭터2", role: "고정 파트너" },
  { id: "character3", label: "캐릭터3", role: "추가 출연자1" },
  { id: "character4", label: "캐릭터4", role: "추가 출연자2" },
  { id: "character5", label: "캐릭터5", role: "추가 출연자3" },
] as const;

export type CastCharacterId = (typeof CAST_CHARACTERS)[number]["id"];

// 사용자 요청 — "생성된 캐릭터들에 대한 역할을 작성할 수 있게 해줘" (기획 아이디어 표의 "프로그램
// 개요" 필드 바로 위). 위 role("진행자"/"고정 파트너" 등)은 캐릭터 슬롯 고유의 고정 라벨이고,
// 이 값은 그와 별개로 "이번 기획에서 이 인물이 맡는 역할"을 PD가 매번 새로 적는 짧은 텍스트다
// (예: "시골 이장님", "미슐랭 셰프 게스트"). 스토리보드 생성/재생성 프롬프트에는 이 값이 있으면
// 고정 role 대신 우선 사용된다 (StoryboardWorkspace.tsx의 resolveCastMembers 참고).
export const ROLE_MAX_LENGTH = 40;

// 스토리보드 생성 시 "채워져 있으면 9개 프레임 전부 기본 출연"으로 자동 태깅되는 대상
// (PD 요청: 캐릭터1=진행자, 캐릭터2=고정 파트너). 캐릭터3(추가 출연자)은 자동 태깅하지 않고
// PD가 필요한 프레임에 수동으로 "이 인물을 프레임에 적용"으로 태깅한다.
export const DEFAULT_CAST_IDS: CastCharacterId[] = ["character1", "character2"];

export function castLabel(id: string): string {
  return CAST_CHARACTERS.find((c) => c.id === id)?.label ?? id;
}
