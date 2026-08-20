# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

예능 기획안 Pre-viz 서비스 — 한국 방송사 예능 PD가 입력한 기획 아이디어를 12개 프레임 텍스트 스토리보드로 자동 변환해주는 사내(비공개) 업무 도구. 앱의 역할은 텍스트 스토리보드 생성까지이며, 실제 이미지/영상 생성은 PD가 완성된 스토리보드를 구글 Flow Omni에 직접 입력해 별도로 진행한다 (API 연동 없음).

**현재 상태: 코드베이스 미착수.** 이 저장소에는 아직 `PRD.md`(상세 기획서), `prd_lite.md`(요약본), `.env`만 존재하며 Next.js 프로젝트 스캐폴딩부터 시작해야 한다. 빌드/린트/테스트 명령은 `package.json` 생성 후 이 파일에 채워 넣을 것.

## 작업 규칙 (필수 준수)

- 모든 설명과 주석은 한국어로 작성한다.
- 새 파일은 `my-app` 폴더 안에만 만든다.
- 기술 스택은 PRD에 정한 대로 **Next.js로 고정**한다. 다른 프레임워크로 바꾸거나 마이그레이션을 제안하지 않는다. 배포는 **Vercel**을 사용한다.
- 코드를 바꾸면 반드시 무엇을 왜 바꿨는지 한 줄로 알려준다.
- `.env` 등 비밀 정보 파일과 `node_modules` 폴더는 `.gitignore`에 등록해 두고 절대 커밋하지 않는다.
- 외부 서비스 인증이 필요하면 토큰 값을 사용자에게 묻거나 채팅에 출력하지 말고, `.env`에 있는 값을 읽어서 사용한다.
  - 예: Supabase를 쓸 상황이 생기면 Supabase CLI를 설치해 `.env`의 `SUPABASE_ACCESS_TOKEN`으로 작업한다.
  - 예: Vercel 작업(배포 등)이 필요하면 Vercel CLI를 설치해 `.env`의 `VERCEL_TOKEN`으로 인증해 작업한다.
- 파일을 지워야 할 때는 바로 삭제하지 말고, `trash-can` 폴더를 만들어 그 안으로 옮겨만 둔다. 작업이 끝난 뒤 사용자가 직접 확인하고 삭제한다.
- 이미 설치된 서브에이전트는 필요할 때마다 적극 활용한다.

## 기술 스택 (PRD 8절, 고정)

- **Next.js** — 화면(UI)과 API 라우트를 한 프로젝트에서 처리
- **OpenAI API** — 스토리보드 텍스트 생성 (`OPENAI_API_KEY`)
- **Vercel** — 배포
- 별도 서버 DB 없음 — 상태 저장은 브라우저 `localStorage`만 사용

## 환경 변수 (`.env`, `.gitignore`에 등록되어 커밋 제외됨)

- `OPENAI_API_KEY` — 스토리보드 생성용 OpenAI 키
- 공유 비밀번호(PIN, PRD 7절) — 앱 접근 게이트용. 아직 `.env`에 전용 키로 추가되지 않았으므로 게이트 구현 시 변수명을 정해 추가할 것
- `.env`에는 이 외에 `GITHUB_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`도 존재하지만 PRD에는 해당 연동에 대한 언급이 없음 — 실제 용도를 확인 후 필요 없다면 정리 권장

## 핵심 비즈니스 규칙 (AI가 반드시 지켜야 함, PRD 5절)

