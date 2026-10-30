# 2026-10-30 연결 점검 수정 기록

기준: `main`, `dcd308f2e78dd8bc2f80c3d928d9f43bb2987ecc`. 시작 시 미커밋 변경 없음. 커밋·push·병합 없음.

수정 전 백업: `C:\Users\USER\AppData\Local\Temp\hufstep-before-fix-20261030-130926` (`HEAD.zip`, `working.patch`). 조사 폴더·회신 원본·실제 학생 저장소는 수정하거나 테스트에 사용하지 않았다.

## 독립 원인 8개

| 원인 | 수정 |
|---|---|
| R1 입력 경로 없음 | 필요한 선발연도·졸업학기·학위과정·실제 편입학기/학년만 기존 입력 스타일로 받는다. `profile.facts` 저장 후 규칙 재선택. 답한 조건도 수정 가능. |
| R2 미입력의 null/false·편입 추정 | 학위과정 등 미입력을 해당 없음으로 변환하지 않는다. 편입 연도·학년을 학번으로 추정하지 않는다. 일반전형에 명시된 기존 기본값과 카탈로그에서 확인 가능한 영어 전공 분류는 유지한다. 면제 승인 미입력을 공식 승인으로 만들지 않는다. |
| R3 ELLT 승인 우회 | 사전 허가가 필요한 대체쌍을 동일 코드 직접 매칭에도 적용한다. 직접 체크/명시적 성적 연결은 학생 확인 수준으로 구분하고 승인 사실을 생성하지 않는다. 승인 안내는 체크 후에도 남는다. |
| R4 빈 목록 의미 혼동 | 공식 없음은 ‘요건 없음’, 필요한 입력은 구체적인 ‘확인 필요’, 자료 부족은 학과 문의 안내와 확인된 연락처·공식 링크를 표시한다. |
| P1 택일 필요량 감소 | ALL/OR/AT_LEAST 트리로 사용자 합계를 계산한다. 후보 하나/전부 제외해도 선택 의무는 남는다. 공식 계산에는 개인 제외를 반영하지 않는다. 개인 제외 후 완료는 ‘개인 기준 완료’로 표시한다. |
| P2 개인 편집 혼입 | 캠퍼스·주/두 번째 전공·전공 구성·학번·입학유형·답변별 문맥을 분리한다. 체크·이름 수정·추가·제외·구분·성적 연결을 함께 보관/복원한다. |
| P3 부정확한 성적 매칭 | 직접 추가 과목은 이름 일치만으로 완료하지 않는다. 기존 과목 편집기의 명시적 연결 또는 직접 확인을 사용한다. 인정 제외·재수강 대체 이전 성적·시간표·수강 중 기록은 연결 이수에 쓰지 않는다. 표시명 변경으로 연결 ID가 바뀌지 않는다. |
| P4 삭제·복구·ID | 개인 과목/시험 삭제 시 체크·연결도 정리하고 성적 원본은 보존한다. 공식 항목은 기존 삭제 모드에서 같은 버튼으로 복구한다. 공식 ID를 내용 기반으로 생성하고 기존 ID 1,260개의 고정 대응표를 둔다. 모호한 중복은 생성 단계에서 오류로 중단한다. |

이전 버전은 편집의 소속을 저장하지 않았으므로 소속 불명 자료는 `statusEditContexts['legacy-unassigned']`에 원형으로 보관하고 현재 전공에 임의 적용하지 않는다. 이 보관분을 자동 복구·재배정하지 않는다. 새 문맥에서 만든 기록은 같은 조건으로 돌아오면 복원한다.

## 졸업평가

