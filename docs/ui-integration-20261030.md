# 2026-10-30 데이터 보정·팀원 UI 통합 기록

## 범위와 복구

- 시작 main/origin/main: `9baa6f4`. fetch 후 팀원 원격 브랜치: `origin/feat/figma-ui` (`f745469`). 로컬 `feat/figma-ui`는 별개 이력이므로 수정하지 않았다.
- 백업: `backup/my-0203-1030`, 커밋 `11041ca`, 변경 파일 39개(커밋 전체 트리 175개). 개인 02·03 구현과 dev/까지 포함한다. 브랜치를 유지하고 push하지 않는다.
- Git 제외 파일 16개: `C:\Users\USER\Desktop\hufstep-backup-1030-20261030-113557`. `backup-manifest.json`에 전체 목록과 제외 범위를 기록했다. 작업 기록·스크린샷·검증 자료·릴리스 등을 복사했으며 재생성 가능한 node_modules/와 dist/는 복사하지 않았다.
- 조사 폴더에는 쓰지 않았다. 가져오기 스크립트가 기존 원본을 읽기만 했다.

## 선별 데이터 커밋

`941ea0a`: 국제학부 학번 조건, 영미문학 FLEX 610, 경영 부전공 supportGaps, 동일 학과 표기의 equivalentIds, 제목만으로 면제 추정 금지, GENERAL_ADMISSION_DEFAULTS, distinctCourseRules, courseConfirmationIds를 보존했다.

선별 파일:

- `.gitattributes`
- `scripts/import-official-data.mjs`
- `src/data/index.ts`
- `src/domain/requirements/conditions.ts`
- `src/domain/requirements/displayTitle.ts`
- `src/domain/requirements/officialRules.ts`
- `src/data/official-rules.json`: `npm run import:data`로 생성. 백업본 복사나 수동 수정 없음.
- `tests/unit/displayTitle.test.ts`, `tests/unit/official.test.ts`, `tests/unit/syntheticRequirements.test.ts`

백업의 display.test.ts 변경은 개인 02·03 구현에 의존하므로 채택하지 않았다. official-render.test.tsx의 추가 검사는 데이터 보정이 아닌 개인 화면 동작 변경을 전제하여 채택하지 않았다. syntheticRequirements.test.ts의 assessmentText 출력 변경도 제외했다. 기존 테스트는 유지했다.

공유 officialRules.ts에서 개인 계산 옵션 isExcluded와 하위 목록 제외 처리를 제거했다. conditions.ts의 별도 UI 문구 변경과 graduationTerm 처리 변경도 이번 데이터 보정 범위에서 제외했다. 개인 02·03 모듈·상태 필드·테스트·dev/는 통합하지 않았다.

## 병합 판단

- `RecordsScreen.tsx`: main의 analyzeTranscript, AbortController, validateTranscript, changeInput, revision, 함수형 저장 갱신, text/plain 붙여넣기를 유지했다. 팀원 store의 pasteText/setPasteText로 화면 이동 시 입력을 유지하고 초기화는 한 번에 실행한다. 입력 전문은 AppState와 영구 저장소에 넣지 않는다. main의 재가져오기 회귀 검사를 보존하기 위해 저장 후 입력 잠금은 채택하지 않았다.
- `StatusScreen.tsx`: 팀원 statusEdits, AddPrompt, 추가·이름 변경·삭제·새 구분 기능을 사용한다. main certConfirmations, 수강 중·재수강 표시, 택일 후보 표시와 계산 연결을 유지한다. 중복 정리 전 이수 ID도 courseConfirmationIds로 읽고 취소한다.
- `styles.css`: 팀원 폰트·로고·편집 패널 스타일을 반영하고 main 이수 확인·수강 중·재수강 스타일을 함께 보존했다.
- `tests/e2e/whale.spec.ts`: 팀원 UI 검사와 main 재가져오기·파싱·계산 검사를 유지한다. 초기화 검사는 합의된 한 번 클릭 동작에 맞췄고 화면 이동 시 원문 유지 검사도 추가했다. 이수 버튼 선택자는 통합 결과에 맞췄으며 이수 수 증가·취소 검사는 그대로 유지했다.
- 자동 병합 검토: store.tsx의 메모리 pasteText와 기존 저장·시간표 연동, state.ts의 선택적 statusEdits와 certConfirmations, types.ts의 StatusEdits와 기존 타입, schemas.ts의 선택적 statusEdits 검증과 기존 저장 상태 검증이 함께 남았다. 기존 스키마 버전은 유지한다.

## 검증

