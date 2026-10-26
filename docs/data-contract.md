# 공식 데이터 계약과 교체 절차

학교 공식 데이터는 코드가 아니라 `src/data/`의 JSON 파일로만 들어옵니다. 스키마는 `src/domain/validation/schemas.ts`(zod), 타입은 `src/domain/types.ts`가 기준입니다.

## 파일

| 파일 | 내용 | 비고 |
| --- | --- | --- |
| `departments.json` | 학과 ID·이름·캠퍼스·alias·유효기간·검증 상태 | 학생 조건 선택 목록 |
| `requirement-bundles.json` | **공식(verified) 졸업요건 묶음** | 고정 필드로 표현되는 규칙만. `demo` 상태를 넣으면 거절 |
| `official-rules.json` | 조건식이 붙은 공식 규칙 (`rules`) + 초기 4개 학과 지원 공백 (`supportGaps`) | `state`: compatible / pending / unconfirmed. 아래 참고 |
| `department-meta.json` | 학과 종류·모집 상태·상위 전공·이중/부전공 제한 | 선택 목록 구분과 두 번째 전공 제한에 사용 |
| `requirement-bundles.demo.json` | 가상 예시 묶음 | `demo` 상태만 허용, 데모 모드에서만 사용 |
| `course-equivalences.json` | 동일·대체 과목 관계 | `verified`만 매칭에 사용 |
| `academic-calendars.json` | 캠퍼스·학기별 중간/기말 기간 | 날짜 입력 시 참고 안내로만 표시 |
| `grading-policies.json` | 등급 alias, 과목당 학점 상한 | 첫 항목 사용 |
| `sources.json` | 출처 문서명·URL(http/https)·확인일·상태 | 모든 묶음의 `sourceIds`가 여기를 가리켜야 함 |

## RequirementBundle 핵심 키

```jsonc
{
  "schemaVersion": 1,
  "id": "seoul-2024-malay-double-primary",   // 고유
  "dataVersion": "2026-11-01",
  "status": "verified",                     // verified 묶음은 sourceIds 필수
  "scope": "primary",                       // common | program | primary | secondary
  "applicability": {
    "homeCampus": "seoul",
    "cohortFrom": 2024, "cohortTo": 2024,   // 학번(입학 연도) 범위
    "entryTypes": ["freshman"],             // freshman | transferGeneral | transferBachelor
    "primaryDepartmentIds": ["seoul-malay-indonesian"], // primary 범위는 필수, common/program은 [] = 학과 무관
    "programTypes": ["double"],             // single | double | minor | intensive
    "secondaryDepartmentIds": [],           // secondary 범위는 필수
    "effectiveFrom": "2024-03-01"           // 선택
  },
  "totalRequiredUnits": null,               // 학점×100. 이 묶음이 정하지 않으면 null
  "requiredUnitsByArea": { "primary": 4200 },
  "requiredCourseGroups": [
    { "id": "...", "title": "...", "minCount": 1, "minCreditUnits": 300,
      "acceptableCourseCodes": ["공식코드"], "sourceIds": ["..."] }
  ],
  "allowCourseReuseAcrossGroups": false,    // 규정에 명시된 경우만 true
  "certifications": [ /* kind: departmentExam | externalCertificate | other */ ],
  "commonRequirements": [ /* checkMethod: studentConfirm | informational */ ],
  "sourceIds": ["..."]
}
```

학점은 모두 **100배 정수**(`3학점 = 300`)입니다. 영역 키: `primary, double, second, minor, practicalLanguage, liberalArts, teaching, freeChoice, foundation, unknown` (`second`(2전공)와 `double`(이중전공)은 다른 영역).

`certifications`의 `publicExamInfo`(영역·형식·수준)는 **공식 공개 근거가 있을 때만** 채웁니다. 모든 시험에 LC/RC/WC가 있다고 가정하지 않습니다.

## 적용 규칙 (resolver: `src/domain/requirements/resolve.ts`)

