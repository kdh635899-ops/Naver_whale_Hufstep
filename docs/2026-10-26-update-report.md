# 2026-10-26 HUFStep 수정·검증 결과

기존 클로드 코드의 변경을 출발점으로 필요한 부분만 보완했다. 앱은 React·TypeScript이며, 이번 작업은 화면(View), 요건 계산 로직, 조사 데이터 전달 경로에 해당한다. 이 문서는 MVC 구조 밖의 개발·검증 기록이다.

## 적용한 동작

- 전공필수 체크 하나로 이름이 같은 요건을 찾는다. 한 개면 자동 연결, 여러 개면 선택 목록, 없으면 학생 표시만 저장한다. 과목명을 바꿨을 때 이전 이름의 연결이 남는 문제도 수정했다.
- 코드·대체·이름·학생 연결·학생 직접 확인을 모두 ✓로 표시한다. 학생이 직접 확인한 경우에만 `· 내가 체크`를 붙인다. 다시 체크하면 연결·확인을 해제하며, 과목 성적과 취득학점은 유지한다.
- 학교 문의 안내는 회색 사유와 ›만 표시하고, 펼쳤을 때 공통 안내와 전화·메일을 보여 준다. 320px에서도 사유와 ›가 한 줄에 들어간다.
- 충돌 원문의 상태를 바꾸지 않고 앱에서 이수가 필요한 쪽의 과목·최소학점을 계산한다. 부전공 전필 적용이 불명확하면 학교 공통의 제외 원칙을 따른다. 학점이 필요한 요건을 체크하는 행위로 취득학점을 만들지 않는다.
- 기존 네 핵심 범주 밖의 미확정 규칙도 문의 안내와 직접 확인 버튼을 제공한다.
- 학사현황의 Sources 호출은 0개다. Sources 컴포넌트, sourceIds와 출처 데이터는 보존했다.

## 실제 파일에서 계산한 건수

`outputs/inquiries.json`을 `--dry`로 확인한 뒤 재생성했다. 기존 목록과 동일한 52개 질문이 재현됐으며 Q번호를 유지했다.

| 화면 분류 | 건수 |
|---|---:|
| 자료마다 달라서 필수로 계산했어요 | 8 |
| 학과 내규가 있을 수 있어요 | 4 |
| 합격 기준은 학과 확인 필요 | 7 |
| 학번별 기준이 확실하지 않아요 | 33 |
| 합계 | 52 |

- 발송 기록: sent 45건, notSent 7건. sent 항목의 mail.sentAt은 2026-10-26이다.
- 발송 수신함: 32개. 해당 학과·전공의 레지스트리 ID는 캠퍼스·명칭별 항목을 포함해 39개다. 전체 문의 대상 사무실은 37개다.
- 같은 질문 문장 중복은 0건이다. 공식 자료 충돌 externalQuestions는 8건 그대로다.
- 앱 규칙은 696건(호환 15 / 조건 처리 626 / 조사 미확정 55)이다. 문의 52건과 미확정 규칙 55건은 집계 단위가 다르다.
- 연락처는 major-registry.officeContact만 사용한다. 별도 연락처 덮어쓰기 경로는 제거했다. 연락처가 없으면 학생의 캠퍼스 대표 번호를 쓴다.

## 실행 및 검증

| 실행 | 결과 |
|---|---|
| `py -3.13 -X utf8 work/build_inquiries_20261026.py --dry` — 생성 전 미리 보기 | 52건 확인 |
| `py -3.13 -X utf8 work/build_inquiries_20261026.py` — 문의 목록 생성 | 성공 |
| `py -3.13 -X utf8 work/build_hufstep_app_data.py` — 앱용 기초 데이터 생성 | 검증 14,898개 통과 |
| `py -3.13 -X utf8 work/build_hufstep_app_import.py` — 앱 전달본 생성 | 조건 검증 24,912개, 경계 사례 3,101개 통과 |
| `npm run import:data` — 앱 배포 JSON 갱신 | 성공 |
| `npm test` — 단위·React 렌더링 검사 | 14개 파일, 240개 통과 |
| `npm run test:e2e` — 실제 웨일 사용자 흐름 검사 | 19개 통과 |
| `npm run build` — 타입·데이터 동기화 검사와 배포 빌드 | 성공, 데이터 검사 69개 통과 |