**1) 스토리보드 생성 (기획 아이디어 → 12프레임)**
- 기획 아이디어 입력은 제목/장르(프리셋 태그 다중 선택 + 기타 직접 입력)/시청 타깃/프로그램 개요 4개 구조화 필드(표 형식)로 받는다 (사용자 요청, DESIGN.md §8 참고). "입력 글자 수는 50~500자"는 자유 서술형인 프로그램 개요 필드에만 적용하며, 범위를 벗어나면 생성 요청 자체를 막는다. 제목/시청 타깃은 필수 입력, 장르는 1개 이상 선택 필수.
- 예능 기획 아이디어 옆에 레퍼런스 예능(이름+이미지)을 선택 입력할 수 있다. 이미지는 저장하지 않고 AI 비전 호출로 만든 "연출 톤앤매너 묘사 텍스트"만 스토리보드 생성/재생성 프롬프트에 참고 자료로 반영한다(스토리·소재·인물은 베끼지 않도록 프롬프트로 제어).
- 프레임은 정확히 12개, 서사 흐름(기승전결)에 맞는 순서로 배치 — 임의 순서 금지. 순서가 서사와 맞지 않으면 AI가 스스로 재검토해 재배치.
- 프로그램 개요가 50자 이상이라도 정보가 부족하면 AI가 스스로 보완해 12프레임을 제안한다.
- 각 프레임은 구글 Flow Omni의 "정지 이미지 생성 → 그 이미지로 영상 생성" 2-step 워크플로우에 맞춰 imageDescription([IMAGE], 화각·배경·조명·표정·정지 포즈, 최소 100자 이상)/videoAction([VIDEO], 카메라 무빙 1개+단순 동작 1개, 8초 이상이면 4초 단위 "비트"로 강제 분할)/audioNote([AUDIO], 앰비언스·SFX만) 3필드로 분리해 작성한다 (사용자 요청, DESIGN.md §7 참고). 옷차림·외모 묘사는 프레임 문장에 넣지 않고 캐릭터 설명으로만 전달한다.
- 각 프레임에는 dialogue(대사)/caption(자막) 필드도 함께 만든다 (사용자 요청, DESIGN.md §9 참고) — 대사가 있는 장면만 채우고, 말하는 인물이 한국인이면 한국어, 외국인이면 영어로 쓴다. caption은 항상 한국어 방송 자막(dialogue가 영어면 한국어로 번역)이다. 두 필드 모두 [IMAGE]/[VIDEO] 시각 프롬프트에는 절대 섞지 않는다. 화면(FrameCard)에는 PD 참고용으로만 표시하고, 구글 Flow Omni로 나가는 영어 내보내기에는 더 이상 포함시키지 않는다 (사용자 요청 2차, DESIGN.md §10 참고 — 발화 묘사가 립싱크 시도로 인한 얼굴 렌더 오류를 유발해 [DIALOGUE] 블록 자체를 제거함).
- (★가장 강력한 렌더 안정성 규칙, 사용자 요청 2차, DESIGN.md §10 참고) 구글 Flow Omni는 인물이 말하는 것처럼 묘사되면 립싱크를 시도하다 얼굴 픽셀이 뭉개지는 치명적 오류를 낸다. 그래서 내보내기용 영어 imageDescription/videoAction에는 대사 내용은 물론 "말한다/대화한다/외친다" 같은 발화 행위 자체도 절대 묘사하지 않고, 그 감정·맥락에 맞는 표정·비언어적 제스처로 100% 자동 치환한다(talk/speak/say/dialogue/conversation 등 발화 동사 사용 금지, 코드가 정규식으로 검사해 위반 시 재요청). audioNote 영어 출력도 비언어적 소리(웃음·숨소리 등)와 현장음만 담고, 끝에 "No intelligible dialogue."를 코드가 무조건 덧붙인다. 화면에 자막을 띄워달라는 요청도 무시한다. 이 결과 내보내기 최종 블록은 [IMAGE]/[VIDEO]/[AUDIO]/[NEGATIVE PROMPT] 4개로만 구성된다.
- 각 프레임 길이는 2/4/6/8/10초 중 하나(짝수)로 AI가 제안하되, PD가 값을 직접 수동으로 변경할 수 있다.
- 스타일 고정(Style Lock)은 스토리보드를 생성할 때마다 AI가 그 기획 아이디어에 맞춰 새로 제안해 화면 값을 자동 갱신한다 ("그때그때" 수정, 사용자 요청). 네거티브 프롬프트(Negative Prompt)는 반대로 스토리보드 내용과 무관하게 항상 고정값을 쓴다(PD가 직접 편집하지 않는 한 자동으로 바뀌지 않음, 고정 문구는 `lib/styleLockDefaults.ts` 참고).