- 데이터 선별 후: 생성·동기화 검사 통과, 단위 테스트 30개 파일/581개 통과.
- 추가한 데이터 회귀 테스트의 초기 실패 2개는 동일 표기 관계가 없는 학과 ID와 수강 중 기본 성적을 시험 데이터에 사용한 원인이었다. 실제 동일 표기 학과와 A0 이수 성적으로 수정했고 검사를 삭제하지 않았다.
- 최초 통합 E2E: 32개 통과, 2개 실패, 직렬 Whale 검사 5개 미실행. 실패는 (1) Git 제외된 이전 디자인 기준 이미지와 팀원 SVG 로고의 픽셀 차이, (2) Whale 테스트에서 main의 버튼형 학년 선택기를 네이티브 select로 조작한 선택자 충돌이었다. 이전/현재 이미지를 직접 확인하여 헤더 로고 변경만 확인하고 로컬 기준 이미지를 갱신했다. 픽셀 동일성 단언은 그대로 유지했다. 학년 변경은 보이는 combobox/option을 클릭하게 수정했다. 기존 기준 이미지는 별도 백업에 남아 있다.
- 국제학부 조건식을 비교하는 기존 검사를 강화해 학번 blocker 외 모든 조건이 보존됨을 확인한다. 강화 과정의 unknown/Cond 타입 오류는 기존 condSchema.parse로 원본 조건을 검증하도록 수정했다.
- 최종 통합 단위 테스트: 30개 파일/581개 통과. 최종 빌드: typecheck, 데이터 동기화, 데이터 관련 81개 검사, Vite 배포 빌드 통과. 500 kB 초과 번들 경고는 남았다.
- E2E 전체 39개를 최종적으로 확인했다. 최초 전체 실행에서 통과한 비-Whale 26개에 더해, 실패했던 디자인 1개를 재실행해 통과했고 Whale 전체 12개(처음 미실행된 5개 포함)를 최종 빌드에서 재실행해 통과했다. 마지막 단일 명령으로 전체 39개를 다시 실행한 것은 아니다. 03 졸업시험 이름 변경 검사도 추가로 통과했다.
- 소스·스크립트·테스트에서 제외 대상 필드·모듈·isExcluded 참조가 없고 dev/도 없다. 생성 데이터는 데이터 커밋과 동일하다. 충돌 표시·diff 공백 오류가 없고 추적 텍스트 파일 작업 사본도 LF로 맞췄다.
- 종정시 분석·저장/반려, 메모리 원문 화면 이동 유지·초기화, 02·03 추가·이름 변경·삭제, 졸업요건 체크, 저장 기록 재접속 복원, 수강/재수강·예상 평점 연동은 합성 자료 E2E로 확인했다. 기존 형식 데이터 읽기와 데이터 보정은 단위 검사로 확인했다.

## 후속 작업: 이번 통합의 완료 범위와 별개

1. **표시 누락·중복**: 학생 조건별로 선택된 evals, courseRules, report.items, 실제 02·03 카드를 대조해 누락 지점을 찾는다. 평면 ALL 포함 관계만 정리했으며 동일 크기 목록·OR·AT_LEAST·학과 공통 기준 중복은 별도 판정이 필요하다. 동일 학과 표기의 평가 연결이 화면에서 어느 전공 카드로 배치되는지도 점검한다.
2. **대체 경로·면제·행정 안내 분류**: coversRuleIds와 none, 언어시험 택일식, 면제 승인 조건, 제출 서류·행정 안내를 각각 의무/대체 경로/면제/안내로 구분하는 표시 규칙을 정한다. 제목의 영문 내부 이름만으로 면제를 추정하지 않는다. FLEX 610 데이터 보정이 모든 대체 경로의 화면 중복 제거까지 해결하지는 않는다.
3. **개인 편집과 계산의 불일치**: 팀원 statusEdits는 화면 목록에 적용한다. 공식 학점·요건 계산과 이름 변경·삭제·추가 표시가 항상 같은 의미를 갖지는 않는다. 특히 OR 후보 삭제 시 필요 개수와 단순 과목 수 감소, 직접 추가한 과목의 이름 대조와 실제 학점/필수 인정 차이를 검토한다. 편집을 계산에 반영할지 표시만 바꿀지 합의 후 별도 구현한다.
4. **데이터 갱신 시 개인 편집 ID**: renamed/removed와 certConfirmations/requirementLinks가 규칙·과목 leaf ID를 참조한다. 현재 courseConfirmationIds는 같은 학과·역할·과목의 확정 평면 ALL 목록 사이 기록만 연결한다. 생성 스크립트의 rule/path ID가 바뀌거나 택일 구조가 달라질 때 쓸 안정 ID·이전 ID 매핑·고아 편집 안내는 후속 설계가 필요하다.

이 후속 문제를 해결하기 위해 백업의 개인 courseExclusions/customRequiredCourses/courseChecks/assessmentSettings/assessmentChecks 또는 개인 설정 화면을 다시 넣지 않는다.

## 사람이 추가로 확인할 것

자동 검사는 합성 자료와 격리된 브라우저 프로필을 사용한다. 실제 Whale 사이드바 패널의 폭·포커스·글꼴·확장앱 재시작, OS 알림은 사람이 확인해야 한다. 기존 개인 저장 데이터 자체는 읽거나 수정하지 않았으므로 실제 사용자의 백업 데이터 복원 확인도 별도로 진행한다. 졸업요건 전체 표시의 정확성은 이번 완료 범위에 포함하지 않는다.

수동 점검 시 아래 순서로 실제 사이드바에서도 확인한다.

1. 종정시 붙여넣기 → 분석 → 저장, 누락·잘못된 내용은 저장 반려.
2. 화면 이동 후 붙여넣은 원문 유지, 확장앱을 완전히 닫고 다시 열면 원문은 사라지고 저장 성적만 복원.
3. 초기화 한 번 클릭으로 저장 종정시 정보와 메모리 원문 정리.
4. 학사현황 02·03 추가·이름 변경·삭제, 새 졸업요건 구분과 시험 추가.
5. 졸업요건 확인 체크·취소 및 다시 열었을 때 확인 기록 유지.
6. 기존 개인 저장 데이터 백업을 별도 테스트 환경에 복원해 읽기 확인.
7. 국제학부·영미문학·경영 부전공 및 동일 표기 학과의 보정 결과를 해당 학생 조건으로 확인.