Python 검증 라이브러리가 이미 설치된 Python 3.13을 사용했다. 새 의존성은 추가하지 않았다. 최종 빌드 결과를 dist에 반영했다.

실제 웨일의 임시 프로필에서 체크 저장·연결 해제·직접 확인·이수 수 집계, 취득학점 불변, 과목명 변경 시 연결 제거, 문의처 접기·펼치기를 검사했다. 320 / 390 / 590px에서 가로 넘침을 검사했다.

재수강 저장·재열기·해제, 이전 기록 후보·정렬, 추가 정보 접기, 월~금 시간표·시간 미정 줄·상세 패널·자유 메모·중간·기말 정보, 기본값 수정 접기·졸업시험/논문 표기·참고 규정 접기, 평점·알림·저장 복원을 확인했다.

## 이번에 변경한 파일

기존 Git 변경 전체가 아니라 작업 시작 시 만든 ZIP과 비교한 목록이다.

앱 화면·계산·데이터:

- `src/features/courses/CourseEditor.tsx` — 화면: 체크·연결 저장 보완.
- `src/features/academic-status/OfficialSections.tsx` — 화면: 해제·문의처·두 기호 표시 보완.
- `src/features/academic-status/StatusScreen.tsx` — 화면: 확인 중인 학점 기준의 중립 표시.
- `src/domain/requirements/officialRules.ts` — 계산 로직: 엄격한 충돌 적용, 부전공 제외, 표시용 상태.
- `scripts/import-official-data.mjs` — 데이터 변환: 충돌 원문의 엄격한 계산값 투영.
- `src/data/official-rules.json` — 생성 데이터.
- `src/styles.css` — 화면 스타일: 문의 안내의 가로 공간 확보.
- `vite.config.ts` — 테스트 설정: React 렌더링 검사 파일 포함.

테스트·기록:

- `tests/unit/display.test.ts`
- `tests/unit/official.test.ts`
- `tests/unit/official-render.test.tsx` (신규)
- `tests/e2e/leaf-layout.spec.ts`
- `tests/e2e/malay-transcript.spec.ts`
- `tests/e2e/whale.spec.ts`
- `docs/2026-10-26-update-report.md` (이 문서)

조사 폴더 `C:/Users/USER/Documents/Codex/2026-10-13/files-pasted-by-the-user-c`:

- `work/build_inquiries_20261026.py` — 사무실 연락처 제한, 발송 상태 및 생성 전 검증.
- `outputs/app-import/integration-manifest.json` — 데이터 재생성 기록.
- `outputs/inquiries.json`과 나머지 데이터 전달본도 재생성했으며, 위 두 파일 외에는 시작 ZIP과 내용이 같았다.

`dist`의 배포 결과도 갱신했다.

## 복구와 원문 보존

백업 폴더: `C:/Users/USER/Desktop/_hufstep_backups`

- `app_before_inquiries_20261026_143404.zip` — 앱 97개 파일.
- `research_before_inquiries_20261026_143404.zip` — 조사 폴더 1,150개 파일.
- `backup_manifest_20261026_143404.json` — 파일 수와 보호 파일 SHA-256 기록.

두 ZIP의 압축 무결성을 확인했다. 의존성·Git 메타데이터·Python 캐시는 제외했다.

조사 원문 sources.json, graduation-rules.json, review-queue.json과 앱 src/data/sources.json은 시작 시점과 SHA-256이 같다. 공식 자료 충돌 8건과 publicResearchClosed 기록도 그대로다. AssessmentsScreen.tsx, 재수강 도메인 파일, normalizeCourseName 함수도 시작 시점과 같다.

실제 웨일 사이드바 패널과 OS 알림 모양은 육안 검사하지 않았다. 빌드는 성공했으며 번들 크기 500KB 초과 경고가 남아 있다.