**2) 프레임 개별 수정/재생성**
- 특정 프레임 재생성 시 나머지 8개 프레임 내용은 변경하지 않는다.
- 재생성된 프레임도 imageDescription 최소 100자 이상 / 2~10초 짝수 분량 / 8초 이상 비트 분할 규칙을 동일하게 지킨다.
- 프레임 번호(1~12)와 순서는 항상 고정한다.
- 동일 프레임에 대한 재생성 요청은 최대 10회까지만 허용한다.
- 재생성 직전 상태를 임시 보관해, PD가 방금 재생성한 프레임만 1단계 되돌릴 수 있다 (버전 이력 관리가 아니라 가장 최근 1단계만 지원).

**공통:** API 오류·네트워크 장애 시 1~2초 간격으로 최대 3회 자동 재시도 → 모두 실패하면 에러 메시지와 함께 PD가 직접 누르는 "재시도" 버튼을 노출한다.

## 비범위 (만들지 않음, PRD 6절)

- 실제 이미지/영상 생성, 구글 Flow Omni와의 API 연동 (PD가 스토리보드를 직접 Flow Omni에 수동 입력)
- 기획안 저장 이력/버전 관리
- 다중 사용자(협업/공유/댓글), 계정별 로그인·회원가입 — PIN 하나로 접근을 제한하는 게이트만 둔다
- 민감 소재(선정성·폭력성 등) 콘텐츠 필터링

## 접근 제어 & 데이터 영속성

- 계정 로그인 없음. 공유 비밀번호(PIN) 1개로 화면 접근을 제한하는 게이트만 구현 (미입력/오답 시 차단, PIN은 `.env`에 저장).
- 서버 DB 없음. 마지막 작업 중이던 스토리보드는 브라우저 `localStorage`에 저장되어 새로고침·재실행 후에도 유지된다.
- 내보내기: 프레임별/전체 복사 버튼과 텍스트 파일(.txt) 다운로드를 제공한다 (Flow Omni에 옮겨 붙이는 용도).

## 화면/디자인 제약 (prd_lite.md 5절)

- 콘텐츠 영역은 흰색 배경 기본, 포인트 컬러는 ENA Blue(`#2c24ce`) 단일 색상만 사용
- 서체: KT Flow
- PC(데스크톱, 최소 1440px) 전용 레이아웃 — 모바일/태블릿 대응 없음

## 개발 순서 (착수 시 참고, PRD "개발 단위" 절)

1. Next.js 프로젝트 기본 구조 세팅 (페이지/레이아웃)
2. 기획 아이디어 입력 UI (50~500자 카운터 포함)
3. 스토리보드 생성 API 라우트 (입력 텍스트 → AI 호출 → 결과 반환)
4. AI 프롬프트 설계 (12프레임 고정, 서사 순서, 100자 이상, 짝수 초 규칙 반영)
5. 생성된 12프레임 카드/리스트 UI
6. 프레임별 분량(초) 수동 수정 UI
7. 프레임 개별 재생성 UI + API 라우트
8. 프레임별 재생성 횟수 제한(최대 10회) 로직
9. API 오류·네트워크 장애 재시도(자동 3회 + 수동 버튼) 로직
10. `localStorage` 기반 상태 저장
11. 전체 스타일링 (ENA Blue + KT Flow, PC 전용 레이아웃)
12. 공유 비밀번호(PIN) 게이트
13. 프레임별/전체 복사 + .txt 다운로드
14. 프레임 재생성 1단계 되돌리기(실행취소)

## 참고 문서

- [PRD.md](PRD.md) — 전체 기획서 (배경/목표/기능/범위/보안/기술스택/개발단위)
- [prd_lite.md](prd_lite.md) — PRD 요약본 (핵심 2기능 + 디자인 톤)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
