# HUFStep — 네이버 웨일 사이드바 확장앱

한국외대 학생이 이수학점·필수과목·졸업요건을 확인하고, 이번 학기 평가일정과 예상 평점을 관리하는 웨일 사이드바 확장앱입니다.
기준 명세: `HUFStep_Claude_Code_Development_Spec.md` (v2.0, 2026-10-23).

> **공식 졸업요건 데이터 일부가 연결돼 있습니다(전체 확정 아님).** 확인된 규칙만 계산하고, 추가 입력이 필요하거나 조사 미확정인 항목은 이유와 함께 표시하며 졸업 충족은 확정하지 않습니다 → [docs/data-contract.md](docs/data-contract.md), [docs/data-status.md](docs/data-status.md)

## 기술 스택과 구조

TypeScript + React 18 + Vite 6, 검증 zod, 테스트 vitest(+fake-indexeddb)·Playwright. 서버 없음 — 모든 데이터는 브라우저의 IndexedDB에만 저장됩니다.

```text
src/
  app/            진입점(main.tsx), 화면 뼈대(App.tsx), 전역 상태·저장(store.tsx)
  features/       화면: records(종정시 입력) academic-status(학사현황) assessments(평가일정)
                  calculator(학점계산) settings(마이페이지) courses(공유 과목 편집기) profile(학생 조건)
  domain/         순수 로직: parser, gpa, requirements, assessment-events, merge, notifications, validation
  data/           학교 데이터 JSON(교체 대상) + 합성 데모 데이터(demo.ts)
  storage/        IndexedDB 저장소·schema migration
  platform/       whale/chrome API 어댑터
  background/     MV3 서비스 워커: 알림 예약·복구·발송
public/           manifest.json, icons/
tests/unit        도메인·저장소·서비스 워커 단위 테스트 (합성 데이터만)
tests/e2e         실제 웨일로 하는 사용자 흐름 테스트
```

## 명령어

```bash
npm install          # 의존성 설치 (package-lock.json 기준)
npm run build        # 타입 검사 → 데이터 묶음 검사 → dist/ 생성 (설치 가능한 확장앱)
npm test             # 단위 테스트 (vitest)
npm run typecheck    # 타입 검사만
npm run check:data   # src/data/*.json 스키마·참조 검사만
npm run test:e2e     # 실제 웨일로 E2E (먼저 npm run build 필요)
npm run dev          # Vite 개발 서버 (확장 API 없이 화면만 확인용)
npm run icons        # 앱 로고로 public/icons/*.png 다시 생성 (설치된 Chrome 사용)
```

`test:e2e`는 `C:/Program Files/Naver/Naver Whale/Application/whale.exe`를 임시 프로필로 띄웁니다. 경로가 다르면 `WHALE_PATH` 환경 변수로 지정하세요. 평소 쓰는 웨일 프로필은 건드리지 않습니다.

## 웨일에 설치하기 (개발자 모드)

1. `npm install` → `npm run build` 로 `dist/` 폴더를 만듭니다.
2. 웨일 주소창에 `whale://extensions` 입력 → 오른쪽 위 **개발자 모드** 켜기.
3. **압축해제된 확장 앱을 로드합니다** → 이 저장소의 `dist` 폴더 선택.
4. 웨일 사이드바에 HUFStep 캐릭터 아이콘이 생깁니다. 눌러서 엽니다.
5. 처음 열면 `내 조건 입력하고 시작하기` 또는 `가상 데이터로 둘러보기`를 고릅니다.

코드를 고친 뒤에는 `npm run build` 후 확장앱 관리 화면에서 새로고침(↻)을 누릅니다.

팀원에게 배포할 때는 새로 빌드한 `dist/`의 내용만 압축합니다. 받은 쪽은 압축을 풀어 기존에 불러온 확장앱 폴더에 덮어쓰고 새로고침한 뒤, 관리 화면의 버전이 새 배포본과 같은지 확인합니다. 성적 입력 오류를 다시 확인할 때는 열려 있던 앱 화면도 닫았다 열고 원문을 다시 붙여넣습니다.

## 권한

`alarms`, `notifications` 두 가지뿐입니다. 학교 사이트 접근 권한·콘텐츠 스크립트·탭·클립보드·쿠키 권한은 없습니다. 자세한 내용은 [docs/privacy-and-storage.md](docs/privacy-and-storage.md).

## 문서

- [docs/data-contract.md](docs/data-contract.md) — 공식 데이터 스키마·적용 규칙·교체 절차
- [docs/data-status.md](docs/data-status.md) — 지금 들어 있는 데이터와 미취합 범위
- [docs/privacy-and-storage.md](docs/privacy-and-storage.md) — 저장 방식·권한·삭제·알림·보호 한계
- [docs/implementation-notes.md](docs/implementation-notes.md) — 피그마와 달라진 점, 구현 선택, 검증 결과, 미검증 항목