- 내부 유형·객체 문자열 대신 실제 시험명, 점수, 비교, 등급, 시간, 학점과 ALL/OR 조건을 읽는다. 해석할 수 없는 값은 ‘확인 필요’로 표시한다.
- EICC 학교 기타언어는 한 의무로 표시하고 학과 영어 평가와 분리한다. 중국어 보충 근거는 별도 체크 의무나 추가 언어 질문을 만들지 않는다.
- 대체·면제는 관련 의무의 선택지로 묶고 제출·승인·시행 조건을 남긴다. 다른 의무를 무조건 합치지 않는다.
- 중국언어문화 세 단위 논문 폐지, 융합일본 부전공 인증 없음, 서울 경제 유효기간·재입학, 일본어통번역 실시·접수, GBT 행정 안내는 독립 체크 의무로 만들지 않는다.
- GBT 본 시험·프로젝트·면제를 연결하고 영미문학·문화의 통합 기준이 선택되면 이전 부분 기준을 중복 표시하지 않는다. 정치외교의 같은 시험 과목 안내는 본 시험의 보충 설명으로 연결한다.
- AI데이터의 캡스톤 논문·학회 제1저자·교외 수상을 구분하고 캡스톤 수강 의무를 유지한다. 중국언어문화·정치외교·포르투갈어 대체 경로도 관련 의무에 연결한다.
- 판정 미확정과 사용자 체크는 별개다. 모든 기준을 확보하지 못한 것을 공식 전체 충족으로 표시하지 않는다.

## 변경 파일

생성·데이터:

- `scripts/import-official-data.mjs`
- `scripts/requirement-ids.mjs`
- `src/data/official-rules.json`
- `src/data/requirement-bundles.json`
- `src/data/requirement-id-migration.json` — 이전 배포판의 고정 대응표. 재가져오기 때 현재 배열 순서로 다시 만들지 않는다.

상태·도메인:

- `src/app/store.tsx`
- `src/domain/state.ts`
- `src/domain/validation/schemas.ts`
- `src/domain/requirements/assumptions.ts`
- `src/domain/requirements/conditions.ts`
- `src/domain/requirements/officialRules.ts`
- `src/domain/requirements/statusEdits.ts`
- `src/domain/requirements/assessment.ts`

기존 화면 연결:

- `src/features/academic-status/StatusScreen.tsx`
- `src/features/academic-status/OfficialSections.tsx`
- `src/features/academic-status/useProgress.ts`
- `src/features/profile/ProfileForm.tsx`
- `src/features/courses/CourseEditor.tsx`

검증:

- `tests/unit/audit-regressions.test.tsx`
- `tests/unit/assumptions.test.ts`
- `tests/unit/display.test.ts`
- `tests/unit/official-render.test.tsx`
- `tests/unit/syntheticRequirements.test.ts`
- `tests/e2e/audit-regressions.spec.ts`
- `tests/e2e/restored-academic-features.spec.ts`

CSS·글꼴·색상·간격·카드 구조·AddPrompt·편집 패널은 유지했다. 새 설정 페이지·톱니바퀴·승인 모달을 추가하지 않았다. 새 입력 UI는 규칙 선택에 필요한 학생 조건뿐이다. 공식 링크와 복구는 기존 안내·버튼 위치를 쓴다.

## 검증 범위와 한계

검사 명령:

```powershell
npm test -- --reporter=dot       # 관련 회귀를 포함한 전체 단위 테스트
npm run typecheck               # TypeScript 타입 검사 (build에서도 실행)
npm run check:data              # 원본 전달본과 생성 결과 동기화 및 데이터 단위 검사
npm run build                  # 타입·데이터 검사 후 배포 빌드
npm exec playwright test tests/e2e/audit-regressions.spec.ts tests/e2e/restored-academic-features.spec.ts -- --reporter=list
# 새 Chrome context에서 합성 학생 입력·저장·복구·시간표/평점 회귀 검사
```

LD 이중전공 768개, 언어인지 이중전공 192개의 학번·입학유형·선발연도/졸업학기 경계 계산을 포함한다. 이 계산 조합은 실제 선발 가능 시점이나 모든 전공 쌍의 학교 허용을 증명하지 않는다. 대표 UI 프로필은 서울 말레이+LD/ELLT, 글로벌 통계+언어인지 등이며 모든 학생·모든 예외를 전수 검사한 것은 아니다.