1. 상태가 허용 목록(실제 모드 `verified`, 데모 모드 `demo`)인 묶음 중 캠퍼스·학번·입학유형·전공구성·학과·유효기간이 **정확히** 맞는 것만 고릅니다.
2. 여러 묶음을 의미별로 결합합니다. 주전공과 이중전공의 총학점을 더하지 않습니다.
3. 같은 값(총학점·영역 학점)을 서로 다르게 요구하면 덮어쓰지 않고 **충돌**로 표시하고 그 값은 비웁니다.
4. 맞는 묶음이 없으면 `null` → 화면에 "현재 선택 조건의 졸업 기준이 아직 제공되지 않아요"와 취득학점만 표시합니다. 필요학점을 0으로 넣지 않습니다.
5. 필수과목은 공식 코드 + `verified` 동일과목 관계로만 매칭합니다. 이름 유사도로 확정하지 않습니다.
6. 학과 alias가 있어도 다른 학과 ID의 규정으로 자동 대체하지 않습니다.

## 조건식 규칙 (`official-rules.json`, 엔진: `src/domain/requirements/officialRules.ts`)

- `condition`은 AND/OR/NOT/eq/in/range/true/false/unknown만 쓰는 데이터입니다(코드 실행 없음). 스키마는 `.strict()`라 모르는 키가 있으면 그 규칙을 **거절**합니다(조용히 지워 규칙이 넓어지지 않게). 기존 묶음 스키마도 strict입니다.
- 평가는 참/거짓/모름 3값입니다. 학생 정보가 없으면 `false`가 아니라 '모름'이며, 그 규칙이 요구하는 필드만 학생에게 묻습니다(`ASKABLE_FIELDS`). 답은 `profile.facts`에 저장됩니다. 묻지 못하는 필드나 원문 `unknown` 조건이 남으면 '앱 미지원'입니다.
- 주전공(majorRole `primary`)과 두 번째 전공(`dual`/`minor`) 문맥에서 각각 평가합니다. 전공 구성은 single→`singleExempt`, double→`dualMajor`, minor→`minor`, intensive→`intensiveSingle`(부전공 없음) / `intensiveWithMinor`(부전공 있음).
- `currentTerm`을 `graduationTerm`으로 복사하지 않습니다. 졸업 학기 조건 때문에 빠진 규칙은 이유를 표시합니다. `courseEnrollmentTerm`은 과목마다 그 과목의 수강 학기로 평가합니다.
- `status`가 verified가 아닌 규칙(조사 미확정·충돌)은 학점·필수과목 계산에 쓰지 않고 이유·출처만 표시합니다.
- 학점(`totalRequiredUnits`, `requiredUnitsByArea`)은 이미 ×100 정수입니다. 다시 100배 하지 않습니다(200학점 초과 값은 스키마가 거절). `detail`은 화면 표시용 원문 요건이며 원래 단위(학점·점수·개월)입니다.
- `courses`는 ALL / OR / AT_LEAST 중첩식입니다. 코드가 있는 과목은 공식 코드 또는 조건이 맞는 `substitutions`로만 공식 충족, 코드가 없는 과목은 학생이 과목 편집기에서 직접 연결한 경우에만 '학생 연결'로 표시합니다. 한 과목은 한 요건에만 씁니다.
- `none`은 원문에 '요건 없음/적용 제외'가 명시된 범주입니다. 빈 배열·누락은 요건 없음이 아닙니다.
- 핵심 항목(졸업 학점, 학교 외국어인증, 전공별 필수과목·졸업평가)마다 확인됨 / 원문에 요건 없음 / 추가 입력 필요 / 학교 확인 필요 / 앱 미지원 / 자료 없음을 구분합니다. 하나라도 비었거나 학과 전체 조사가 끝나지 않았으면 졸업 충족을 확정하지 않습니다. 학생의 통과 확인 체크는 규정의 불확실성을 해소하지 않습니다.

## 교체 절차

1. 데이터 프로젝트 전달본으로 `npm run import:data`를 실행합니다(원본 폴더는 읽기만 함). 다른 위치면 `node scripts/import-official-data.mjs <app-import 경로>`.
2. `npm run check:data` — 전달본과의 동기화, 스키마·중복 ID·출처/학과 참조·demo 혼입, 조건식·필수과목 구조 보존을 검사합니다. 실패 항목은 로딩 단계에서도 거절되고 정상 항목만 쓰입니다.
3. `tests/unit/requirements.test.ts`에 해당 조합의 fixture 검사를 추가해 resolver 결과를 확인합니다.
4. `npm run build` → `dist/` 재배포. UI 수정이나 학생의 성적 재입력은 필요 없습니다 (학생 데이터와 학교 데이터는 분리 저장).

공식 학사일정이 바뀌어도 학생이 입력한 시험 날짜는 덮어쓰지 않습니다 (학사일정은 안내용 참고 데이터).