기존의 편입 추정/null 가정을 요구하던 검사는 미입력 유지라는 새 요구사항으로 바꾸고, 추정 속성이 없음을 검사한다. 직접 확인 문구·공식 링크에 관한 기존 검사는 새 요구사항의 정확한 문구와 확인된 URL을 검사한다. 이수 개수·학점·평점·저장·화면 폭 검사는 유지한다.

전체 단위 636개(기존 581개 + 55개 추가), 관련 Chrome E2E 35개(기존 27개 + 신규 8개)가 검증 대상이다. Chrome은 새 context, 저장소 단위 검사는 fake-indexeddb, 성적 병합은 합성 fixture만 사용한다.

최종 확인 결과:

| 검사 | 결과 |
|---|---|
| 전체 단위 | 31개 파일, 636개 통과 |
| 새 원인·평가 회귀 | `audit-regressions.test.tsx` 54개 통과; 기존 React 렌더 테스트에도 연결 유지 1개 추가 |
| 타입 | `tsc --noEmit` 통과 |
| 데이터 | 전달본 동기화 확인, 데이터/공식 규칙 테스트 81개 통과 |
| 빌드 | Vite 빌드 통과; 기존 대용량 청크 경고 유지 |
| Chrome | 신규 8개 + 기존 27개 모두 통과 (20개 기존 UI 검사와 15개 신규/학사 회귀 묶음으로 확인) |
| 육안·서버 | LD·ELLT·EICC 캡처 육안 확인, 언어인지·편입은 E2E·캡처 생성 확인, 개발 서버 HTTP 200 |
| 작업 트리 | `git diff --check` 통과, CSS·AddPrompt 변경 없음, HEAD 그대로 |

실제 학생 데이터, 웨일 네이티브 사이드바/OS 알림, 모든 허용 전공 조합, 학과 원문의 최신 변경은 확인하지 않는다. 자료가 부족한 경제 이중전공·기후변화 2024·일부 전체 과목 집합 등을 임의 확정하지 않는다. 학교 승인과 학생 직접 확인을 동일시하지 않는다.

## 직접 확인

개발 서버: <http://127.0.0.1:5188/sidebar.html> (실행 유지).

새 시크릿 창에서 접속해 **가상 학적만** 입력한다. 실제 성적을 붙여넣을 필요가 없다. 처음에는 학사정보 저장 후 ‘학사 현황’으로 이동한다. 변경은 기존 ‘마이페이지 → 학적 정보 수정하기’를 사용한다.

| 확인할 조건 | 가상 프로필과 순서 |
|---|---|
| LD | 서울, 말레이·인도네시아어 주전공, LD 이중전공, 2024 신입. 일반전형이면 필요한 특별전형 질문에 ‘아니요’. 선발 2022 + 졸업 2025년 2학기 → 이중전공 0/4. 선발 2023 → 0/5. ‘미정’으로 되돌리면 확인 필요. |
| 언어인지 | 글로벌, 통계학과 주전공, 언어인지과학과 이중전공, 2024 신입. 일반전형 조건을 답한 뒤 선발 2024 → 0/1, 2025 → 0/3. |
| ELLT | 서울, 말레이·인도네시아어 주전공, ELLT 이중전공, 2024 신입. ‘학위 과정’ 미정 → 확인 필요, BA → 0/5, BLS → 0/6. |
| 편입 | 서울, 말레이·인도네시아어 주전공·경영 이중전공, 2024 일반편입. 입학(편입학) 학기·편입 학년이 미정인지 확인. 실제 편입 정보를 가정해 2023년 2학기·2학년을 선택해도 학번은 2024로 유지. |

조건을 선택한 뒤 새로고침하면 입력과 선택한 목록이 유지된다. 다른 프로필로 바꾸면 이전 문맥의 개인 추가·체크가 섞이지 않는다.
